import { useCallback, useEffect, useState } from 'react';
import { Icone, Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterJour, formaterMontant } from '../../format';
import { EditeurAchat } from './EditeurAchat';
import { Fournisseurs } from './Fournisseurs';

interface LigneAchat {
  id: string;
  numero: string | null;
  date: string;
  statut: 'brouillon' | 'valide' | 'annule';
  fournisseur: string;
  referenceFournisseur: string | null;
  total: number;
  montantPaye: number;
}

export function Achats() {
  const { appeler } = useSession();
  const [onglet, setOnglet] = useState<'achats' | 'fournisseurs'>('achats');
  const [liste, setListe] = useState<LigneAchat[]>();
  const [ouvert, setOuvert] = useState<string | 'nouveau'>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      setListe(await appeler<LigneAchat[]>('GET', '/achats'));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler]);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (ouvert) {
    return (
      <EditeurAchat
        id={ouvert === 'nouveau' ? undefined : ouvert}
        onFermer={(modifie) => {
          setOuvert(undefined);
          if (modifie) void charger();
        }}
      />
    );
  }

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Achats</h1>
          <p>Achats chez les grossistes : à la validation, le stock augmente et le coût de revient est recalculé.</p>
        </div>
        {onglet === 'achats' && (
          <button className="bouton" onClick={() => setOuvert('nouveau')}>
            <Icone nom="plus" /> Nouvel achat
          </button>
        )}
      </div>
      <div className="onglets">
        <button className={onglet === 'achats' ? 'actif' : ''} onClick={() => setOnglet('achats')}>Achats</button>
        <button className={onglet === 'fournisseurs' ? 'actif' : ''} onClick={() => setOnglet('fournisseurs')}>Fournisseurs</button>
      </div>
      {onglet === 'fournisseurs' ? (
        <Fournisseurs />
      ) : (
        <>
          <Message type="erreur">{erreur}</Message>
          <div className="carte">
            {!liste ? (
              <div className="vide">Chargement…</div>
            ) : liste.length === 0 ? (
              <div className="vide">Aucun achat. Créez d'abord vos fournisseurs et vos produits, puis « Nouvel achat ».</div>
            ) : (
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Numéro</th>
                    <th>Date</th>
                    <th>Fournisseur</th>
                    <th>Statut</th>
                    <th className="nombre">Total</th>
                    <th className="nombre">Reste à payer</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.map((a) => (
                    <tr key={a.id} className="cliquable" onClick={() => setOuvert(a.id)}>
                      <td className="mono">{a.numero ?? '—'}</td>
                      <td>{formaterJour(a.date)}</td>
                      <td>
                        {a.fournisseur}
                        {a.referenceFournisseur && <div className="secondaire">Facture {a.referenceFournisseur}</div>}
                      </td>
                      <td>{a.statut === 'valide' ? <span className="pastille verte">Validé</span> : a.statut === 'brouillon' ? <span className="pastille orange">Brouillon</span> : <span className="pastille grise">Annulé</span>}</td>
                      <td className="nombre">{formaterMontant(a.total)}</td>
                      <td className="nombre">{a.statut === 'valide' ? formaterMontant(a.total - a.montantPaye) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
