import { useEffect, useMemo, useState } from 'react';
import { Icone, Message, Modale } from '../../composants/communs';
import { ApercuDocument, DocumentBonReception, useEntreprise } from '../../composants/Documents';
import { Justificatifs } from '../../composants/Justificatifs';
import { ChoixCompte, useComptes } from '../tresorerie/Paiements';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant, formaterNombre } from '../../format';
import type { Produit } from '../produits/FicheProduit';
import type { Fournisseur } from './Fournisseurs';

interface Ligne {
  produitId: string;
  conditionnementId: string;
  quantite: number;
  prixUnitaire: number;
  numeroLot: string;
  datePeremption: string;
}
interface Frais {
  libelle: string;
  montant: number;
}
interface AchatDetail {
  id: string;
  numero: string | null;
  statut: 'brouillon' | 'valide' | 'annule';
  fournisseurId: string;
  fournisseur: string;
  date: string;
  referenceFournisseur: string | null;
  notes: string | null;
  montantPaye: number;
  comptePaiementId: string | null;
  totalMarchandises: number;
  totalFrais: number;
  total: number;
  lignes: (Ligne & { id: string; produit: string; codeProduit: string; suiviLot: boolean; conditionnement: string; nbPieces: number; quantitePieces: number | null; partFrais: number | null; coutPiece: number | null })[];
  frais: (Frais & { id: string })[];
}

/** Saisie d'un achat (§5.3) : brouillon modifiable, puis validation qui fait entrer le stock. */
export function EditeurAchat({ id, onFermer }: { id?: string; onFermer: (modifie: boolean) => void }) {
  const { appeler } = useSession();
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [detail, setDetail] = useState<AchatDetail>();
  const [entete, setEntete] = useState({ fournisseurId: '', date: aujourdhuiIso(), referenceFournisseur: '', notes: '', montantPaye: 0, comptePaiementId: '' });
  const comptes = useComptes();
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [frais, setFrais] = useState<Frais[]>([]);
  const [ajout, setAjout] = useState('');
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [idCourant, setIdCourant] = useState(id);
  const [imprimer, setImprimer] = useState(false);
  const [tousFournisseurs, setTousFournisseurs] = useState<Fournisseur[]>([]);
  const entreprise = useEntreprise();

  useEffect(() => {
    void (async () => {
      const [f, p] = await Promise.all([appeler<Fournisseur[]>('GET', '/fournisseurs'), appeler<Produit[]>('GET', '/produits')]);
      setFournisseurs(f.filter((x) => x.actif));
      setTousFournisseurs(f);
      setProduits(p);
      if (id) {
        const d = await appeler<AchatDetail>('GET', `/achats/${id}`);
        setDetail(d);
        setEntete({ fournisseurId: d.fournisseurId, date: d.date, referenceFournisseur: d.referenceFournisseur ?? '', notes: d.notes ?? '', montantPaye: d.montantPaye, comptePaiementId: d.comptePaiementId ?? '' });
        setLignes(d.lignes.map((l) => ({ produitId: l.produitId, conditionnementId: l.conditionnementId, quantite: l.quantite, prixUnitaire: l.prixUnitaire, numeroLot: l.numeroLot ?? '', datePeremption: l.datePeremption ?? '' })));
        setFrais(d.frais.map((x) => ({ libelle: x.libelle, montant: x.montant })));
      }
    })().catch((e) => setErreur(messageErreur(e)));
  }, [appeler, id]);

  const lectureSeule = detail ? detail.statut !== 'brouillon' : false;
  const produit = (pid: string) => produits.find((p) => p.id === pid);
  const totalMarchandises = useMemo(() => lignes.reduce((t, l) => t + l.quantite * l.prixUnitaire, 0), [lignes]);
  const totalFrais = useMemo(() => frais.reduce((t, x) => t + (Number(x.montant) || 0), 0), [frais]);
  const total = totalMarchandises + totalFrais;

  const ajouterProduit = (texte: string) => {
    const t = texte.trim().toLowerCase();
    if (!t) return;
    const trouve =
      produits.find((p) => p.codesBarres.some((c) => c.code === texte.trim())) ??
      produits.find((p) => p.code.toLowerCase() === t) ??
      produits.find((p) => `${p.code} - ${p.designation}`.toLowerCase() === t) ??
      produits.find((p) => p.designation.toLowerCase() === t);
    if (!trouve) return;
    const parCode = trouve.codesBarres.find((c) => c.code === texte.trim())?.conditionnementId;
    const actifs = trouve.conditionnements.filter((c) => c.actif);
    const cond = actifs.find((c) => c.id === parCode) ?? actifs[actifs.length - 1];
    setLignes([...lignes, { produitId: trouve.id, conditionnementId: cond.id, quantite: 1, prixUnitaire: 0, numeroLot: '', datePeremption: '' }]);
    setAjout('');
  };
  const majLigne = (i: number, champ: keyof Ligne, valeur: unknown) => setLignes(lignes.map((l, n) => (n === i ? { ...l, [champ]: valeur } : l)));

  const corps = () => ({
    fournisseurId: entete.fournisseurId,
    date: entete.date,
    referenceFournisseur: entete.referenceFournisseur || null,
    notes: entete.notes || null,
    montantPaye: Number(entete.montantPaye) || 0,
    comptePaiementId: Number(entete.montantPaye) > 0 ? entete.comptePaiementId || null : null,
    lignes: lignes.map((l) => ({ ...l, quantite: Number(l.quantite), prixUnitaire: Number(l.prixUnitaire), numeroLot: l.numeroLot || null, datePeremption: l.datePeremption || null })),
    frais: frais.filter((x) => x.libelle.trim()).map((x) => ({ libelle: x.libelle.trim(), montant: Number(x.montant) || 0 })),
  });

  const enregistrer = async (): Promise<string | undefined> => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      if (idCourant) {
        await appeler('PUT', `/achats/${idCourant}`, corps());
        return idCourant;
      }
      const r = await appeler<{ id: string }>('POST', '/achats', corps());
      setIdCourant(r.id);
      return r.id;
    } catch (err) {
      setErreur(messageErreur(err));
      return undefined;
    } finally {
      setEnvoi(false);
    }
  };

  const valider = async () => {
    setConfirmer(false);
    const a = await enregistrer();
    if (!a) return;
    setEnvoi(true);
    try {
      await appeler('POST', `/achats/${a}/valider`);
      onFermer(true);
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async () => {
    if (!idCourant) return onFermer(false);
    try {
      await appeler('DELETE', `/achats/${idCourant}`);
      onFermer(true);
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>{detail?.numero ?? (idCourant ? 'Achat (brouillon)' : 'Nouvel achat')}</h1>
          <p>{lectureSeule ? `Achat validé - ${detail?.fournisseur}, le ${formaterJour(detail?.date)}` : 'Le stock n’est modifié qu’à la validation.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {lectureSeule && <button className="bouton secondaire" onClick={() => setImprimer(true)}>Imprimer le bon de réception</button>}
          <button className="bouton secondaire" onClick={() => onFermer(!!idCourant)}>Retour à la liste</button>
        </div>
      </div>
      <Message type="erreur">{erreur}</Message>

      <div className="carte" style={{ marginTop: erreur ? 16 : 0 }}>
        <div className="corps grille-champs" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
          <div className="champ">
            <label htmlFor="fournisseur">Fournisseur</label>
            <select id="fournisseur" value={entete.fournisseurId} disabled={lectureSeule} onChange={(e) => setEntete({ ...entete, fournisseurId: e.target.value })}>
              <option value="">- Choisir -</option>
              {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </div>
          <div className="champ">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={entete.date} disabled={lectureSeule} onChange={(e) => setEntete({ ...entete, date: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor="ref">N° facture du grossiste</label>
            <input id="ref" value={entete.referenceFournisseur} disabled={lectureSeule} onChange={(e) => setEntete({ ...entete, referenceFournisseur: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="carte" style={{ marginTop: 16 }}>
        <div className="entete-carte">
          <h3>Produits reçus</h3>
          {!lectureSeule && (
            <div style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 520 }}>
              <input
                list="liste-produits"
                className="recherche"
                style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--bord)' }}
                placeholder="Ajouter : scannez ou tapez le nom du produit"
                value={ajout}
                onChange={(e) => {
                  setAjout(e.target.value);
                  if (produits.some((p) => `${p.code} - ${p.designation}` === e.target.value)) ajouterProduit(e.target.value);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), ajouterProduit(ajout))}
              />
              <datalist id="liste-produits">{produits.map((p) => <option key={p.id} value={`${p.code} - ${p.designation}`} />)}</datalist>
            </div>
          )}
        </div>
        {lignes.length === 0 ? (
          <div className="vide">Ajoutez les produits de la facture du grossiste.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Produit</th>
                <th style={{ width: 150 }}>Conditionnement</th>
                <th style={{ width: 90 }} className="nombre">Qté</th>
                <th style={{ width: 130 }} className="nombre">Prix unitaire</th>
                <th style={{ width: 120 }}>Lot</th>
                <th style={{ width: 150 }}>Péremption</th>
                <th style={{ width: 130 }} className="nombre">Montant</th>
                {!lectureSeule && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const p = produit(l.produitId);
                const cond = p?.conditionnements.find((c) => c.id === l.conditionnementId);
                const valide = detail?.lignes[i];
                return [
                  <tr key={i}>
                    <td>
                      <strong>{p?.designation ?? valide?.produit}</strong>
                      <div className="secondaire">{p?.code ?? valide?.codeProduit}</div>
                    </td>
                    <td className="serre">
                      <select value={l.conditionnementId} disabled={lectureSeule} onChange={(e) => majLigne(i, 'conditionnementId', e.target.value)}>
                        {(p?.conditionnements ?? []).filter((c) => c.actif || c.id === l.conditionnementId).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                        {!p && <option value={l.conditionnementId}>{valide?.conditionnement}</option>}
                      </select>
                    </td>
                    <td className="serre"><input className="nombre" type="number" min={1} value={l.quantite} disabled={lectureSeule} onChange={(e) => majLigne(i, 'quantite', Number(e.target.value))} /></td>
                    <td className="serre"><input className="nombre" type="number" min={0} value={l.prixUnitaire} disabled={lectureSeule} onChange={(e) => majLigne(i, 'prixUnitaire', Number(e.target.value))} /></td>
                    <td className="serre">{(p?.suiviLot ?? valide?.suiviLot) ? <input value={l.numeroLot} disabled={lectureSeule} placeholder="N° lot" onChange={(e) => majLigne(i, 'numeroLot', e.target.value)} /> : <span className="secondaire">-</span>}</td>
                    <td className="serre">{(p?.suiviLot ?? valide?.suiviLot) ? <input type="date" value={l.datePeremption} disabled={lectureSeule} onChange={(e) => majLigne(i, 'datePeremption', e.target.value)} /> : <span className="secondaire">-</span>}</td>
                    <td className="nombre">{formaterMontant(l.quantite * l.prixUnitaire)}</td>
                    {!lectureSeule && (
                      <td className="serre">
                        <button className="bouton discret petit" onClick={() => setLignes(lignes.filter((_, n) => n !== i))} aria-label="Retirer"><Icone nom="fermer" taille={14} /></button>
                      </td>
                    )}
                  </tr>,
                  cond && cond.nbPieces > 1 && !lectureSeule ? (
                    <tr key={`${i}-p`} className="sous-ligne"><td colSpan={8}>= {formaterNombre(l.quantite * cond.nbPieces)} pièces</td></tr>
                  ) : null,
                  lectureSeule && valide ? (
                    <tr key={`${i}-v`} className="sous-ligne">
                      <td colSpan={8}>
                        {formaterNombre(valide.quantitePieces)} pièces · part des frais {formaterMontant(valide.partFrais)} · coût de revient {formaterMontant(valide.coutPiece)} la pièce
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
          <div className="entete-carte"><h3>Frais d'approche</h3></div>
          <div className="corps" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {frais.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <input style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid var(--bord)' }} value={x.libelle} disabled={lectureSeule} placeholder="Transport, manutention…" onChange={(e) => setFrais(frais.map((f, n) => (n === i ? { ...f, libelle: e.target.value } : f)))} />
                <input className="nombre" type="number" min={0} style={{ width: 130, height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid var(--bord)', textAlign: 'right' }} value={x.montant} disabled={lectureSeule} onChange={(e) => setFrais(frais.map((f, n) => (n === i ? { ...f, montant: Number(e.target.value) } : f)))} />
                {!lectureSeule && <button className="bouton discret petit" onClick={() => setFrais(frais.filter((_, n) => n !== i))} aria-label="Retirer"><Icone nom="fermer" taille={14} /></button>}
              </div>
            ))}
            {!lectureSeule && (
              <button className="bouton secondaire petit" style={{ alignSelf: 'flex-start' }} onClick={() => setFrais([...frais, { libelle: 'Transport', montant: 0 }])}>
                <Icone nom="plus" taille={14} /> Ajouter des frais
              </button>
            )}
            <p className="secondaire" style={{ color: 'var(--texte-3)', fontSize: 12 }}>Répartis sur les produits au prorata de leur montant, pour connaître le vrai coût de revient.</p>
          </div>
        </div>
        <div className="carte">
          <div className="totaux">
            <span>Marchandises</span><span className="nombre">{formaterMontant(totalMarchandises)}</span>
            <span>Frais</span><span className="nombre">{formaterMontant(totalFrais)}</span>
            <span className="total">Total</span><span className="nombre total">{formaterMontant(total)}</span>
            <span>Payé au grossiste</span>
            <span className="nombre">
              {lectureSeule ? formaterMontant(entete.montantPaye) : <input type="number" min={0} className="nombre" style={{ width: 140, height: 32, borderRadius: 6, border: '1px solid var(--bord)', padding: '0 8px', textAlign: 'right' }} value={entete.montantPaye} onChange={(e) => setEntete({ ...entete, montantPaye: Number(e.target.value) })} />}
            </span>
            {!lectureSeule && Number(entete.montantPaye) > 0 && (
              <>
                <span>Payé depuis</span>
                <span style={{ minWidth: 200 }}>
                  <ChoixCompte id="compte-achat" comptes={comptes} valeur={entete.comptePaiementId || comptes.find((c) => c.type === 'caisse')?.id || ''} onChange={(v) => setEntete({ ...entete, comptePaiementId: v })} />
                </span>
              </>
            )}
            <span>Reste à payer</span><span className="nombre"><strong>{formaterMontant(Math.max(0, total - Number(entete.montantPaye)))}</strong></span>
          </div>
          {idCourant && (
            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Photo de la facture du grossiste</span>
              <Justificatifs documentType="achat" documentId={idCourant} />
            </div>
          )}
          {!lectureSeule && (
            <div className="pied-modale" style={{ borderTop: '1px solid var(--bord)' }}>
              <button className="bouton discret" style={{ color: 'var(--danger)', marginRight: 'auto' }} onClick={() => void supprimer()}>Supprimer le brouillon</button>
              <button className="bouton secondaire" disabled={envoi || !entete.fournisseurId} onClick={() => void enregistrer()}>Enregistrer le brouillon</button>
              <button className="bouton" disabled={envoi || !entete.fournisseurId || lignes.length === 0} onClick={() => setConfirmer(true)}>Valider l'achat</button>
            </div>
          )}
        </div>
      </div>

      {confirmer && (
        <Modale
          titre="Valider l'achat"
          onFermer={() => setConfirmer(false)}
          pied={
            <>
              <button className="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button>
              <button className="bouton" onClick={() => void valider()}>Valider et faire entrer le stock</button>
            </>
          }
        >
          <p style={{ lineHeight: 1.5 }}>
            Le stock va augmenter de {formaterNombre(lignes.reduce((t, l) => t + l.quantite * (produit(l.produitId)?.conditionnements.find((c) => c.id === l.conditionnementId)?.nbPieces ?? 1), 0))} pièces et
            l'achat recevra son numéro définitif. <strong>Il ne pourra plus être modifié.</strong>
          </p>
        </Modale>
      )}
    {imprimer && detail && entreprise && (
        <ApercuDocument titre={`Bon de réception ${detail.numero}`} nomFichier={`Reception-${detail.numero}`} onFermer={() => setImprimer(false)}>
          <DocumentBonReception
            e={entreprise}
            r={{
              numero: detail.numero,
              date: detail.date,
              referenceFournisseur: detail.referenceFournisseur,
              fournisseur: tousFournisseurs.find((f) => f.id === detail.fournisseurId) ?? { nom: detail.fournisseur },
              lignes: detail.lignes,
            }}
          />
        </ApercuDocument>
      )}
    </>
  );
}
