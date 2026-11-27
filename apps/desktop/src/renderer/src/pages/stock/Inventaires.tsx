import { useCallback, useEffect, useState } from 'react';
import { Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterDateHeure, formaterJour } from '../../format';

interface Inventaire {
  id: string;
  libelle: string;
  statut: 'en_cours' | 'valide' | 'annule';
  creeLe: string;
  valideLe: string | null;
}
interface LigneInventaire {
  id: string;
  produit: string;
  codeProduit: string;
  lotNumero: string;
  datePeremption: string | null;
  quantiteTheorique: number;
  quantiteComptee: number | null;
  ecart: number | null;
}

/** Inventaire (§5.4) : liste à compter, saisie, écarts, validation par le gérant. */
export function Inventaires({ onChangement }: { onChangement: () => void }) {
  const { appeler, peut } = useSession();
  const [liste, setListe] = useState<Inventaire[]>();
  const [ouvert, setOuvert] = useState<(Inventaire & { lignes: LigneInventaire[] }) | undefined>();
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string>();
  const [succes, setSucces] = useState<string>();
  const [confirmer, setConfirmer] = useState(false);

  const charger = useCallback(async () => {
    try {
      setListe(await appeler<Inventaire[]>('GET', '/inventaires'));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = async (id: string) => {
    const d = await appeler<Inventaire & { lignes: LigneInventaire[] }>('GET', `/inventaires/${id}`);
    setOuvert(d);
    setSaisies(Object.fromEntries(d.lignes.map((l) => [l.id, l.quantiteComptee == null ? '' : String(l.quantiteComptee)])));
  };

  const nouveau = async () => {
    setErreur(undefined);
    try {
      const r = await appeler<{ id: string }>('POST', '/inventaires', { libelle: `Inventaire du ${new Intl.DateTimeFormat('fr-FR').format(new Date())}` });
      await charger();
      await ouvrir(r.id);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const enregistrer = async () => {
    if (!ouvert) return;
    setErreur(undefined);
    try {
      await appeler('PUT', `/inventaires/${ouvert.id}/comptages`, {
        comptages: ouvert.lignes.map((l) => ({ ligneId: l.id, quantiteComptee: saisies[l.id] === '' || saisies[l.id] == null ? null : Number(saisies[l.id]) })),
      });
      await ouvrir(ouvert.id);
      setSucces('Comptage enregistré.');
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  };

  const valider = async () => {
    if (!ouvert) return;
    setConfirmer(false);
    if (!(await enregistrer())) return;
    try {
      const r = await appeler<{ nbEcarts: number }>('POST', `/inventaires/${ouvert.id}/valider`);
      setSucces(`Inventaire validé : ${r.nbEcarts} écart(s) appliqué(s) au stock.`);
      setOuvert(undefined);
      await charger();
      onChangement();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const annuler = async () => {
    if (!ouvert) return;
    try {
      await appeler('POST', `/inventaires/${ouvert.id}/annuler`);
      setOuvert(undefined);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  if (ouvert) {
    const enCours = ouvert.statut === 'en_cours';
    return (
      <>
        <div className="barre-outils">
          <button className="bouton secondaire" onClick={() => setOuvert(undefined)}>Retour</button>
          <strong style={{ marginRight: 'auto' }}>{ouvert.libelle}</strong>
          {enCours && <button className="bouton secondaire" onClick={() => void enregistrer()}>Enregistrer le comptage</button>}
          {enCours && peut('inventaire.valider') && <button className="bouton" onClick={() => setConfirmer(true)}>Valider l'inventaire</button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
          <Message type="erreur">{erreur}</Message>
          <Message type="succes">{succes}</Message>
          {enCours && !peut('inventaire.valider') && <Message type="info">Saisissez les quantités comptées ; le gérant validera l'inventaire.</Message>}
        </div>
        <div className="carte">
          <table className="tableau">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Lot</th>
                <th className="nombre">Théorique</th>
                <th className="nombre" style={{ width: 140 }}>Compté</th>
                <th className="nombre">Écart</th>
              </tr>
            </thead>
            <tbody>
              {ouvert.lignes.map((l) => {
                const compte = saisies[l.id];
                const ecart = compte === '' || compte == null ? null : Number(compte) - l.quantiteTheorique;
                return (
                  <tr key={l.id}>
                    <td><strong>{l.produit}</strong><div className="secondaire">{l.codeProduit}</div></td>
                    <td>{l.lotNumero || 'Sans lot'} {l.datePeremption && <span className="secondaire">· {formaterJour(l.datePeremption)}</span>}</td>
                    <td className="nombre">{l.quantiteTheorique}</td>
                    <td className="serre">{enCours ? <input className="nombre" type="number" min={0} value={compte ?? ''} onChange={(e) => setSaisies({ ...saisies, [l.id]: e.target.value })} /> : <span className="nombre">{l.quantiteComptee ?? '—'}</span>}</td>
                    <td className="nombre" style={{ fontWeight: 600, color: ecart ? (ecart < 0 ? 'var(--danger)' : 'var(--succes)') : undefined }}>{ecart == null ? '—' : ecart > 0 ? `+${ecart}` : ecart}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {enCours && peut('inventaire.valider') && (
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="bouton discret" style={{ color: 'var(--danger)' }} onClick={() => void annuler()}>Annuler cet inventaire</button>
          </div>
        )}
        {confirmer && (
          <Modale
            titre="Valider l'inventaire"
            onFermer={() => setConfirmer(false)}
            pied={<><button className="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button><button className="bouton" onClick={() => void valider()}>Valider et corriger le stock</button></>}
          >
            <p style={{ lineHeight: 1.5 }}>Chaque écart devient une correction de stock, tracée dans le journal. Les lignes non comptées restent inchangées.</p>
          </Modale>
        )}
      </>
    );
  }

  return (
    <>
      <div className="barre-outils" style={{ justifyContent: 'flex-end' }}>
        <button className="bouton" onClick={() => void nouveau()}><Icone nom="plus" /> Nouvel inventaire</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Message type="erreur">{erreur}</Message>
        <Message type="succes">{succes}</Message>
      </div>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : liste.length === 0 ? (
          <div className="vide">Aucun inventaire.</div>
        ) : (
          <table className="tableau">
            <thead><tr><th>Inventaire</th><th>Ouvert le</th><th>Statut</th></tr></thead>
            <tbody>
              {liste.map((i) => (
                <tr key={i.id} className="cliquable" onClick={() => void ouvrir(i.id)}>
                  <td><strong>{i.libelle}</strong></td>
                  <td>{formaterDateHeure(i.creeLe)}</td>
                  <td>{i.statut === 'en_cours' ? <span className="pastille orange">En cours</span> : i.statut === 'valide' ? <span className="pastille verte">Validé le {formaterDateHeure(i.valideLe)}</span> : <span className="pastille grise">Annulé</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
