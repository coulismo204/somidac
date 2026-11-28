import { PERMISSIONS, TYPES_COMPTES, TypeCompte } from '@somidac/shared';
import { useEffect, useMemo, useState } from 'react';
import { Message, Modale } from '../../composants/communs';
import { ApercuDocument, DocumentRecu, RecuImprimable, useEntreprise } from '../../composants/Documents';
import { messageErreur, useSession } from '../../contexte';
import { formaterJour, formaterMontant } from '../../format';

export interface Compte {
  id: string;
  nom: string;
  type: TypeCompte;
  reference: string | null;
  actif: boolean;
  solde: number | null;
  soldeInitial: number | null;
  soldeMasque: boolean;
}

export function useComptes() {
  const { appeler } = useSession();
  const [comptes, setComptes] = useState<Compte[]>([]);
  useEffect(() => {
    appeler<Compte[]>('GET', '/tresorerie/comptes').then(setComptes).catch(() => setComptes([]));
  }, [appeler]);
  return comptes;
}

export function ChoixCompte({ comptes, valeur, onChange, id = 'compte' }: { comptes: Compte[]; valeur: string; onChange: (id: string) => void; id?: string }) {
  return (
    <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)}>
      <option value="">- Choisir -</option>
      {(Object.keys(TYPES_COMPTES) as TypeCompte[]).map((t) => {
        const liste = comptes.filter((c) => c.type === t && c.actif);
        return liste.length ? (
          <optgroup key={t} label={TYPES_COMPTES[t]}>
            {liste.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}{c.solde != null ? ` (${formaterMontant(c.solde)})` : ''}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

interface FactureDue {
  id: string;
  numero: string;
  date: string;
  clientId: string;
  client: string;
  totalTTC: number;
  resteDu: number;
}

/**
 * Encaissement (§5.6, R10) : le client règle une ou plusieurs factures, en tout ou en partie.
 * Ouvert depuis la trésorerie, ou depuis une facture (client et facture déjà choisis).
 */
export function Encaissement({ clientId: clientInitial, factureId, onFermer }: { clientId?: string; factureId?: string; onFermer: (paiementId?: string) => void }) {
  const { appeler } = useSession();
  const comptes = useComptes();
  const [factures, setFactures] = useState<FactureDue[]>();
  const [clientId, setClientId] = useState(clientInitial ?? '');
  const [montants, setMontants] = useState<Record<string, number>>({});
  const [compteId, setCompteId] = useState('');
  const [reference, setReference] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    appeler<FactureDue[]>('GET', '/factures?nonSoldees=1')
      .then((f) => {
        setFactures(f);
        if (factureId) {
          const x = f.find((y) => y.id === factureId);
          if (x) setMontants({ [x.id]: x.resteDu });
        }
      })
      .catch((e) => setErreur(messageErreur(e)));
  }, [appeler, factureId]);
  useEffect(() => {
    if (!compteId && comptes.length) setCompteId(comptes.find((c) => c.type === 'caisse' && c.actif)?.id ?? '');
  }, [comptes, compteId]);

  const clients = useMemo(() => [...new Map((factures ?? []).map((f) => [f.clientId, f.client])).entries()], [factures]);
  const duClient = (factures ?? []).filter((f) => f.clientId === clientId);
  const total = duClient.reduce((t, f) => t + (montants[f.id] || 0), 0);
  const compte = comptes.find((c) => c.id === compteId);

  const valider = async () => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      const r = await appeler<{ id: string }>('POST', '/paiements/encaissements', {
        clientId,
        compteId,
        reference: reference || null,
        affectations: duClient.filter((f) => montants[f.id] > 0).map((f) => ({ factureId: f.id, montant: montants[f.id] })),
      });
      onFermer(r.id);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale
      titre="Encaisser un paiement"
      onFermer={() => onFermer()}
      large
      pied={
        <>
          <button className="bouton secondaire" onClick={() => onFermer()}>Annuler</button>
          <button className="bouton" disabled={envoi || !clientId || !compteId || total <= 0} onClick={() => void valider()}>
            Encaisser {total > 0 ? formaterMontant(total) : ''}
          </button>
        </>
      }
    >
      <div className="grille-champs">
        <div className="champ">
          <label htmlFor="client-enc">Client</label>
          <select id="client-enc" value={clientId} disabled={!!clientInitial} onChange={(e) => (setClientId(e.target.value), setMontants({}))}>
            <option value="">- Choisir -</option>
            {clients.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
          </select>
        </div>
        <div className="champ">
          <label htmlFor="compte-enc">Encaissé sur</label>
          <ChoixCompte id="compte-enc" comptes={comptes} valeur={compteId} onChange={setCompteId} />
        </div>
        {compte && compte.type !== 'caisse' && (
          <div className="champ pleine">
            <label htmlFor="ref-enc">{compte.type === 'mobile_money' ? 'N° de transaction Mobile Money' : 'N° de chèque ou de virement'}</label>
            <input id="ref-enc" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}
      </div>
      {!factures ? (
        <div className="vide">Chargement…</div>
      ) : !clientId ? (
        <div className="vide">{clients.length ? 'Choisissez le client.' : 'Aucune facture à encaisser.'}</div>
      ) : (
        <table className="tableau">
          <thead>
            <tr>
              <th>Facture</th>
              <th className="nombre">Total</th>
              <th className="nombre">Reste dû</th>
              <th className="nombre" style={{ width: 160 }}>Montant encaissé</th>
            </tr>
          </thead>
          <tbody>
            {duClient.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className="mono">{f.numero}</span>
                  <div className="secondaire">du {formaterJour(f.date)}</div>
                </td>
                <td className="nombre">{formaterMontant(f.totalTTC)}</td>
                <td className="nombre">{formaterMontant(f.resteDu)}</td>
                <td className="serre">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="nombre" type="number" min={0} max={f.resteDu} value={montants[f.id] ?? ''} placeholder="0" onChange={(e) => setMontants({ ...montants, [f.id]: Math.max(0, Math.min(f.resteDu, Number(e.target.value))) })} />
                    <button className="bouton discret petit" title="Tout le reste dû" onClick={() => setMontants({ ...montants, [f.id]: f.resteDu })}>Tout</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Message type="erreur">{erreur}</Message>
    </Modale>
  );
}

interface PaiementDetail extends RecuImprimable {
  id: string;
  sens: 'client' | 'fournisseur';
  notes: string | null;
  fournisseur: string | null;
  motifAnnulation: string | null;
}

/** Fiche d'un paiement : reçu à imprimer (client) et annulation tracée par le gérant (R7). */
export function FichePaiement({ id, onFermer }: { id: string; onFermer: (modifie: boolean) => void }) {
  const { appeler, peut } = useSession();
  const entreprise = useEntreprise();
  const [p, setP] = useState<PaiementDetail>();
  const [motif, setMotif] = useState('');
  const [annulation, setAnnulation] = useState(false);
  const [recu, setRecu] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [modifie, setModifie] = useState(false);

  const charger = () => appeler<PaiementDetail>('GET', `/paiements/${id}`).then(setP).catch((e) => setErreur(messageErreur(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void charger(), [id]);

  const annuler = async () => {
    setErreur(undefined);
    try {
      await appeler('POST', `/paiements/${id}/annuler`, { motif });
      setAnnulation(false);
      setModifie(true);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  if (recu && p && entreprise) {
    return (
      <ApercuDocument titre={`Reçu ${p.numero}`} nomFichier={`Recu-${p.numero}`} onFermer={() => setRecu(false)}>
        <DocumentRecu r={p} e={entreprise} />
      </ApercuDocument>
    );
  }
  return (
    <Modale
      titre={p ? `Paiement ${p.numero}` : 'Paiement'}
      onFermer={() => onFermer(modifie)}
      large
      pied={
        p && (
          <>
            {p.statut === 'valide' && peut(PERMISSIONS.DOCUMENTS_ANNULER) && (
              <button className="bouton discret" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={() => setAnnulation(true)}>Annuler ce paiement</button>
            )}
            {p.sens === 'client' && <button className="bouton secondaire" onClick={() => setRecu(true)}>Imprimer le reçu</button>}
            <button className="bouton" onClick={() => onFermer(modifie)}>Fermer</button>
          </>
        )
      }
    >
      {!p ? (
        <div className="vide">Chargement…</div>
      ) : (
        <>
          {p.statut === 'annule' && <Message type="attention">Paiement annulé : {p.motifAnnulation}</Message>}
          <div className="grille-cartes">
            <div className="carte indicateur">
              <div className="libelle">{p.sens === 'client' ? 'Reçu de' : 'Versé à'}</div>
              <div className="valeur" style={{ fontSize: 17 }}>{p.client?.raisonSociale ?? p.fournisseur}</div>
              <div className="detail">le {formaterJour(p.date)}{p.par ? ` par ${p.par}` : ''}</div>
            </div>
            <div className="carte indicateur">
              <div className="libelle">Montant</div>
              <div className="valeur">{formaterMontant(p.montant)}</div>
              <div className="detail">{p.compte.nom}{p.reference ? ` · réf. ${p.reference}` : ''}</div>
            </div>
          </div>
          <table className="tableau">
            <thead>
              <tr>
                <th>{p.sens === 'client' ? 'Facture' : 'Achat'}</th>
                <th className="nombre">{p.sens === 'client' ? 'Net à payer' : 'Total'}</th>
                <th className="nombre">Réglé ici</th>
                <th className="nombre">Reste dû aujourd’hui</th>
              </tr>
            </thead>
            <tbody>
              {p.affectations.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.numero}</td>
                  <td className="nombre">{formaterMontant(a.total)}</td>
                  <td className="nombre">{formaterMontant(a.montant)}</td>
                  <td className="nombre">{a.resteDu > 0 ? formaterMontant(a.resteDu) : 'Soldé'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {annulation && (
            <div className="carte" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="champ">
                <label htmlFor="motif-annul">Motif de l’annulation</label>
                <input id="motif-annul" value={motif} autoFocus onChange={(e) => setMotif(e.target.value)} placeholder="Transaction refusée, erreur de montant…" />
              </div>
              <div className="actions">
                <button className="bouton secondaire" onClick={() => setAnnulation(false)}>Garder le paiement</button>
                <button className="bouton danger" disabled={motif.trim().length < 3} onClick={() => void annuler()}>Annuler le paiement</button>
              </div>
            </div>
          )}
          <Message type="erreur">{erreur}</Message>
        </>
      )}
    </Modale>
  );
}
