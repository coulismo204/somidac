import { FormEvent, useEffect, useState } from 'react';
import { Champ, Icone, Message, Modale } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';

export interface Categorie {
  id: string;
  nom: string;
  type: 'cosmetique' | 'bazar';
  actif: boolean;
}
interface Marque {
  id: string;
  nom: string;
}
export interface Conditionnement {
  id?: string;
  nom: string;
  nbPieces: number;
  prixVente: number | null;
  actif: boolean;
}
export interface Produit {
  id: string;
  code: string;
  designation: string;
  categorieId: string;
  categorie: string;
  typeCategorie: string;
  marqueId: string | null;
  marque: string | null;
  suiviLot: boolean;
  seuilAlerte: number;
  stock: number;
  actif: boolean;
  cmp?: number;
  conditionnements: (Conditionnement & { id: string })[];
  codesBarres: { code: string; conditionnementId: string | null }[];
}

/** Création ou modification d'un produit (§5.2). */
export function FicheProduit({ produit, onFermer, onEnregistre }: { produit?: Produit; onFermer: () => void; onEnregistre: () => void }) {
  const { appeler, peut } = useSession();
  const peutPrix = peut('prix.modifier');
  const peutModifier = peut('produits.gerer');
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [marques, setMarques] = useState<Marque[]>([]);
  const [erreur, setErreur] = useState<string>();
  const [envoi, setEnvoi] = useState(false);
  const [f, setF] = useState({
    designation: produit?.designation ?? '',
    categorieId: produit?.categorieId ?? '',
    marque: produit?.marque ?? '',
    suiviLot: produit?.suiviLot ?? true,
    seuilAlerte: produit?.seuilAlerte ?? 0,
    actif: produit?.actif ?? true,
  });
  const [conds, setConds] = useState<Conditionnement[]>(
    produit?.conditionnements.filter((c) => c.actif).map((c) => ({ ...c })) ?? [{ nom: 'Pièce', nbPieces: 1, prixVente: null, actif: true }],
  );
  const [codes, setCodes] = useState<{ code: string; conditionnement: number }[]>(
    produit?.codesBarres.map((c) => ({ code: c.code, conditionnement: Math.max(0, conds.findIndex((x) => x.id === c.conditionnementId)) })) ?? [],
  );

  useEffect(() => {
    void Promise.all([appeler<Categorie[]>('GET', '/categories'), appeler<Marque[]>('GET', '/marques')]).then(([c, m]) => {
      setCategories(c.filter((x) => x.actif));
      setMarques(m);
    });
  }, [appeler]);

  const majCond = (i: number, champ: keyof Conditionnement, valeur: unknown) => setConds(conds.map((c, n) => (n === i ? { ...c, [champ]: valeur } : c)));

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(undefined);
    setEnvoi(true);
    try {
      let marqueId: string | null = null;
      if (f.marque.trim()) {
        const m = await appeler<Marque>('POST', '/marques', { nom: f.marque.trim() });
        marqueId = m.id;
      }
      const corps = {
        designation: f.designation,
        categorieId: f.categorieId,
        marqueId,
        suiviLot: f.suiviLot,
        seuilAlerte: Number(f.seuilAlerte),
        actif: f.actif,
        conditionnements: conds.map((c) => ({ ...(c.id ? { id: c.id } : {}), nom: c.nom, nbPieces: Number(c.nbPieces), prixVente: c.prixVente === null || (c.prixVente as unknown) === '' ? null : Number(c.prixVente), actif: true })),
        codesBarres: codes.filter((c) => c.code.trim()).map((c) => ({ code: c.code.trim(), conditionnement: c.conditionnement })),
      };
      if (produit) await appeler('PUT', `/produits/${produit.id}`, corps);
      else await appeler('POST', '/produits', corps);
      onEnregistre();
    } catch (err) {
      setErreur(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale titre={produit ? `${produit.code} - ${produit.designation}` : 'Nouveau produit'} onFermer={onFermer} large>
      <form onSubmit={enregistrer} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="grille-champs">
          <Champ className="pleine" libelle="Désignation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} required autoFocus />
          <div className="champ">
            <label htmlFor="cat">Catégorie</label>
            <select
              id="cat"
              value={f.categorieId}
              onChange={(e) => {
                const c = categories.find((x) => x.id === e.target.value);
                setF({ ...f, categorieId: e.target.value, suiviLot: produit ? f.suiviLot : c?.type === 'cosmetique' });
              }}
              required
            >
              <option value="">- Choisir -</option>
              <optgroup label="Cosmétique">{categories.filter((c) => c.type === 'cosmetique').map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</optgroup>
              <optgroup label="Bazar">{categories.filter((c) => c.type === 'bazar').map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</optgroup>
            </select>
          </div>
          <div className="champ">
            <label htmlFor="marque">Marque (facultatif)</label>
            <input id="marque" list="marques" value={f.marque} onChange={(e) => setF({ ...f, marque: e.target.value })} />
            <datalist id="marques">{marques.map((m) => <option key={m.id} value={m.nom} />)}</datalist>
          </div>
          <Champ libelle="Seuil d'alerte (pièces)" type="number" min={0} value={f.seuilAlerte} onChange={(e) => setF({ ...f, seuilAlerte: Number(e.target.value) })} />
          <div className="champ" style={{ justifyContent: 'flex-end' }}>
            <label className="case">
              <input type="checkbox" checked={f.suiviLot} onChange={(e) => setF({ ...f, suiviLot: e.target.checked })} />
              Suivi par lot et date de péremption
            </label>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Conditionnements et prix de vente</h3>
          {!peutPrix && <p className="aide" style={{ color: 'var(--texte-3)', fontSize: 12, marginBottom: 8 }}>Seul le gérant peut fixer les prix de vente.</p>}
          <table className="tableau">
            <thead>
              <tr>
                <th>Nom</th>
                <th style={{ width: 120 }}>Pièces</th>
                <th style={{ width: 170 }}>Prix de vente (FCFA)</th>
                <th style={{ width: 50 }} />
              </tr>
            </thead>
            <tbody>
              {conds.map((c, i) => (
                <tr key={i}>
                  <td className="serre"><input value={c.nom} onChange={(e) => majCond(i, 'nom', e.target.value)} required /></td>
                  <td className="serre"><input className="nombre" type="number" min={1} value={c.nbPieces} disabled={i === 0} onChange={(e) => majCond(i, 'nbPieces', Number(e.target.value))} /></td>
                  <td className="serre"><input className="nombre" type="number" min={0} value={c.prixVente ?? ''} disabled={!peutPrix} onChange={(e) => majCond(i, 'prixVente', e.target.value === '' ? null : Number(e.target.value))} /></td>
                  <td className="serre">
                    {i > 0 && (
                      <button type="button" className="bouton discret petit" onClick={() => setConds(conds.filter((_, n) => n !== i))} aria-label="Retirer">
                        <Icone nom="fermer" taille={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="bouton secondaire petit" style={{ marginTop: 8 }} onClick={() => setConds([...conds, { nom: 'Carton de 24', nbPieces: 24, prixVente: null, actif: true }])}>
            <Icone nom="plus" taille={14} /> Ajouter un conditionnement
          </button>
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Codes-barres</h3>
          {codes.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input className="mono" style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid var(--bord)' }} value={c.code} placeholder="Scannez ou tapez le code" onChange={(e) => setCodes(codes.map((x, n) => (n === i ? { ...x, code: e.target.value } : x)))} />
              <select style={{ height: 36, borderRadius: 6, border: '1px solid var(--bord)' }} value={c.conditionnement} onChange={(e) => setCodes(codes.map((x, n) => (n === i ? { ...x, conditionnement: Number(e.target.value) } : x)))}>
                {conds.map((k, n) => <option key={n} value={n}>{k.nom}</option>)}
              </select>
              <button type="button" className="bouton discret petit" onClick={() => setCodes(codes.filter((_, n) => n !== i))} aria-label="Retirer">
                <Icone nom="fermer" taille={14} />
              </button>
            </div>
          ))}
          <button type="button" className="bouton secondaire petit" onClick={() => setCodes([...codes, { code: '', conditionnement: 0 }])}>
            <Icone nom="plus" taille={14} /> Ajouter un code-barres
          </button>
        </div>

        {produit && (
          <label className="case">
            <input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} />
            Produit actif (décocher pour l'archiver : il disparaît des listes mais reste dans l'historique)
          </label>
        )}
        <Message type="erreur">{erreur}</Message>
        <div className="actions">
          <button type="button" className="bouton secondaire" onClick={onFermer}>{peutModifier ? 'Annuler' : 'Fermer'}</button>
          {peutModifier && <button className="bouton" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>}
        </div>
      </form>
    </Modale>
  );
}
