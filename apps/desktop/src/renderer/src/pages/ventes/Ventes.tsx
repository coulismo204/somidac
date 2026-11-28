import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Icone, Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterJour, formaterMontant } from '../../format';
import { Clients } from './Clients';
import { EditeurLivraison, StatutLivraison, StatutLivraisonPastille } from './EditeurLivraison';
import { StatutPaiement, StatutPaiementPastille, VueAvoir, VueFacture } from './VueFacture';

interface LigneLivraison {
  id: string;
  numero: string | null;
  date: string;
  statut: StatutLivraison;
  client: string;
  referenceClient: string | null;
  totalHT: number;
  nbLignes: number;
  factureNumero: string | null;
}
interface LigneFacture {
  id: string;
  numero: string;
  date: string;
  client: string;
  blNumero: string | null;
  referenceClient: string | null;
  totalTTC: number;
  resteDu: number;
  statutPaiement: StatutPaiement;
}
interface LigneAvoir {
  id: string;
  numero: string;
  date: string;
  client: string;
  factureNumero: string;
  motif: string;
  totalTTC: number;
}

type Onglet = 'livraisons' | 'factures' | 'avoirs' | 'clients';
type Ouvert = { type: 'livraison'; id?: string } | { type: 'facture'; id: string } | { type: 'avoir'; id: string };

function Liste<T>({ appel, vide, children }: { appel: string; vide: string; children: (liste: T[]) => React.ReactNode }) {
  const { appeler } = useSession();
  const [liste, setListe] = useState<T[]>();
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<T[]>('GET', appel).then(setListe).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, appel]);
  useEffect(charger, [charger]);
  return (
    <>
      <Message type="erreur">{erreur}</Message>
      <div className="carte">{!liste ? <div className="vide">Chargement…</div> : liste.length === 0 ? <div className="vide">{vide}</div> : children(liste)}</div>
    </>
  );
}

/** Module « Ventes » (§5.5) : livraisons, factures, avoirs et clients. */
export function Ventes() {
  const [onglet, setOnglet] = useState<Onglet>('livraisons');
  const [ouvert, setOuvert] = useState<Ouvert>();
  const [version, setVersion] = useState(0);
  // Un clic sur « Ventes » dans le menu ramène à la liste, même depuis un document ouvert.
  const { key } = useLocation();
  useEffect(() => setOuvert(undefined), [key]);
  const fermer = () => {
    setOuvert(undefined);
    setVersion((v) => v + 1);
  };

  if (ouvert?.type === 'livraison') {
    return <EditeurLivraison key={ouvert.id ?? 'nouveau'} id={ouvert.id} onFermer={fermer} onOuvrirFacture={(id) => setOuvert({ type: 'facture', id })} />;
  }
  if (ouvert?.type === 'facture') {
    return (
      <VueFacture
        key={ouvert.id}
        id={ouvert.id}
        onFermer={fermer}
        onOuvrirAvoir={(id) => setOuvert({ type: 'avoir', id })}
        onOuvrirLivraison={(id) => setOuvert({ type: 'livraison', id })}
      />
    );
  }
  if (ouvert?.type === 'avoir') {
    return <VueAvoir key={ouvert.id} id={ouvert.id} onFermer={fermer} onOuvrirFacture={(id) => setOuvert({ type: 'facture', id })} />;
  }

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Ventes</h1>
        </div>
        {onglet === 'livraisons' && (
          <button className="bouton" onClick={() => setOuvert({ type: 'livraison' })}>
            <Icone nom="plus" /> Nouveau bon de livraison
          </button>
        )}
      </div>
      <div className="onglets">
        {(
          [
            ['livraisons', 'Bons de livraison'],
            ['factures', 'Factures'],
            ['avoirs', 'Avoirs'],
            ['clients', 'Clients'],
          ] as [Onglet, string][]
        ).map(([o, l]) => (
          <button key={o} className={onglet === o ? 'actif' : ''} onClick={() => setOnglet(o)}>{l}</button>
        ))}
      </div>

      {onglet === 'clients' && <Clients />}

      {onglet === 'livraisons' && (
        <Liste<LigneLivraison> key={version} appel="/livraisons" vide="Aucun bon de livraison. Créez d'abord vos clients, puis « Nouveau bon de livraison ».">
          {(liste) => (
            <table className="tableau">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Statut</th>
                  <th className="nombre">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((b) => (
                  <tr key={b.id} className="cliquable" onClick={() => setOuvert({ type: 'livraison', id: b.id })}>
                    <td className="mono">{b.numero ?? '-'}</td>
                    <td>{formaterJour(b.date)}</td>
                    <td>
                      {b.client}
                      <div className="secondaire">
                        {b.nbLignes} produit{b.nbLignes > 1 ? 's' : ''}
                        {b.referenceClient ? ` · commande ${b.referenceClient}` : ''}
                      </div>
                    </td>
                    <td>
                      <StatutLivraisonPastille statut={b.statut} />
                      {b.factureNumero && <div className="secondaire">{b.factureNumero}</div>}
                    </td>
                    <td className="nombre">{formaterMontant(b.totalHT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Liste>
      )}

      {onglet === 'factures' && (
        <Liste<LigneFacture> key={version} appel="/factures" vide="Aucune facture. Une facture s'établit depuis un bon de livraison réceptionné.">
          {(liste) => (
            <table className="tableau">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Paiement</th>
                  <th className="nombre">Total</th>
                  <th className="nombre">Reste dû</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((f) => (
                  <tr key={f.id} className="cliquable" onClick={() => setOuvert({ type: 'facture', id: f.id })}>
                    <td className="mono">{f.numero}</td>
                    <td>{formaterJour(f.date)}</td>
                    <td>
                      {f.client}
                      <div className="secondaire">{[f.blNumero, f.referenceClient && `commande ${f.referenceClient}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td><StatutPaiementPastille statut={f.statutPaiement} /></td>
                    <td className="nombre">{formaterMontant(f.totalTTC)}</td>
                    <td className="nombre">{f.resteDu > 0 ? <strong>{formaterMontant(f.resteDu)}</strong> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Liste>
      )}

      {onglet === 'avoirs' && (
        <Liste<LigneAvoir> key={version} appel="/avoirs" vide="Aucun avoir.">
          {(liste) => (
            <table className="tableau">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Motif</th>
                  <th className="nombre">Montant</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((a) => (
                  <tr key={a.id} className="cliquable" onClick={() => setOuvert({ type: 'avoir', id: a.id })}>
                    <td className="mono">{a.numero}</td>
                    <td>{formaterJour(a.date)}</td>
                    <td>
                      {a.client}
                      <div className="secondaire">Facture {a.factureNumero}</div>
                    </td>
                    <td>{a.motif}</td>
                    <td className="nombre">{formaterMontant(a.totalTTC)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Liste>
      )}
    </>
  );
}
