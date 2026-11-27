import { partCumulee, PERMISSIONS } from '@somidac/shared';
import { useCallback, useEffect, useState } from 'react';
import { Message, Modale } from '../../composants/communs';
import { ApercuDocument, AvoirImprimable, DocumentAvoir, DocumentFacture, FactureImprimable, useEntreprise } from '../../composants/Documents';
import { messageErreur, useSession } from '../../contexte';
import { formaterJour, formaterMontant, formaterNombre } from '../../format';

export type StatutPaiement = 'non_payee' | 'partielle' | 'payee' | 'annulee';

export function StatutPaiementPastille({ statut }: { statut: StatutPaiement }) {
  switch (statut) {
    case 'non_payee':
      return <span className="pastille orange">À encaisser</span>;
    case 'partielle':
      return <span className="pastille orange">Partiellement payée</span>;
    case 'payee':
      return <span className="pastille verte">Payée</span>;
    case 'annulee':
      return <span className="pastille grise">Annulée par avoir</span>;
  }
}

interface FactureDetail extends FactureImprimable {
  id: string;
  montantAvoirs: number;
  montantPaye: number;
  resteDu: number;
  statutPaiement: StatutPaiement;
  cout?: number;
  marge?: number;
  lignes: (FactureImprimable['lignes'][number] & { quantiteRetournee: number })[];
  avoirs: { id: string; numero: string; date: string; motif: string; totalTTC: number }[];
}

/** Retour après facture (§5.5) : un avoir, la marchandise revient en stock ou part en casse. */
function NouvelAvoir({ f, onFermer }: { f: FactureDetail; onFermer: (avoirId?: string) => void }) {
  const { appeler } = useSession();
  const [motif, setMotif] = useState('');
  const [saisies, setSaisies] = useState(f.lignes.map(() => ({ quantite: 0, destination: 'stock' as 'stock' | 'casse' })));
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const montantEstime = f.lignes.reduce((t, l, i) => t + partCumulee(l.montant, l.quantite, l.quantiteRetournee, saisies[i].quantite), 0);
  const choisies = saisies.filter((s) => s.quantite > 0).length;

  const valider = async () => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      const r = await appeler<{ id: string }>('POST', `/factures/${f.id}/avoirs`, {
        motif,
        lignes: f.lignes.map((l, i) => ({ factureLigneId: l.id, ...saisies[i] })).filter((l) => l.quantite > 0),
      });
      onFermer(r.id);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  const maj = (i: number, v: Partial<(typeof saisies)[number]>) => setSaisies(saisies.map((s, n) => (n === i ? { ...s, ...v } : s)));

  return (
    <Modale
      titre={`Avoir sur la facture ${f.numero}`}
      onFermer={() => onFermer()}
      large
      pied={
        <>
          <button className="bouton secondaire" onClick={() => onFermer()}>Annuler</button>
          <button
            className="bouton secondaire"
            onClick={() => setSaisies(f.lignes.map((l) => ({ quantite: l.quantite - l.quantiteRetournee, destination: 'stock' })))}
          >
            Tout retourner
          </button>
          <button className="bouton danger" disabled={envoi || choisies === 0 || motif.trim().length < 3} onClick={() => void valider()}>
            Émettre l’avoir
          </button>
        </>
      }
    >
      <div className="champ">
        <label htmlFor="motif-avoir">Motif du retour</label>
        <input id="motif-avoir" value={motif} autoFocus placeholder="Articles abîmés, erreur de facturation…" onChange={(e) => setMotif(e.target.value)} />
      </div>
      <table className="tableau">
        <thead>
          <tr>
            <th>Produit</th>
            <th className="nombre">Facturé</th>
            <th className="nombre" style={{ width: 100 }}>Retourné</th>
            <th style={{ width: 170 }}>La marchandise</th>
          </tr>
        </thead>
        <tbody>
          {f.lignes.map((l, i) => {
            const reste = l.quantite - l.quantiteRetournee;
            return (
              <tr key={l.id}>
                <td>
                  <strong>{l.designation}</strong>
                  <div className="secondaire">{l.conditionnement}{l.quantiteRetournee ? ` · déjà retourné : ${l.quantiteRetournee}` : ''}</div>
                </td>
                <td className="nombre">{formaterNombre(l.quantite)}</td>
                <td className="serre">
                  <input className="nombre" type="number" min={0} max={reste} disabled={reste === 0} value={saisies[i].quantite} onChange={(e) => maj(i, { quantite: Math.max(0, Math.min(reste, Number(e.target.value))) })} />
                </td>
                <td className="serre">
                  <select value={saisies[i].destination} disabled={saisies[i].quantite === 0} onChange={(e) => maj(i, { destination: e.target.value as 'stock' | 'casse' })}>
                    <option value="stock">revient en stock</option>
                    <option value="casse">part en casse</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Montant estimé (hors remise sur le total{f.tauxTvaPct > 0 ? ' et TVA' : ''}) : <strong>{formaterMontant(montantEstime)}</strong>. L’avoir reçoit un numéro définitif et ne pourra plus être modifié.
      </p>
      <Message type="erreur">{erreur}</Message>
    </Modale>
  );
}

export function VueFacture({ id, onFermer, onOuvrirAvoir, onOuvrirLivraison }: { id: string; onFermer: () => void; onOuvrirAvoir: (id: string) => void; onOuvrirLivraison: (id: string) => void }) {
  const { appeler, peut } = useSession();
  const entreprise = useEntreprise();
  const [f, setF] = useState<FactureDetail & { bonLivraison: { id: string } }>();
  const [erreur, setErreur] = useState<string>();
  const [modale, setModale] = useState<'imprimer' | 'avoir'>();

  const charger = useCallback(() => {
    appeler<FactureDetail & { bonLivraison: { id: string } }>('GET', `/factures/${id}`).then(setF).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, id]);
  useEffect(charger, [charger]);

  if (!f) return erreur ? <Message type="erreur">{erreur}</Message> : <div className="vide">Chargement…</div>;
  const avecTva = f.tauxTvaPct > 0;
  const toutRetourne = f.lignes.every((l) => l.quantiteRetournee >= l.quantite);

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Facture {f.numero}</h1>
          <p>
            {f.client.raisonSociale}, le {formaterJour(f.date)} <span style={{ marginLeft: 10 }}><StatutPaiementPastille statut={f.statutPaiement} /></span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="bouton secondaire" onClick={() => setModale('imprimer')}>Imprimer / PDF</button>
          {peut(PERMISSIONS.DOCUMENTS_ANNULER) && !toutRetourne && <button className="bouton secondaire" onClick={() => setModale('avoir')}>Faire un avoir</button>}
          <button className="bouton secondaire" onClick={onFermer}>Retour à la liste</button>
        </div>
      </div>
      <Message type="erreur">{erreur}</Message>

      <div className="grille-cartes" style={{ marginBottom: 16 }}>
        <div className="carte indicateur">
          <div className="libelle">Total {avecTva ? 'TTC' : ''}</div>
          <div className="valeur">{formaterMontant(f.totalTTC)}</div>
          <div className="detail">{avecTva ? `HT ${formaterMontant(f.totalHT)} · TVA ${formaterMontant(f.tva)}` : 'TVA non applicable'}</div>
        </div>
        <div className="carte indicateur">
          <div className="libelle">Reste dû</div>
          <div className="valeur" style={{ color: f.resteDu > 0 ? 'var(--alerte)' : undefined }}>{formaterMontant(f.resteDu)}</div>
          <div className="detail">
            {f.montantAvoirs > 0 ? `Avoirs ${formaterMontant(f.montantAvoirs)} · ` : ''}
            {f.echeance !== f.date ? `échéance le ${formaterJour(f.echeance)}` : 'payable à la livraison'}
          </div>
        </div>
        <button className="carte indicateur" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => onOuvrirLivraison(f.bonLivraison.id)}>
          <div className="libelle">Bon de livraison</div>
          <div className="valeur" style={{ fontSize: 17 }}>{f.bonLivraison.numero}</div>
          <div className="detail">{f.referenceClient ? `Commande ${f.referenceClient}` : `Livré le ${formaterJour(f.bonLivraison.date)}`}</div>
        </button>
        {f.marge != null && (
          <div className="carte indicateur">
            <div className="libelle">Marge brute</div>
            <div className="valeur">{formaterMontant(f.marge)}</div>
            <div className="detail">Coût des marchandises {formaterMontant(f.cout)}</div>
          </div>
        )}
      </div>

      {f.resteDu > 0 && <div style={{ marginBottom: 16 }}><Message type="info">L’encaissement de cette facture se fera avec le module Trésorerie (lot 4).</Message></div>}

      <div className="carte">
        <table className="tableau">
          <thead>
            <tr>
              <th>Produit</th>
              <th className="nombre">Qté</th>
              <th className="nombre">Prix {avecTva ? 'HT' : ''}</th>
              <th className="nombre">Remise</th>
              <th className="nombre">Montant {avecTva ? 'HT' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {f.lignes.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.designation}</strong>
                  <div className="secondaire">{l.codeProduit} · {l.conditionnement}{l.quantiteRetournee ? ` · retourné : ${l.quantiteRetournee}` : ''}</div>
                </td>
                <td className="nombre">{formaterNombre(l.quantite)}</td>
                <td className="nombre">{formaterMontant(l.prixUnitaire)}</td>
                <td className="nombre">{l.remisePct ? `${l.remisePct.toLocaleString('fr-FR')} %` : '-'}</td>
                <td className="nombre">{formaterMontant(l.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totaux">
          {f.remiseGlobale > 0 && (
            <>
              <span>Remise sur le total ({f.remiseGlobalePct.toLocaleString('fr-FR')} %)</span><span className="nombre">- {formaterMontant(f.remiseGlobale)}</span>
            </>
          )}
          <span>Total HT</span><span className="nombre">{formaterMontant(f.totalHT)}</span>
          {avecTva && (
            <>
              <span>TVA {f.tauxTvaPct.toLocaleString('fr-FR')} %</span><span className="nombre">{formaterMontant(f.tva)}</span>
            </>
          )}
          <span className="total">Total {avecTva ? 'TTC' : ''}</span><span className="nombre total">{formaterMontant(f.totalTTC)}</span>
        </div>
      </div>

      {f.avoirs.length > 0 && (
        <div className="carte" style={{ marginTop: 16 }}>
          <div className="entete-carte"><h3>Avoirs</h3></div>
          <table className="tableau">
            <tbody>
              {f.avoirs.map((a) => (
                <tr key={a.id} className="cliquable" onClick={() => onOuvrirAvoir(a.id)}>
                  <td className="mono">{a.numero}</td>
                  <td>{formaterJour(a.date)}</td>
                  <td>{a.motif}</td>
                  <td className="nombre">{formaterMontant(a.totalTTC)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modale === 'imprimer' && entreprise && (
        <ApercuDocument titre={`Facture ${f.numero}`} nomFichier={f.numero} onFermer={() => setModale(undefined)}>
          <DocumentFacture f={f} e={entreprise} />
        </ApercuDocument>
      )}
      {modale === 'avoir' && (
        <NouvelAvoir
          f={f}
          onFermer={(avoirId) => {
            setModale(undefined);
            if (avoirId) onOuvrirAvoir(avoirId);
          }}
        />
      )}
    </>
  );
}

export function VueAvoir({ id, onFermer, onOuvrirFacture }: { id: string; onFermer: () => void; onOuvrirFacture: (id: string) => void }) {
  const { appeler } = useSession();
  const entreprise = useEntreprise();
  const [a, setA] = useState<AvoirImprimable & { id: string; factureId: string }>();
  const [erreur, setErreur] = useState<string>();
  const [imprimer, setImprimer] = useState(false);
  useEffect(() => {
    appeler<AvoirImprimable & { id: string; factureId: string }>('GET', `/avoirs/${id}`).then(setA).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, id]);
  if (!a) return erreur ? <Message type="erreur">{erreur}</Message> : <div className="vide">Chargement…</div>;
  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Avoir {a.numero}</h1>
          <p>{a.client.raisonSociale}, le {formaterJour(a.date)} · {a.motif}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="bouton secondaire" onClick={() => setImprimer(true)}>Imprimer / PDF</button>
          <button className="bouton secondaire" onClick={() => onOuvrirFacture(a.factureId)}>Voir la facture {a.facture.numero}</button>
          <button className="bouton secondaire" onClick={onFermer}>Retour à la liste</button>
        </div>
      </div>
      <div className="carte">
        <table className="tableau">
          <thead>
            <tr>
              <th>Produit</th>
              <th className="nombre">Qté retournée</th>
              <th>Marchandise</th>
              <th className="nombre">Montant</th>
            </tr>
          </thead>
          <tbody>
            {a.lignes.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.designation}</strong>
                  <div className="secondaire">{l.codeProduit} · {l.conditionnement}</div>
                </td>
                <td className="nombre">{formaterNombre(l.quantite)}</td>
                <td>{l.destination === 'stock' ? 'Revenue en stock' : 'Passée en casse'}</td>
                <td className="nombre">{formaterMontant(l.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totaux">
          {a.tauxTvaPct > 0 && (
            <>
              <span>Total HT</span><span className="nombre">{formaterMontant(a.totalHT)}</span>
              <span>TVA</span><span className="nombre">{formaterMontant(a.tva)}</span>
            </>
          )}
          <span className="total">Montant de l’avoir</span><span className="nombre total">{formaterMontant(a.totalTTC)}</span>
        </div>
      </div>
      {imprimer && entreprise && (
        <ApercuDocument titre={`Avoir ${a.numero}`} nomFichier={a.numero} onFermer={() => setImprimer(false)}>
          <DocumentAvoir a={a} e={entreprise} />
        </ApercuDocument>
      )}
    </>
  );
}
