import { PERMISSIONS } from '@somidac/shared';
import { useCallback, useEffect, useState } from 'react';
import { Message, Modale } from '../../composants/communs';
import { ErreurApi, messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterDateHeure, formaterJour, formaterMontant } from '../../format';
import type { Compte } from './Paiements';

interface LigneCloture {
  id: string;
  compteId: string;
  compte: string | null;
  jour: string;
  montantCompte: number;
  soldeCalcule: number | null;
  ecart: number | null;
  avecEcart: boolean;
  justification: string | null;
  statut: 'a_valider' | 'validee' | 'refusee';
  commentaire: string | null;
  saisieLe: string;
  saisiePar: string | null;
  validePar: string | null;
}

/** Billets et pièces en circulation (franc CFA). */
const COUPURES: [number, string][] = [
  [10_000, 'billets'],
  [5_000, 'billets'],
  [2_000, 'billets'],
  [1_000, 'billets'],
  [500, 'pièces'],
  [250, 'pièces'],
  [200, 'pièces'],
  [100, 'pièces'],
  [50, 'pièces'],
  [25, 'pièces'],
  [10, 'pièces'],
  [5, 'pièces'],
];

function Statut({ s }: { s: LigneCloture['statut'] }) {
  if (s === 'validee') return <span className="pastille verte">Validée</span>;
  if (s === 'refusee') return <span className="pastille rouge">Refusée</span>;
  return <span className="pastille orange">À valider</span>;
}

/**
 * Clôture de caisse (§5.6, §10.3) : le caissier compte la caisse et saisit le total sans voir
 * le montant attendu ; un écart doit être expliqué ; le gérant valide.
 */
export function Cloture() {
  const { appeler, peut } = useSession();
  const gerant = peut(PERMISSIONS.CAISSE_VALIDER);
  const [caisses, setCaisses] = useState<Compte[]>([]);
  const [compteId, setCompteId] = useState('');
  const [liste, setListe] = useState<LigneCloture[]>();
  const [comptage, setComptage] = useState<Record<number, number>>({});
  const [montant, setMontant] = useState<number>();
  const [justification, setJustification] = useState('');
  const [demanderJustification, setDemanderJustification] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [erreur, setErreur] = useState<string>();
  const [refus, setRefus] = useState<LigneCloture>();
  const [commentaire, setCommentaire] = useState('');

  const charger = useCallback(() => {
    appeler<LigneCloture[]>('GET', '/clotures').then(setListe).catch((e) => setErreur(messageErreur(e)));
    appeler<Compte[]>('GET', '/tresorerie/comptes')
      .then((c) => {
        const liste = c.filter((x) => x.type === 'caisse');
        setCaisses(liste);
        setCompteId((id) => id || liste[0]?.id || '');
      })
      .catch(() => undefined);
  }, [appeler]);
  useEffect(charger, [charger]);

  const totalBilletage = COUPURES.reduce((t, [v]) => t + v * (comptage[v] || 0), 0);
  const montantCompte = montant ?? totalBilletage;
  const jour = aujourdhuiIso();
  const duJour = liste?.find((c) => c.compteId === compteId && c.jour === jour && c.statut !== 'refusee');

  const saisir = async () => {
    setErreur(undefined);
    setInfo(undefined);
    try {
      const r = await appeler<LigneCloture>('POST', '/clotures', { compteId, montantCompte, justification: justification || null });
      setInfo(r.statut === 'validee' ? 'Caisse clôturée. Une sauvegarde est lancée.' : 'Clôture enregistrée : elle attend la validation du gérant.');
      setComptage({});
      setMontant(undefined);
      setJustification('');
      setDemanderJustification(undefined);
      charger();
    } catch (e) {
      if (e instanceof ErreurApi && e.code === 'ECART_A_JUSTIFIER') setDemanderJustification(e.message);
      else setErreur(messageErreur(e));
    }
  };
  const decider = async (c: LigneCloture, decision: 'valider' | 'refuser') => {
    setErreur(undefined);
    try {
      await appeler('POST', `/clotures/${c.id}/decision`, { decision, commentaire: decision === 'refuser' ? commentaire : null });
      setRefus(undefined);
      setCommentaire('');
      setInfo(decision === 'valider' ? `Clôture du ${formaterJour(c.jour)} validée.` : 'Clôture refusée : le caissier doit recompter.');
      charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  return (
    <>
      <Message type="erreur">{erreur}</Message>
      <Message type="succes">{info}</Message>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, margin: '16px 0', alignItems: 'start' }}>
        <div className="carte">
          <div className="entete-carte">
            <h3>Clôture du {formaterJour(jour)}</h3>
            {caisses.length > 1 && (
              <select value={compteId} onChange={(e) => setCompteId(e.target.value)} style={{ height: 34, borderRadius: 6, border: '1px solid var(--bord)' }}>
                {caisses.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            )}
          </div>
          {duJour ? (
            <div className="corps">
              <Message type={duJour.statut === 'validee' ? 'succes' : 'info'}>
                {duJour.statut === 'validee'
                  ? `Caisse clôturée aujourd’hui : ${formaterMontant(duJour.montantCompte)} comptés.`
                  : `Clôture saisie par ${duJour.saisiePar ?? '?'} (${formaterMontant(duJour.montantCompte)} comptés) : en attente de validation du gérant.`}
              </Message>
            </div>
          ) : (
            <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ color: 'var(--texte-2)' }}>Comptez l’argent de la caisse (facultatif : par billets et pièces), puis enregistrez le total.{!gerant && ' Le montant attendu n’est pas affiché.'}</p>
              <div className="billetage">
                {COUPURES.map(([v, type]) => (
                  <label key={`${v}-${type}`} title={type}>
                    <span>{formaterMontant(v, '')}</span>×
                    <input type="number" min={0} value={comptage[v] ?? ''} placeholder="0" onChange={(e) => (setComptage({ ...comptage, [v]: Math.max(0, Number(e.target.value)) }), setMontant(undefined))} />
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                <div className="champ" style={{ flex: 1 }}>
                  <label htmlFor="montant-compte">Total compté (FCFA)</label>
                  <input id="montant-compte" type="number" min={0} value={montantCompte} onChange={(e) => setMontant(Math.max(0, Number(e.target.value)))} />
                </div>
                <div className="grand-montant">{formaterMontant(montantCompte)}</div>
              </div>
              {demanderJustification && (
                <>
                  <Message type="attention">{demanderJustification}</Message>
                  <div className="champ">
                    <label htmlFor="justif">Raison de l’écart</label>
                    <input id="justif" value={justification} autoFocus onChange={(e) => setJustification(e.target.value)} placeholder="Erreur de rendu de monnaie, billet abîmé…" />
                  </div>
                </>
              )}
              <div className="actions">
                <button className="bouton" disabled={!compteId || (!!demanderJustification && justification.trim().length < 3)} onClick={() => void saisir()}>
                  {gerant ? 'Clôturer la caisse' : 'Enregistrer le comptage'}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="carte">
          <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--texte-2)', lineHeight: 1.5 }}>
            <h3>Comment ça marche</h3>
            <p>1. En fin de journée, le caissier compte l’argent et saisit le total, sans voir le montant attendu.</p>
            <p>2. Si le total ne correspond pas, il recompte ; si l’écart se confirme, il l’explique.</p>
            <p>3. Le gérant valide : l’écart est passé en caisse et une sauvegarde est faite.</p>
          </div>
        </div>
      </div>

      <div className="carte">
        <div className="entete-carte"><h3>Clôtures précédentes</h3></div>
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : liste.length === 0 ? (
          <div className="vide">Aucune clôture.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Jour</th>
                <th>Caisse</th>
                <th className="nombre">Compté</th>
                {gerant && <th className="nombre">Attendu</th>}
                <th className="nombre">Écart</th>
                <th>Statut</th>
                {gerant && <th />}
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => (
                <tr key={c.id}>
                  <td>
                    {formaterJour(c.jour)}
                    <div className="secondaire">{c.saisiePar ?? '-'} · {formaterDateHeure(c.saisieLe)}</div>
                  </td>
                  <td>{c.compte}</td>
                  <td className="nombre">{formaterMontant(c.montantCompte)}</td>
                  {gerant && <td className="nombre">{formaterMontant(c.soldeCalcule)}</td>}
                  <td className="nombre">
                    {c.ecart != null ? (
                      <span style={{ color: c.ecart ? 'var(--danger)' : 'var(--succes)', fontWeight: 600 }}>{c.ecart > 0 ? '+' : ''}{formaterMontant(c.ecart)}</span>
                    ) : c.avecEcart ? (
                      <span className="pastille orange">Écart</span>
                    ) : (
                      <span className="pastille verte">Juste</span>
                    )}
                    {c.justification && <div className="secondaire">{c.justification}</div>}
                  </td>
                  <td>
                    <Statut s={c.statut} />
                    {c.commentaire && <div className="secondaire">{c.commentaire}</div>}
                  </td>
                  {gerant && (
                    <td>
                      {c.statut === 'a_valider' && (
                        <div className="actions-ligne">
                          <button className="bouton secondaire petit" onClick={() => setRefus(c)}>Refuser</button>
                          <button className="bouton petit" onClick={() => void decider(c, 'valider')}>Valider</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {refus && (
        <Modale
          titre={`Refuser la clôture du ${formaterJour(refus.jour)}`}
          onFermer={() => setRefus(undefined)}
          pied={
            <>
              <button className="bouton secondaire" onClick={() => setRefus(undefined)}>Annuler</button>
              <button className="bouton danger" disabled={commentaire.trim().length < 3} onClick={() => void decider(refus, 'refuser')}>Refuser</button>
            </>
          }
        >
          <div className="champ">
            <label htmlFor="commentaire">Pourquoi ? (le caissier devra recompter)</label>
            <input id="commentaire" value={commentaire} autoFocus onChange={(e) => setCommentaire(e.target.value)} />
          </div>
        </Modale>
      )}
    </>
  );
}
