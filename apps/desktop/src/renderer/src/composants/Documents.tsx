import { montantEnLettres } from '@somidac/shared';
import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { messageErreur, useSession } from '../contexte';
import { formaterJour, formaterMontant, formaterNombre } from '../format';
import logo from '../logo-somidac.jpeg';
import { Message, Modale } from './communs';

/**
 * Documents imprimés (cahier des charges §8) : PDF A4 aux couleurs du logo, imprimables ou
 * enregistrés pour être envoyés par WhatsApp ou e-mail. Le document est affiché en aperçu et
 * recopié dans une zone réservée à l'impression (seule visible sur papier).
 */

export interface Entreprise {
  raisonSociale: string;
  slogan: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  coordonneesBancaires: string | null;
  devise: string;
  tvaActive: boolean;
  tauxTvaPct: number;
}

export function useEntreprise(): Entreprise | undefined {
  const { appeler } = useSession();
  const [e, setE] = useState<Entreprise>();
  useEffect(() => {
    appeler<Entreprise>('GET', '/parametres').then(setE).catch(() => undefined);
  }, [appeler]);
  return e;
}

function ZoneImpression({ children }: { children: ReactNode }) {
  const [cible, setCible] = useState<HTMLElement>();
  useEffect(() => {
    const div = document.createElement('div');
    div.id = 'zone-impression';
    document.body.appendChild(div);
    setCible(div);
    return () => div.remove();
  }, []);
  return cible ? createPortal(children, cible) : null;
}

/** Aperçu d'un document avec « Imprimer » et « Enregistrer en PDF ». */
export function ApercuDocument({ titre, nomFichier, onFermer, children }: { titre: string; nomFichier: string; onFermer: () => void; children: ReactNode }) {
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const agir = async (action: () => Promise<{ ok: true; valeur: string | null | void } | { ok: false; code: string; message: string }>, succes?: (v: string) => string) => {
    setErreur(undefined);
    setInfo(undefined);
    setEnvoi(true);
    try {
      const r = await action();
      if (!r.ok) throw new Error(r.message);
      if (succes && typeof r.valeur === 'string') setInfo(succes(r.valeur));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modale
      titre={titre}
      onFermer={onFermer}
      large
      pied={
        <>
          <button className="bouton secondaire" onClick={onFermer}>Fermer</button>
          <button className="bouton secondaire" disabled={envoi} onClick={() => void agir(() => window.somidac.documents.enregistrerPdf(nomFichier), (f) => `PDF enregistré : ${f}`)}>
            Enregistrer en PDF
          </button>
          <button className="bouton" disabled={envoi} onClick={() => void agir(() => window.somidac.documents.imprimer())}>
            Imprimer
          </button>
        </>
      }
    >
      <Message type="erreur">{erreur}</Message>
      <Message type="succes">{info}</Message>
      <div className="apercu-document">{children}</div>
      <ZoneImpression>{children}</ZoneImpression>
    </Modale>
  );
}

// ------------------------------------------------------------------ éléments communs

interface Tiers {
  libelle: string;
  nom: string;
  code?: string | null;
  adresse?: string | null;
  telephone?: string | null;
  nif?: string | null;
}

function EnTete({ e, titre, numero, date, tiers, references, mention }: { e: Entreprise; titre: string; numero: string; date: string; tiers: Tiers; references?: [string, string | null | undefined][]; mention?: string }) {
  return (
    <>
      <div className="doc-entete">
        <div className="doc-emetteur">
          <img src={logo} alt="" />
          <div>
            <div className="doc-raison">{e.raisonSociale}</div>
            {e.slogan && <div className="doc-slogan">{e.slogan}</div>}
            {e.adresse && <div>{e.adresse}</div>}
            {(e.telephone || e.email) && <div>{[e.telephone && `Tél. ${e.telephone}`, e.email].filter(Boolean).join(' · ')}</div>}
            {(e.nif || e.rccm) && <div>{[e.nif && `NIF ${e.nif}`, e.rccm && `RCCM ${e.rccm}`].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
        <div className="doc-titre">
          <div className="doc-type">{titre}</div>
          <div className="doc-numero">{numero}</div>
          <div>Date : {formaterJour(date)}</div>
          {mention && <div className="doc-mention">{mention}</div>}
        </div>
      </div>
      <div className="doc-bandeau">
        <div className="doc-tiers">
          <div className="doc-libelle">{tiers.libelle}</div>
          <strong>{tiers.nom}</strong>
          {tiers.adresse && <div>{tiers.adresse}</div>}
          {tiers.telephone && <div>Tél. {tiers.telephone}</div>}
          {(tiers.nif || tiers.code) && <div>{[tiers.nif && `NIF ${tiers.nif}`, tiers.code && `Code ${tiers.code}`].filter(Boolean).join(' · ')}</div>}
        </div>
        {references && references.some(([, v]) => v) && (
          <div className="doc-references">
            {references.filter(([, v]) => v).map(([l, v]) => (
              <div key={l}>
                <span>{l}</span> <strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Pied({ e }: { e: Entreprise }) {
  return (
    <div className="doc-pied">
      {e.coordonneesBancaires && <div>Règlement : {e.coordonneesBancaires}</div>}
      <div>
        {e.raisonSociale}
        {e.adresse ? ` · ${e.adresse}` : ''}
        {e.telephone ? ` · ${e.telephone}` : ''}
      </div>
    </div>
  );
}

const pct = (v: number) => (v ? `${v.toLocaleString('fr-FR')} %` : '');
const lot = (l: { numero: string; datePeremption: string | null }) => [l.numero || null, l.datePeremption && `exp. ${formaterJour(l.datePeremption)}`].filter(Boolean).join(' · ');

// ------------------------------------------------------------------ bon de livraison

export interface BlImprimable {
  numero: string | null;
  date: string;
  referenceClient: string | null;
  notes: string | null;
  totalHT: number;
  totalLignes: number;
  remiseGlobalePct: number;
  client: { code: string; raisonSociale: string; adresse: string | null; telephone: string | null; nif: string | null; blSansPrix: boolean };
  lignes: {
    id: string;
    codeProduit: string;
    produit: string;
    conditionnement: string;
    quantite: number;
    quantitePieces: number | null;
    prixUnitaire: number | null;
    remisePct: number;
    montant: number | null;
    lots: { numero: string; datePeremption: string | null; quantite: number }[];
  }[];
}

/** Bon de livraison en deux exemplaires (§5.5), avec ou sans prix selon le client (§8). */
export function DocumentBL({ bl, e }: { bl: BlImprimable; e: Entreprise }) {
  const avecPrix = !bl.client.blSansPrix;
  const exemplaire = (libelle: string) => (
    <div className="doc" key={libelle}>
      <EnTete
        e={e}
        titre="Bon de livraison"
        numero={bl.numero ?? 'BROUILLON'}
        date={bl.date}
        mention={libelle}
        tiers={{ libelle: 'Livré à', nom: bl.client.raisonSociale, code: bl.client.code, adresse: bl.client.adresse, telephone: bl.client.telephone, nif: bl.client.nif }}
        references={[['Commande client', bl.referenceClient]]}
      />
      <table className="doc-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Désignation</th>
            <th>Lot</th>
            <th className="nombre">Qté</th>
            {avecPrix && <th className="nombre">P.U. HT</th>}
            {avecPrix && <th className="nombre">Remise</th>}
            {avecPrix && <th className="nombre">Montant HT</th>}
          </tr>
        </thead>
        <tbody>
          {bl.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.codeProduit}</td>
              <td>
                {l.produit}
                <div className="doc-detail">{l.conditionnement}{l.quantitePieces && l.quantitePieces !== l.quantite ? ` · ${formaterNombre(l.quantitePieces)} pièces` : ''}</div>
              </td>
              <td className="doc-detail">{l.lots.map((x, i) => <div key={i}>{lot(x)}{l.lots.length > 1 ? ` (${x.quantite})` : ''}</div>)}</td>
              <td className="nombre">{formaterNombre(l.quantite)}</td>
              {avecPrix && <td className="nombre">{formaterNombre(l.prixUnitaire)}</td>}
              {avecPrix && <td className="nombre">{pct(l.remisePct)}</td>}
              {avecPrix && <td className="nombre">{formaterNombre(l.montant)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {avecPrix && (
        <div className="doc-totaux">
          {bl.remiseGlobalePct > 0 && (
            <>
              <span>Total des lignes</span><span className="nombre">{formaterMontant(bl.totalLignes, e.devise)}</span>
              <span>Remise {pct(bl.remiseGlobalePct)}</span><span className="nombre">- {formaterMontant(bl.totalLignes - bl.totalHT, e.devise)}</span>
            </>
          )}
          <span className="doc-total">Total HT</span><span className="nombre doc-total">{formaterMontant(bl.totalHT, e.devise)}</span>
        </div>
      )}
      {bl.notes && <p className="doc-notes">{bl.notes}</p>}
      <div className="doc-signatures">
        <div>
          <div className="doc-libelle">Livré par {e.raisonSociale}</div>
          <div className="doc-case">Nom et signature</div>
        </div>
        <div>
          <div className="doc-libelle">Reçu par le client</div>
          <div className="doc-case">Nom, date, signature et cachet</div>
        </div>
      </div>
      <Pied e={e} />
    </div>
  );
  return <>{['Exemplaire client', `Exemplaire ${e.raisonSociale}`].map(exemplaire)}</>;
}

// ------------------------------------------------------------------ facture

export interface FactureImprimable {
  numero: string;
  date: string;
  echeance: string;
  referenceClient: string | null;
  totalLignes: number;
  remiseGlobale: number;
  remiseGlobalePct: number;
  totalHT: number;
  tauxTvaPct: number;
  tva: number;
  totalTTC: number;
  bonLivraison: { numero: string | null; date: string };
  client: { id: string; code: string; raisonSociale: string; adresse: string | null; telephone: string | null; nif: string | null; conditionPaiement: string };
  lignes: { id: string; codeProduit: string; designation: string; conditionnement: string; quantite: number; prixUnitaire: number; remisePct: number; montant: number }[];
}

export function DocumentFacture({ f, e }: { f: FactureImprimable; e: Entreprise }) {
  const avecTva = f.tauxTvaPct > 0;
  return (
    <div className="doc">
      <EnTete
        e={e}
        titre="Facture"
        numero={f.numero}
        date={f.date}
        tiers={{ libelle: 'Facturé à', nom: f.client.raisonSociale, code: f.client.code, adresse: f.client.adresse, telephone: f.client.telephone, nif: f.client.nif }}
        references={[
          ['Bon de livraison', f.bonLivraison.numero ? `${f.bonLivraison.numero} du ${formaterJour(f.bonLivraison.date)}` : null],
          ['Commande client', f.referenceClient],
          ['Échéance', f.echeance !== f.date ? formaterJour(f.echeance) : 'Paiement à la livraison'],
        ]}
      />
      <table className="doc-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Désignation</th>
            <th className="nombre">Qté</th>
            <th className="nombre">P.U. {avecTva ? 'HT' : ''}</th>
            <th className="nombre">Remise</th>
            <th className="nombre">Montant {avecTva ? 'HT' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {f.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.codeProduit}</td>
              <td>
                {l.designation}
                <div className="doc-detail">{l.conditionnement}</div>
              </td>
              <td className="nombre">{formaterNombre(l.quantite)}</td>
              <td className="nombre">{formaterNombre(l.prixUnitaire)}</td>
              <td className="nombre">{pct(l.remisePct)}</td>
              <td className="nombre">{formaterNombre(l.montant)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-totaux">
        {f.remiseGlobale > 0 && (
          <>
            <span>Total des lignes</span><span className="nombre">{formaterMontant(f.totalLignes, e.devise)}</span>
            <span>Remise {pct(f.remiseGlobalePct)}</span><span className="nombre">- {formaterMontant(f.remiseGlobale, e.devise)}</span>
          </>
        )}
        {avecTva ? (
          <>
            <span>Total HT</span><span className="nombre">{formaterMontant(f.totalHT, e.devise)}</span>
            <span>TVA {pct(f.tauxTvaPct)}</span><span className="nombre">{formaterMontant(f.tva, e.devise)}</span>
            <span className="doc-total">Total TTC</span><span className="nombre doc-total">{formaterMontant(f.totalTTC, e.devise)}</span>
          </>
        ) : (
          <>
            <span className="doc-total">Total à payer</span><span className="nombre doc-total">{formaterMontant(f.totalTTC, e.devise)}</span>
          </>
        )}
      </div>
      <p className="doc-lettres">
        Arrêtée la présente facture à la somme de : <strong>{montantEnLettres(f.totalTTC, e.devise)}</strong>.
      </p>
      <Pied e={e} />
    </div>
  );
}

// ------------------------------------------------------------------ avoir

export interface AvoirImprimable {
  numero: string;
  date: string;
  motif: string;
  totalHT: number;
  tva: number;
  totalTTC: number;
  tauxTvaPct: number;
  facture: { numero: string; date: string; referenceClient: string | null };
  client: { code: string; raisonSociale: string; adresse: string | null; telephone: string | null; nif: string | null };
  lignes: { id: string; codeProduit: string; designation: string; conditionnement: string; quantite: number; montant: number; destination: 'stock' | 'casse' }[];
}

export function DocumentAvoir({ a, e }: { a: AvoirImprimable; e: Entreprise }) {
  const avecTva = a.tauxTvaPct > 0;
  return (
    <div className="doc">
      <EnTete
        e={e}
        titre="Avoir"
        numero={a.numero}
        date={a.date}
        tiers={{ libelle: 'Client', nom: a.client.raisonSociale, code: a.client.code, adresse: a.client.adresse, telephone: a.client.telephone, nif: a.client.nif }}
        references={[
          ['Facture d’origine', `${a.facture.numero} du ${formaterJour(a.facture.date)}`],
          ['Commande client', a.facture.referenceClient],
        ]}
      />
      <p className="doc-notes">Motif : {a.motif}</p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Désignation</th>
            <th className="nombre">Qté retournée</th>
            <th className="nombre">Montant {avecTva ? 'HT' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {a.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.codeProduit}</td>
              <td>
                {l.designation}
                <div className="doc-detail">{l.conditionnement}</div>
              </td>
              <td className="nombre">{formaterNombre(l.quantite)}</td>
              <td className="nombre">{formaterNombre(l.montant)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-totaux">
        {avecTva && (
          <>
            <span>Total HT</span><span className="nombre">{formaterMontant(a.totalHT, e.devise)}</span>
            <span>TVA {pct(a.tauxTvaPct)}</span><span className="nombre">{formaterMontant(a.tva, e.devise)}</span>
          </>
        )}
        <span className="doc-total">Montant de l’avoir</span><span className="nombre doc-total">{formaterMontant(a.totalTTC, e.devise)}</span>
      </div>
      <p className="doc-lettres">
        Arrêté le présent avoir à la somme de : <strong>{montantEnLettres(a.totalTTC, e.devise)}</strong>.
      </p>
      <Pied e={e} />
    </div>
  );
}

// ------------------------------------------------------------------ bon de réception (achats)

export interface ReceptionImprimable {
  numero: string | null;
  date: string;
  referenceFournisseur: string | null;
  fournisseur: { nom: string; adresse?: string | null; telephone?: string | null; nif?: string | null };
  lignes: { id: string; codeProduit: string; produit: string; conditionnement: string; quantite: number; quantitePieces: number | null; numeroLot: string | null; datePeremption: string | null }[];
}

export function DocumentBonReception({ r, e }: { r: ReceptionImprimable; e: Entreprise }) {
  return (
    <div className="doc">
      <EnTete
        e={e}
        titre="Bon de réception"
        numero={r.numero ?? 'BROUILLON'}
        date={r.date}
        tiers={{ libelle: 'Fournisseur', nom: r.fournisseur.nom, adresse: r.fournisseur.adresse, telephone: r.fournisseur.telephone, nif: r.fournisseur.nif }}
        references={[['Facture du fournisseur', r.referenceFournisseur]]}
      />
      <table className="doc-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Désignation</th>
            <th>Lot</th>
            <th>Péremption</th>
            <th className="nombre">Qté reçue</th>
            <th className="nombre">Pièces</th>
          </tr>
        </thead>
        <tbody>
          {r.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.codeProduit}</td>
              <td>
                {l.produit}
                <div className="doc-detail">{l.conditionnement}</div>
              </td>
              <td>{l.numeroLot ?? ''}</td>
              <td>{l.datePeremption ? formaterJour(l.datePeremption) : ''}</td>
              <td className="nombre">{formaterNombre(l.quantite)}</td>
              <td className="nombre">{formaterNombre(l.quantitePieces)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-signatures">
        <div>
          <div className="doc-libelle">Réceptionné par</div>
          <div className="doc-case">Nom, date et signature</div>
        </div>
        <div>
          <div className="doc-libelle">Livré par le fournisseur</div>
          <div className="doc-case">Nom et signature</div>
        </div>
      </div>
      <Pied e={e} />
    </div>
  );
}

// ------------------------------------------------------------------ reçu de paiement

export interface RecuImprimable {
  numero: string;
  date: string;
  montant: number;
  reference: string | null;
  statut: 'valide' | 'annule';
  compte: { nom: string; type: 'caisse' | 'mobile_money' | 'banque' };
  par: string | null;
  client: { code: string; raisonSociale: string; adresse: string | null; telephone: string | null; nif: string | null } | null;
  affectations: { id: string; numero: string; date: string; total: number; montant: number; resteDu: number }[];
}

const MODES: Record<string, string> = { caisse: 'Espèces', mobile_money: 'Mobile Money', banque: 'Banque' };

/** Reçu remis au client à chaque encaissement (§8) : montant, mode, factures réglées, reste dû. */
export function DocumentRecu({ r, e }: { r: RecuImprimable; e: Entreprise }) {
  const client = r.client!;
  return (
    <div className="doc">
      <EnTete
        e={e}
        titre="Reçu de paiement"
        numero={r.numero}
        date={r.date}
        mention={r.statut === 'annule' ? 'Annulé' : undefined}
        tiers={{ libelle: 'Reçu de', nom: client.raisonSociale, code: client.code, adresse: client.adresse, telephone: client.telephone, nif: client.nif }}
        references={[
          ['Mode de paiement', `${MODES[r.compte.type]}${r.compte.type === 'caisse' ? '' : ` (${r.compte.nom})`}`],
          ['Référence', r.reference],
          ['Reçu par', r.par],
        ]}
      />
      <div className="doc-recu-montant">
        <span>Montant reçu</span>
        <strong>{formaterMontant(r.montant, e.devise)}</strong>
      </div>
      <p className="doc-lettres">
        Reçu la somme de : <strong>{montantEnLettres(r.montant, e.devise)}</strong>.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Facture réglée</th>
            <th>Date</th>
            <th className="nombre">Net à payer</th>
            <th className="nombre">Payé ici</th>
            <th className="nombre">Reste dû</th>
          </tr>
        </thead>
        <tbody>
          {r.affectations.map((a) => (
            <tr key={a.id}>
              <td>{a.numero}</td>
              <td>{formaterJour(a.date)}</td>
              <td className="nombre">{formaterNombre(a.total)}</td>
              <td className="nombre">{formaterNombre(a.montant)}</td>
              <td className="nombre">{a.resteDu > 0 ? formaterNombre(a.resteDu) : 'Soldée'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="doc-signatures">
        <div>
          <div className="doc-libelle">Pour {e.raisonSociale}</div>
          <div className="doc-case">Signature et cachet</div>
        </div>
        <div />
      </div>
      <Pied e={e} />
    </div>
  );
}
