import { calculerTotaux, montantLigne, PERMISSIONS, pctVersBp } from '@somidac/shared';
import { useEffect, useMemo, useState } from 'react';
import { Icone, Message, Modale } from '../../composants/communs';
import { ApercuDocument, BlImprimable, DocumentBL, useEntreprise } from '../../composants/Documents';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant, formaterNombre } from '../../format';
import type { Produit } from '../produits/FicheProduit';
import type { Client } from './Clients';

interface LigneSaisie {
  produitId: string;
  conditionnementId: string;
  quantite: number;
  remisePct: number;
}

export type StatutLivraison = 'brouillon' | 'livre' | 'receptionne' | 'facture' | 'retourne';

interface LivraisonDetail extends BlImprimable {
  id: string;
  statut: StatutLivraison;
  clientId: string;
  facture: { id: string; numero: string } | null;
  coutTotal?: number;
  lignes: (BlImprimable['lignes'][number] & {
    produitId: string;
    conditionnementId: string;
    nbPieces: number;
    suiviLot: boolean;
    stockDisponible: number;
    quantiteAcceptee: number | null;
    motifRefus: string | null;
    coutPiece?: number;
    lots: { numero: string; datePeremption: string | null; quantite: number; quantiteRetournee: number }[];
  })[];
}

export function StatutLivraisonPastille({ statut }: { statut: StatutLivraison }) {
  switch (statut) {
    case 'brouillon':
      return <span className="pastille orange">Brouillon</span>;
    case 'livre':
      return <span className="pastille bleue">Livré, réception à saisir</span>;
    case 'receptionne':
      return <span className="pastille bleue">Réceptionné, à facturer</span>;
    case 'facture':
      return <span className="pastille verte">Facturé</span>;
    case 'retourne':
      return <span className="pastille grise">Tout refusé</span>;
  }
}

/** Réception chez le client (§5.5) : quantités réellement acceptées, motif des refus. */
function Reception({ bl, onFermer }: { bl: LivraisonDetail; onFermer: (fait: boolean) => void }) {
  const { appeler } = useSession();
  const [saisies, setSaisies] = useState(bl.lignes.map((l) => ({ ligneId: l.id, quantiteAcceptee: l.quantite, motifRefus: '' })));
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const refus = saisies.reduce((t, s, i) => t + (bl.lignes[i].quantite - s.quantiteAcceptee), 0);
  const valider = async () => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      await appeler('POST', `/livraisons/${bl.id}/reception`, { lignes: saisies.map((s) => ({ ...s, motifRefus: s.motifRefus || null })) });
      onFermer(true);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  const maj = (i: number, champ: 'quantiteAcceptee' | 'motifRefus', v: string | number) => setSaisies(saisies.map((s, n) => (n === i ? { ...s, [champ]: v } : s)));
  return (
    <Modale
      titre={`Réception du ${bl.numero}`}
      onFermer={() => onFermer(false)}
      large
      pied={
        <>
          <button className="bouton secondaire" onClick={() => onFermer(false)}>Annuler</button>
          <button className="bouton" disabled={envoi} onClick={() => void valider()}>
            {refus > 0 ? 'Enregistrer (les refus reviennent en stock)' : 'Tout a été accepté'}
          </button>
        </>
      }
    >
      <p style={{ lineHeight: 1.5 }}>Indiquez ce que le client a réellement accepté. Les articles refusés (casse, date courte…) reviennent en stock ; la facture portera sur les quantités acceptées.</p>
      <table className="tableau">
        <thead>
          <tr>
            <th>Produit</th>
            <th className="nombre">Livré</th>
            <th className="nombre" style={{ width: 110 }}>Accepté</th>
            <th style={{ width: 220 }}>Motif du refus</th>
          </tr>
        </thead>
        <tbody>
          {bl.lignes.map((l, i) => (
            <tr key={l.id}>
              <td>
                <strong>{l.produit}</strong>
                <div className="secondaire">{l.conditionnement}</div>
              </td>
              <td className="nombre">{formaterNombre(l.quantite)}</td>
              <td className="serre">
                <input className="nombre" type="number" min={0} max={l.quantite} value={saisies[i].quantiteAcceptee} onChange={(e) => maj(i, 'quantiteAcceptee', Math.max(0, Math.min(l.quantite, Number(e.target.value))))} />
              </td>
              <td className="serre">
                {saisies[i].quantiteAcceptee < l.quantite ? (
                  <input value={saisies[i].motifRefus} placeholder="Casse, date courte…" onChange={(e) => maj(i, 'motifRefus', e.target.value)} />
                ) : (
                  <span className="secondaire">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Message type="erreur">{erreur}</Message>
    </Modale>
  );
}

/** Bon de livraison (§5.5) : brouillon, validation (le stock sort), réception, facture. */
export function EditeurLivraison({ id, onFermer, onOuvrirFacture }: { id?: string; onFermer: (modifie: boolean) => void; onOuvrirFacture: (id: string) => void }) {
  const { appeler, peut, profil } = useSession();
  const entreprise = useEntreprise();
  const [clients, setClients] = useState<Client[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [prixClient, setPrixClient] = useState<Map<string, number>>(new Map());
  const [detail, setDetail] = useState<LivraisonDetail>();
  const [entete, setEntete] = useState({ clientId: '', date: aujourdhuiIso(), referenceClient: '', notes: '', remiseGlobalePct: 0 });
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [ajout, setAjout] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const [modale, setModale] = useState<'valider' | 'reception' | 'imprimer'>();
  const [idCourant, setIdCourant] = useState(id);
  const peutRemise = peut(PERMISSIONS.REMISES_ACCORDER) || peut(PERMISSIONS.REMISES_SANS_LIMITE);

  const chargerDetail = async (bl: string) => {
    const d = await appeler<LivraisonDetail>('GET', `/livraisons/${bl}`);
    setDetail(d);
    setEntete({ clientId: d.clientId, date: d.date, referenceClient: d.referenceClient ?? '', notes: d.notes ?? '', remiseGlobalePct: d.remiseGlobalePct });
    setLignes(d.lignes.map((l) => ({ produitId: l.produitId, conditionnementId: l.conditionnementId, quantite: l.quantite, remisePct: l.remisePct })));
  };

  useEffect(() => {
    void (async () => {
      const [c, p] = await Promise.all([appeler<Client[]>('GET', '/clients'), appeler<Produit[]>('GET', '/produits')]);
      setClients(c);
      setProduits(p);
      if (id) await chargerDetail(id);
    })().catch((e) => setErreur(messageErreur(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appeler, id]);

  // Prix particuliers du client choisi (R3), pour l'aperçu pendant la saisie.
  useEffect(() => {
    if (!entete.clientId) return setPrixClient(new Map());
    appeler<{ prix: { conditionnementId: string; prix: number }[] }>('GET', `/clients/${entete.clientId}`)
      .then((c) => setPrixClient(new Map(c.prix.map((p) => [p.conditionnementId, p.prix]))))
      .catch(() => setPrixClient(new Map()));
  }, [appeler, entete.clientId]);

  const brouillon = !detail || detail.statut === 'brouillon';
  const produit = (pid: string) => produits.find((p) => p.id === pid);
  const prixDe = (l: LigneSaisie): number | null => {
    if (prixClient.has(l.conditionnementId)) return prixClient.get(l.conditionnementId)!;
    return produit(l.produitId)?.conditionnements.find((c) => c.id === l.conditionnementId)?.prixVente ?? null;
  };
  const montants = lignes.map((l) => {
    const p = prixDe(l);
    return p == null ? 0 : montantLigne(Number(l.quantite) || 0, p, pctVersBp(Number(l.remisePct) || 0));
  });
  const totaux = brouillon
    ? calculerTotaux(montants, pctVersBp(Number(entete.remiseGlobalePct) || 0), 0)
    : { totalLignes: detail!.totalLignes, remiseGlobale: detail!.totalLignes - detail!.totalHT, totalHT: detail!.totalHT };
  const piecesParProduit = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lignes) {
      const c = produit(l.produitId)?.conditionnements.find((x) => x.id === l.conditionnementId);
      m.set(l.produitId, (m.get(l.produitId) ?? 0) + (Number(l.quantite) || 0) * (c?.nbPieces ?? 1));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, produits]);
  const sansPrix = brouillon && lignes.some((l) => prixDe(l) == null);
  const manque = brouillon && [...piecesParProduit].some(([pid, q]) => (produit(pid)?.stock ?? 0) < q);

  const ajouterProduit = (texte: string) => {
    const brut = texte.trim();
    const t = brut.toLowerCase();
    if (!t) return;
    const trouve =
      produits.find((p) => p.codesBarres.some((c) => c.code === brut)) ??
      produits.find((p) => p.code.toLowerCase() === t) ??
      produits.find((p) => `${p.code} - ${p.designation}`.toLowerCase() === t) ??
      produits.find((p) => p.designation.toLowerCase() === t);
    if (!trouve) return;
    const parCode = trouve.codesBarres.find((c) => c.code === brut)?.conditionnementId;
    const actifs = trouve.conditionnements.filter((c) => c.actif);
    const cond = actifs.find((c) => c.id === parCode) ?? actifs[actifs.length - 1];
    // Un même produit scanné deux fois dans le même conditionnement : on augmente la quantité.
    const existante = lignes.findIndex((l) => l.produitId === trouve.id && l.conditionnementId === cond.id);
    if (existante >= 0) setLignes(lignes.map((l, i) => (i === existante ? { ...l, quantite: Number(l.quantite) + 1 } : l)));
    else setLignes([...lignes, { produitId: trouve.id, conditionnementId: cond.id, quantite: 1, remisePct: 0 }]);
    setAjout('');
  };
  const majLigne = (i: number, champ: keyof LigneSaisie, valeur: unknown) => setLignes(lignes.map((l, n) => (n === i ? { ...l, [champ]: valeur } : l)));

  const corps = () => ({
    clientId: entete.clientId,
    date: entete.date,
    referenceClient: entete.referenceClient || null,
    notes: entete.notes || null,
    remiseGlobalePct: Number(entete.remiseGlobalePct) || 0,
    lignes: lignes.map((l) => ({ ...l, quantite: Number(l.quantite), remisePct: Number(l.remisePct) || 0 })),
  });

  const executer = async (action: () => Promise<void>) => {
    setErreur(undefined);
    setInfo(undefined);
    setEnvoi(true);
    try {
      await action();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  const enregistrer = async (): Promise<string> => {
    if (idCourant) {
      await appeler('PUT', `/livraisons/${idCourant}`, corps());
      return idCourant;
    }
    const r = await appeler<{ id: string }>('POST', '/livraisons', corps());
    setIdCourant(r.id);
    return r.id;
  };

  const valider = () =>
    executer(async () => {
      setModale(undefined);
      const bl = await enregistrer();
      const r = await appeler<{ numero: string }>('POST', `/livraisons/${bl}/valider`);
      await chargerDetail(bl);
      setInfo(`Bon ${r.numero} validé : le stock est sorti. Imprimez-le en deux exemplaires pour la livraison.`);
      setModale('imprimer');
    });

  const facturer = () =>
    executer(async () => {
      const r = await appeler<{ id: string }>('POST', `/livraisons/${detail!.id}/facturer`);
      onOuvrirFacture(r.id);
    });

  const supprimer = () =>
    executer(async () => {
      if (idCourant) await appeler('DELETE', `/livraisons/${idCourant}`);
      onFermer(true);
    });

  const client = clients.find((c) => c.id === entete.clientId);
  const colonnes = 7 + (peutRemise || !brouillon ? 1 : 0);

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>{detail?.numero ?? (idCourant ? 'Bon de livraison (brouillon)' : 'Nouveau bon de livraison')}</h1>
          <p>
            {brouillon ? 'Préparez les produits : le stock ne sort qu’à la validation.' : `${detail?.client.raisonSociale}, le ${formaterJour(detail?.date)}`}
            {detail && !brouillon && <span style={{ marginLeft: 10 }}><StatutLivraisonPastille statut={detail.statut} /></span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {detail && !brouillon && <button className="bouton secondaire" onClick={() => setModale('imprimer')}>Imprimer le bon</button>}
          {detail?.statut === 'livre' && <button className="bouton" onClick={() => setModale('reception')}>Saisir la réception</button>}
          {detail?.statut === 'receptionne' && <button className="bouton" disabled={envoi} onClick={() => void facturer()}>Établir la facture</button>}
          {detail?.facture && <button className="bouton" onClick={() => onOuvrirFacture(detail.facture!.id)}>Voir la facture {detail.facture.numero}</button>}
          {brouillon && idCourant && (
            <button className="bouton discret" style={{ color: 'var(--danger)' }} disabled={envoi} onClick={() => void supprimer()}>Supprimer le brouillon</button>
          )}
          <button className="bouton secondaire" onClick={() => onFermer(!!idCourant)}>Retour à la liste</button>
        </div>
      </div>
      <Message type="erreur">{erreur}</Message>
      <Message type="succes">{info}</Message>

      <div className="carte" style={{ marginTop: erreur || info ? 16 : 0 }}>
        <div className="corps grille-champs" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
          <div className="champ">
            <label htmlFor="client">Client</label>
            <select id="client" value={entete.clientId} disabled={!brouillon} onChange={(e) => setEntete({ ...entete, clientId: e.target.value })}>
              <option value="">- Choisir -</option>
              {clients.filter((c) => c.actif || c.id === entete.clientId).map((c) => <option key={c.id} value={c.id}>{c.raisonSociale}</option>)}
            </select>
          </div>
          <div className="champ">
            <label htmlFor="date">Date de livraison</label>
            <input id="date" type="date" value={entete.date} disabled={!brouillon} onChange={(e) => setEntete({ ...entete, date: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor="ref">N° de commande du client</label>
            <input id="ref" value={entete.referenceClient} disabled={!brouillon} placeholder="Bon de commande Bon Prix…" onChange={(e) => setEntete({ ...entete, referenceClient: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="carte" style={{ marginTop: 16 }}>
        <div className="entete-carte">
          <h3>Produits livrés</h3>
          {brouillon && (
            <div style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 520 }}>
              <input
                list="liste-produits-vente"
                className="recherche"
                style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--bord)' }}
                placeholder="Ajouter : scannez ou tapez le nom du produit"
                value={ajout}
                autoFocus={!id}
                onChange={(e) => {
                  setAjout(e.target.value);
                  if (produits.some((p) => `${p.code} - ${p.designation}` === e.target.value)) ajouterProduit(e.target.value);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), ajouterProduit(ajout))}
              />
              <datalist id="liste-produits-vente">{produits.map((p) => <option key={p.id} value={`${p.code} - ${p.designation}`} />)}</datalist>
            </div>
          )}
        </div>
        {lignes.length === 0 ? (
          <div className="vide">Ajoutez les produits de la commande.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Produit</th>
                <th style={{ width: 150 }}>Conditionnement</th>
                <th style={{ width: 90 }} className="nombre">Qté</th>
                {!brouillon && <th style={{ width: 90 }} className="nombre">Acceptée</th>}
                <th style={{ width: 120 }} className="nombre">Prix HT</th>
                {(peutRemise || !brouillon) && <th style={{ width: 90 }} className="nombre">Remise %</th>}
                <th style={{ width: 130 }} className="nombre">Montant HT</th>
                {brouillon && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const p = produit(l.produitId);
                const cond = p?.conditionnements.find((c) => c.id === l.conditionnementId);
                const valide = detail?.lignes[i];
                const prix = brouillon ? prixDe(l) : valide?.prixUnitaire ?? null;
                const pieces = piecesParProduit.get(l.produitId) ?? 0;
                return [
                  <tr key={i}>
                    <td>
                      <strong>{p?.designation ?? valide?.produit}</strong>
                      <div className="secondaire">
                        {p?.code ?? valide?.codeProduit}
                        {brouillon && p && (
                          <span style={{ color: p.stock < pieces ? 'var(--danger)' : undefined }}> · {formaterNombre(p.stock)} pièce(s) en stock</span>
                        )}
                      </div>
                    </td>
                    <td className="serre">
                      <select value={l.conditionnementId} disabled={!brouillon} onChange={(e) => majLigne(i, 'conditionnementId', e.target.value)}>
                        {(p?.conditionnements ?? []).filter((c) => c.actif || c.id === l.conditionnementId).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        {!p && <option value={l.conditionnementId}>{valide?.conditionnement}</option>}
                      </select>
                    </td>
                    <td className="serre"><input className="nombre" type="number" min={1} value={l.quantite} disabled={!brouillon} onChange={(e) => majLigne(i, 'quantite', Number(e.target.value))} /></td>
                    {!brouillon && (
                      <td className="nombre" style={{ color: valide?.quantiteAcceptee != null && valide.quantiteAcceptee < l.quantite ? 'var(--danger)' : undefined }}>
                        {valide?.quantiteAcceptee ?? '-'}
                      </td>
                    )}
                    <td className="nombre">
                      {prix == null ? <span style={{ color: 'var(--danger)' }} title="Fixez le prix dans la fiche produit">Sans prix</span> : formaterMontant(prix)}
                      {brouillon && prixClient.has(l.conditionnementId) && <div className="secondaire">prix du client</div>}
                    </td>
                    {(peutRemise || !brouillon) && (
                      <td className="serre">
                        {brouillon ? (
                          <input className="nombre" type="number" min={0} max={100} step={0.5} value={l.remisePct} onChange={(e) => majLigne(i, 'remisePct', Number(e.target.value))} />
                        ) : (
                          <span className="nombre" style={{ display: 'block' }}>{l.remisePct ? `${l.remisePct.toLocaleString('fr-FR')} %` : '-'}</span>
                        )}
                      </td>
                    )}
                    <td className="nombre">{formaterMontant(brouillon ? montants[i] : valide?.montant)}</td>
                    {brouillon && (
                      <td className="serre">
                        <button className="bouton discret petit" onClick={() => setLignes(lignes.filter((_, n) => n !== i))} aria-label="Retirer"><Icone nom="fermer" taille={14} /></button>
                      </td>
                    )}
                  </tr>,
                  brouillon && cond && cond.nbPieces > 1 ? (
                    <tr key={`${i}-p`} className="sous-ligne"><td colSpan={colonnes}>= {formaterNombre(l.quantite * cond.nbPieces)} pièces</td></tr>
                  ) : null,
                  !brouillon && valide ? (
                    <tr key={`${i}-v`} className="sous-ligne">
                      <td colSpan={colonnes}>
                        {formaterNombre(valide.quantitePieces)} pièces
                        {valide.lots.some((x) => x.numero)
                          ? ` · lot${valide.lots.length > 1 ? 's' : ''} ` + valide.lots.map((x) => `${x.numero || 'sans lot'}${x.datePeremption ? ` (exp. ${formaterJour(x.datePeremption)})` : ''} : ${x.quantite}`).join(', ')
                          : ''}
                        {valide.motifRefus ? ` · refus : ${valide.motifRefus}` : ''}
                        {valide.coutPiece != null ? ` · coût ${formaterMontant(valide.coutPiece)} la pièce` : ''}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div className="carte">
          <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="champ">
              <label htmlFor="notes">Notes (imprimées sur le bon)</label>
              <textarea id="notes" value={entete.notes} disabled={!brouillon} onChange={(e) => setEntete({ ...entete, notes: e.target.value })} />
            </div>
            {client?.blSansPrix && <Message type="info">Ce client reçoit ses bons de livraison sans les prix.</Message>}
            {brouillon && peutRemise && !peut(PERMISSIONS.REMISES_SANS_LIMITE) && (
              <p className="secondaire" style={{ color: 'var(--texte-3)', fontSize: 12 }}>Votre plafond de remise : {profil?.plafondRemisePct ?? 0} %.</p>
            )}
          </div>
        </div>
        <div className="carte">
          <div className="totaux">
            <span>Total des lignes</span><span className="nombre">{formaterMontant(totaux.totalLignes)}</span>
            {(peutRemise && brouillon) || totaux.remiseGlobale > 0 ? (
              <>
                <span>
                  Remise sur le total{' '}
                  {brouillon ? (
                    <input type="number" min={0} max={100} step={0.5} className="nombre" style={{ width: 70, height: 30, borderRadius: 6, border: '1px solid var(--bord)', padding: '0 6px', textAlign: 'right' }} value={entete.remiseGlobalePct} onChange={(e) => setEntete({ ...entete, remiseGlobalePct: Number(e.target.value) })} />
                  ) : (
                    `${entete.remiseGlobalePct.toLocaleString('fr-FR')}`
                  )}{' '}
                  %
                </span>
                <span className="nombre">- {formaterMontant(totaux.remiseGlobale)}</span>
              </>
            ) : null}
            <span className="total">Total HT</span><span className="nombre total">{formaterMontant(totaux.totalHT)}</span>
            {detail?.coutTotal != null && (
              <>
                <span>Coût des marchandises</span><span className="nombre">{formaterMontant(detail.coutTotal)}</span>
                <span>Marge brute</span><span className="nombre"><strong>{formaterMontant(detail.totalHT - detail.coutTotal)}</strong></span>
              </>
            )}
          </div>
          {brouillon && (
            <>
              {(sansPrix || manque) && (
                <div style={{ padding: '0 20px 12px' }}>
                  <Message type="attention">
                    {sansPrix ? 'Certains produits n’ont pas de prix de vente. ' : ''}
                    {manque ? 'Le stock affiché ne suffit pas pour certains produits.' : ''}
                  </Message>
                </div>
              )}
              <div className="pied-modale" style={{ borderTop: '1px solid var(--bord)' }}>
                <button className="bouton secondaire" disabled={envoi || !entete.clientId} onClick={() => void executer(async () => { await enregistrer(); setInfo('Brouillon enregistré.'); })}>Enregistrer le brouillon</button>
                <button className="bouton" disabled={envoi || !entete.clientId || lignes.length === 0} onClick={() => setModale('valider')}>Valider la livraison</button>
              </div>
            </>
          )}
        </div>
      </div>

      {modale === 'valider' && (
        <Modale
          titre="Valider la livraison"
          onFermer={() => setModale(undefined)}
          pied={
            <>
              <button className="bouton secondaire" onClick={() => setModale(undefined)}>Annuler</button>
              <button className="bouton" onClick={() => void valider()}>Valider et sortir le stock</button>
            </>
          }
        >
          <p style={{ lineHeight: 1.5 }}>
            {formaterNombre([...piecesParProduit.values()].reduce((t, q) => t + q, 0))} pièces vont sortir du stock, en commençant par les lots qui périment le plus tôt (les lots périmés ne sortent jamais).
            Le bon recevra son numéro définitif et <strong>ne pourra plus être modifié</strong>.
          </p>
        </Modale>
      )}
      {modale === 'reception' && detail && (
        <Reception
          bl={detail}
          onFermer={(fait) => {
            setModale(undefined);
            if (fait) void chargerDetail(detail.id).then(() => setInfo('Réception enregistrée.'));
          }}
        />
      )}
      {modale === 'imprimer' && detail && entreprise && (
        <ApercuDocument titre={`Bon de livraison ${detail.numero}`} nomFichier={detail.numero ?? 'bon-de-livraison'} onFermer={() => setModale(undefined)}>
          <DocumentBL bl={detail} e={entreprise} />
        </ApercuDocument>
      )}
    </>
  );
}
