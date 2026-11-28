import { PERMISSIONS } from '@somidac/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { envoyerJustificatif, Justificatifs } from '../../composants/Justificatifs';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant } from '../../format';
import { ChoixCompte, Encaissement, FichePaiement, useComptes } from './Paiements';

interface LignePaiement {
  id: string;
  numero: string;
  date: string;
  montant: number;
  reference: string | null;
  statut: 'valide' | 'annule';
  compte: string;
  tiers: string;
  documents: string | null;
  par: string | null;
}

function TableauPaiements({ liste, onOuvrir }: { liste: LignePaiement[]; onOuvrir: (id: string) => void }) {
  return (
    <table className="tableau">
      <thead>
        <tr>
          <th>Numéro</th>
          <th>Date</th>
          <th>Tiers</th>
          <th>Compte</th>
          <th className="nombre">Montant</th>
          <th>Par</th>
        </tr>
      </thead>
      <tbody>
        {liste.map((p) => (
          <tr key={p.id} className="cliquable" onClick={() => onOuvrir(p.id)} style={p.statut === 'annule' ? { opacity: 0.55 } : undefined}>
            <td className="mono">
              {p.numero}
              {p.statut === 'annule' && <div><span className="pastille grise">Annulé</span></div>}
            </td>
            <td>{formaterJour(p.date)}</td>
            <td>
              {p.tiers}
              {p.documents && <div className="secondaire">{p.documents}</div>}
            </td>
            <td>
              {p.compte}
              {p.reference && <div className="secondaire">réf. {p.reference}</div>}
            </td>
            <td className="nombre"><strong>{formaterMontant(p.montant)}</strong></td>
            <td className="sans-retour">{p.par ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Encaissements des clients (§5.6). */
export function Encaissements() {
  const { appeler } = useSession();
  const [liste, setListe] = useState<LignePaiement[]>();
  const [nouveau, setNouveau] = useState(false);
  const [ouvert, setOuvert] = useState<string>();
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<LignePaiement[]>('GET', '/paiements?sens=client').then(setListe).catch((e) => setErreur(messageErreur(e)));
  }, [appeler]);
  useEffect(charger, [charger]);
  return (
    <>
      <div className="barre-outils" style={{ justifyContent: 'space-between' }}>
        <p style={{ color: 'var(--texte-2)' }}>Un encaissement règle une ou plusieurs factures, en tout ou en partie. Un reçu s’imprime pour le client.</p>
        <button className="bouton" onClick={() => setNouveau(true)}><Icone nom="plus" /> Encaisser</button>
      </div>
      <Message type="erreur">{erreur}</Message>
      <div className="carte">
        {!liste ? <div className="vide">Chargement…</div> : liste.length === 0 ? <div className="vide">Aucun encaissement.</div> : <TableauPaiements liste={liste} onOuvrir={setOuvert} />}
      </div>
      {nouveau && <Encaissement onFermer={(id) => { setNouveau(false); charger(); if (id) setOuvert(id); }} />}
      {ouvert && <FichePaiement id={ouvert} onFermer={(modifie) => { setOuvert(undefined); if (modifie) charger(); }} />}
    </>
  );
}

interface FournisseurDu {
  id: string;
  nom: string;
  resteDu: number;
}
interface AchatDu {
  id: string;
  numero: string | null;
  date: string;
  statut: string;
  fournisseurId: string;
  total: number;
  montantPaye: number;
}

function PaiementFournisseur({ fournisseur, onFermer }: { fournisseur: FournisseurDu; onFermer: (fait: boolean) => void }) {
  const { appeler } = useSession();
  const comptes = useComptes();
  const [achats, setAchats] = useState<AchatDu[]>();
  const [montants, setMontants] = useState<Record<string, number>>({});
  const [compteId, setCompteId] = useState('');
  const [reference, setReference] = useState('');
  const [erreur, setErreur] = useState<string>();
  useEffect(() => {
    appeler<AchatDu[]>('GET', '/achats?statut=valide')
      .then((l) => setAchats(l.filter((a) => a.fournisseurId === fournisseur.id && a.total > a.montantPaye)))
      .catch((e) => setErreur(messageErreur(e)));
  }, [appeler, fournisseur.id]);
  const total = (achats ?? []).reduce((t, a) => t + (montants[a.id] || 0), 0);
  const payer = async () => {
    setErreur(undefined);
    try {
      await appeler('POST', '/paiements/fournisseurs', {
        fournisseurId: fournisseur.id,
        compteId,
        reference: reference || null,
        affectations: (achats ?? []).filter((a) => montants[a.id] > 0).map((a) => ({ achatId: a.id, montant: montants[a.id] })),
      });
      onFermer(true);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };
  return (
    <Modale
      titre={`Payer ${fournisseur.nom}`}
      onFermer={() => onFermer(false)}
      large
      pied={
        <>
          <button className="bouton secondaire" onClick={() => onFermer(false)}>Annuler</button>
          <button className="bouton" disabled={!compteId || total <= 0} onClick={() => void payer()}>Payer {total > 0 ? formaterMontant(total) : ''}</button>
        </>
      }
    >
      <div className="grille-champs">
        <div className="champ"><label htmlFor="compte-four">Payé depuis</label><ChoixCompte id="compte-four" comptes={comptes} valeur={compteId} onChange={setCompteId} /></div>
        <Champ libelle="Référence (chèque, virement, transaction)" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      {!achats ? (
        <div className="vide">Chargement…</div>
      ) : (
        <table className="tableau">
          <thead>
            <tr><th>Achat</th><th className="nombre">Total</th><th className="nombre">Reste à payer</th><th className="nombre" style={{ width: 160 }}>Montant payé</th></tr>
          </thead>
          <tbody>
            {achats.map((a) => (
              <tr key={a.id}>
                <td><span className="mono">{a.numero}</span><div className="secondaire">du {formaterJour(a.date)}</div></td>
                <td className="nombre">{formaterMontant(a.total)}</td>
                <td className="nombre">{formaterMontant(a.total - a.montantPaye)}</td>
                <td className="serre">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="nombre" type="number" min={0} value={montants[a.id] ?? ''} placeholder="0" onChange={(e) => setMontants({ ...montants, [a.id]: Math.max(0, Math.min(a.total - a.montantPaye, Number(e.target.value))) })} />
                    <button className="bouton discret petit" onClick={() => setMontants({ ...montants, [a.id]: a.total - a.montantPaye })}>Tout</button>
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

/** Dettes fournisseurs et leurs paiements. */
export function Fournisseurs() {
  const { appeler } = useSession();
  const [dettes, setDettes] = useState<FournisseurDu[]>();
  const [paiements, setPaiements] = useState<LignePaiement[]>();
  const [payer, setPayer] = useState<FournisseurDu>();
  const [ouvert, setOuvert] = useState<string>();
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<FournisseurDu[]>('GET', '/fournisseurs').then((l) => setDettes(l.filter((f) => f.resteDu > 0))).catch((e) => setErreur(messageErreur(e)));
    appeler<LignePaiement[]>('GET', '/paiements?sens=fournisseur').then(setPaiements).catch((e) => setErreur(messageErreur(e)));
  }, [appeler]);
  useEffect(charger, [charger]);
  return (
    <>
      <Message type="erreur">{erreur}</Message>
      <div className="carte" style={{ marginBottom: 16 }}>
        <div className="entete-carte"><h3>Dettes fournisseurs</h3><span className="secondaire" style={{ color: 'var(--texte-2)' }}>{dettes ? formaterMontant(dettes.reduce((t, f) => t + f.resteDu, 0)) : ''}</span></div>
        {!dettes ? (
          <div className="vide">Chargement…</div>
        ) : dettes.length === 0 ? (
          <div className="vide">Aucune dette : tous les achats sont payés.</div>
        ) : (
          <table className="tableau">
            <tbody>
              {dettes.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.nom}</strong></td>
                  <td className="nombre"><strong>{formaterMontant(f.resteDu)}</strong></td>
                  <td style={{ width: 120 }}><div className="actions-ligne"><button className="bouton secondaire petit" onClick={() => setPayer(f)}>Payer</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="carte">
        <div className="entete-carte"><h3>Paiements effectués</h3></div>
        {!paiements ? <div className="vide">Chargement…</div> : paiements.length === 0 ? <div className="vide">Aucun paiement fournisseur.</div> : <TableauPaiements liste={paiements} onOuvrir={setOuvert} />}
      </div>
      {payer && <PaiementFournisseur fournisseur={payer} onFermer={(fait) => { setPayer(undefined); if (fait) charger(); }} />}
      {ouvert && <FichePaiement id={ouvert} onFermer={(modifie) => { setOuvert(undefined); if (modifie) charger(); }} />}
    </>
  );
}

interface CategorieDepense {
  id: string;
  nom: string;
  actif: boolean;
}
interface LigneDepense {
  id: string;
  numero: string;
  date: string;
  montant: number;
  libelle: string;
  beneficiaire: string | null;
  statut: 'valide' | 'annule';
  motifAnnulation: string | null;
  categorie: string;
  compte: string;
  par: string | null;
  justificatifs: number;
}

function NouvelleDepense({ categories, onFermer }: { categories: CategorieDepense[]; onFermer: (fait: boolean) => void }) {
  const { appeler } = useSession();
  const comptes = useComptes();
  const [f, setF] = useState({ date: aujourdhuiIso(), categorieId: '', compteId: '', montant: 0, libelle: '', beneficiaire: '' });
  const [photo, setPhoto] = useState<File>();
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!f.compteId && comptes.length) setF((x) => ({ ...x, compteId: comptes.find((c) => c.type === 'caisse' && c.actif)?.id ?? '' }));
  }, [comptes, f.compteId]);
  const valider = async () => {
    setErreur(undefined);
    setEnvoi(true);
    try {
      const d = await appeler<{ id: string }>('POST', '/depenses', { ...f, montant: Number(f.montant), beneficiaire: f.beneficiaire || null });
      if (photo) await envoyerJustificatif(appeler, 'depense', d.id, photo);
      onFermer(true);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Modale
      titre="Nouvelle dépense"
      onFermer={() => onFermer(false)}
      pied={
        <>
          <button className="bouton secondaire" onClick={() => onFermer(false)}>Annuler</button>
          <button className="bouton" disabled={envoi || !f.categorieId || !f.compteId || Number(f.montant) <= 0 || f.libelle.trim().length < 2} onClick={() => void valider()}>Enregistrer la dépense</button>
        </>
      }
    >
      <div className="grille-champs">
        <div className="champ">
          <label htmlFor="cat-dep">Catégorie</label>
          <select id="cat-dep" value={f.categorieId} onChange={(e) => setF({ ...f, categorieId: e.target.value })}>
            <option value="">- Choisir -</option>
            {categories.filter((c) => c.actif).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <Champ libelle="Date" type="date" value={f.date} max={aujourdhuiIso()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Champ className="pleine" libelle="Description" value={f.libelle} placeholder="Taxi pour la livraison Bon Prix…" onChange={(e) => setF({ ...f, libelle: e.target.value })} />
        <Champ libelle="Montant (FCFA)" type="number" min={1} value={f.montant || ''} onChange={(e) => setF({ ...f, montant: Number(e.target.value) })} />
        <div className="champ"><label htmlFor="compte-dep">Payé depuis</label><ChoixCompte id="compte-dep" comptes={comptes} valeur={f.compteId} onChange={(v) => setF({ ...f, compteId: v })} /></div>
        <Champ className="pleine" libelle="Bénéficiaire" value={f.beneficiaire} onChange={(e) => setF({ ...f, beneficiaire: e.target.value })} />
        <div className="champ pleine">
          <label>Photo du justificatif</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" className="bouton secondaire petit" onClick={() => champ.current?.click()}>{photo ? 'Changer la photo' : 'Choisir une photo'}</button>
            <span className="secondaire" style={{ color: 'var(--texte-2)' }}>{photo?.name ?? 'Reçu, facture… (facultatif)'}</span>
            <input ref={champ} type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0])} />
          </div>
        </div>
      </div>
      <Message type="erreur">{erreur}</Message>
    </Modale>
  );
}

/** Dépenses (§5.6) : catégorie, compte utilisé, photo du justificatif. */
export function Depenses() {
  const { appeler, peut } = useSession();
  const [du, setDu] = useState(`${aujourdhuiIso().slice(0, 8)}01`);
  const [au, setAu] = useState(aujourdhuiIso());
  const [liste, setListe] = useState<LigneDepense[]>();
  const [categories, setCategories] = useState<CategorieDepense[]>([]);
  const [nouvelle, setNouvelle] = useState(false);
  const [detail, setDetail] = useState<LigneDepense>();
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string>();
  const charger = useCallback(() => {
    appeler<LigneDepense[]>('GET', `/depenses?du=${du}&au=${au}`).then(setListe).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, du, au]);
  useEffect(charger, [charger]);
  useEffect(() => {
    appeler<CategorieDepense[]>('GET', '/categories-depenses').then(setCategories).catch(() => undefined);
  }, [appeler]);
  const parCategorie = Object.entries(
    (liste ?? []).filter((d) => d.statut === 'valide').reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.categorie]: (acc[d.categorie] ?? 0) + d.montant }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const annuler = async () => {
    if (!detail) return;
    setErreur(undefined);
    try {
      await appeler('POST', `/depenses/${detail.id}/annuler`, { motif });
      setDetail(undefined);
      setMotif('');
      charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };
  return (
    <>
      <div className="barre-outils" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="periode">Du <input type="date" value={du} max={au} onChange={(e) => e.target.value && setDu(e.target.value)} /></label>
          <label className="periode">au <input type="date" value={au} min={du} onChange={(e) => e.target.value && setAu(e.target.value)} /></label>
        </div>
        <button className="bouton" onClick={() => setNouvelle(true)}><Icone nom="plus" /> Nouvelle dépense</button>
      </div>
      {liste && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          <div className="carte indicateur bord-sortie">
            <div className="libelle">Total des dépenses</div>
            <div className="valeur" style={{ color: 'var(--danger)' }}>{formaterMontant(parCategorie.reduce((t, [, m]) => t + m, 0))}</div>
            <div className="detail">du {formaterJour(du)} au {formaterJour(au)}</div>
          </div>
          {parCategorie.slice(0, 3).map(([c, m]) => (
            <div key={c} className="carte indicateur"><div className="libelle">{c}</div><div className="valeur">{formaterMontant(m)}</div></div>
          ))}
        </div>
      )}
      <Message type="erreur">{!detail ? erreur : undefined}</Message>
      <div className="carte">
        {!liste ? (
          <div className="vide">Chargement…</div>
        ) : liste.length === 0 ? (
          <div className="vide">Aucune dépense sur cette période.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr><th>Numéro</th><th>Date</th><th>Dépense</th><th>Compte</th><th className="nombre">Montant</th><th>Justificatif</th></tr>
            </thead>
            <tbody>
              {liste.map((d) => (
                <tr key={d.id} className="cliquable" onClick={() => setDetail(d)} style={d.statut === 'annule' ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{d.numero}{d.statut === 'annule' && <div><span className="pastille grise">Annulée</span></div>}</td>
                  <td>{formaterJour(d.date)}</td>
                  <td>
                    {d.libelle}
                    <div className="secondaire">{d.categorie}{d.beneficiaire ? ` · ${d.beneficiaire}` : ''}</div>
                  </td>
                  <td>{d.compte}</td>
                  <td className="nombre"><strong>{formaterMontant(d.montant)}</strong></td>
                  <td>{d.justificatifs ? <span className="pastille verte">{d.justificatifs} photo{d.justificatifs > 1 ? 's' : ''}</span> : <span className="pastille orange">Manquant</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nouvelle && <NouvelleDepense categories={categories} onFermer={(fait) => { setNouvelle(false); if (fait) charger(); }} />}
      {detail && (
        <Modale titre={`Dépense ${detail.numero}`} onFermer={() => { setDetail(undefined); charger(); }}>
          <div className="grille-cartes">
            <div className="carte indicateur"><div className="libelle">{detail.categorie}</div><div className="valeur">{formaterMontant(detail.montant)}</div><div className="detail">{detail.compte} · le {formaterJour(detail.date)}{detail.par ? ` par ${detail.par}` : ''}</div></div>
          </div>
          <p>{detail.libelle}{detail.beneficiaire ? ` (${detail.beneficiaire})` : ''}</p>
          {detail.statut === 'annule' && <Message type="attention">Dépense annulée : {detail.motifAnnulation}</Message>}
          <div className="champ">
            <label>Justificatifs</label>
            <Justificatifs documentType="depense" documentId={detail.id} modifiable={detail.statut === 'valide'} />
          </div>
          {detail.statut === 'valide' && peut(PERMISSIONS.DOCUMENTS_ANNULER) && (
            <div className="carte" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div className="champ" style={{ flex: 1 }}>
                <label htmlFor="motif-dep">Annuler la dépense : motif</label>
                <input id="motif-dep" value={motif} onChange={(e) => setMotif(e.target.value)} />
              </div>
              <button className="bouton danger" disabled={motif.trim().length < 3} onClick={() => void annuler()}>Annuler la dépense</button>
            </div>
          )}
          <Message type="erreur">{erreur}</Message>
        </Modale>
      )}
    </>
  );
}
