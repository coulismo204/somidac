import { useCallback, useEffect, useState } from 'react';
import { Icone, Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { formaterMontant, formaterNombre } from '../../format';
import { Categorie, FicheProduit, Produit } from './FicheProduit';

export function Produits() {
  const { appeler, peut } = useSession();
  const [produits, setProduits] = useState<Produit[]>();
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [recherche, setRecherche] = useState('');
  const [categorieId, setCategorieId] = useState('');
  const [inactifs, setInactifs] = useState(false);
  const [edition, setEdition] = useState<Produit | 'nouveau'>();
  const [erreur, setErreur] = useState<string>();

  const charger = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (recherche.trim()) q.set('recherche', recherche.trim());
      if (categorieId) q.set('categorieId', categorieId);
      if (inactifs) q.set('inactifs', '1');
      setProduits(await appeler<Produit[]>('GET', `/produits?${q}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler, recherche, categorieId, inactifs]);

  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);
  useEffect(() => {
    appeler<Categorie[]>('GET', '/categories').then(setCategories).catch(() => undefined);
  }, [appeler]);

  const ouvrir = async (id: string) => {
    try {
      setEdition(await appeler<Produit>('GET', `/produits/${id}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const prixPiece = (p: Produit) => p.conditionnements.find((c) => c.nbPieces === 1)?.prixVente;

  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Produits</h1>
          <p>Catalogue, conditionnements, codes-barres et prix de vente.</p>
        </div>
        {peut('produits.gerer') && (
          <button className="bouton" onClick={() => setEdition('nouveau')}>
            <Icone nom="plus" /> Nouveau produit
          </button>
        )}
      </div>
      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher : nom, code P-…, ou scannez un code-barres" value={recherche} onChange={(e) => setRecherche(e.target.value)} autoFocus />
        <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        <label className="case"><input type="checkbox" checked={inactifs} onChange={(e) => setInactifs(e.target.checked)} /> Archivés</label>
      </div>
      <Message type="erreur">{erreur}</Message>
      <div className="carte">
        {!produits ? (
          <div className="vide">Chargement…</div>
        ) : produits.length === 0 ? (
          <div className="vide">{recherche ? 'Aucun produit ne correspond.' : 'Aucun produit : commencez par « Nouveau produit ».'}</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Désignation</th>
                <th>Catégorie</th>
                <th className="nombre">Stock (pièces)</th>
                <th className="nombre">Prix pièce</th>
                {peut('couts.voir') && <th className="nombre">Coût moyen</th>}
              </tr>
            </thead>
            <tbody>
              {produits.map((p) => (
                <tr key={p.id} className="cliquable" onClick={() => void ouvrir(p.id)}>
                  <td className="mono">{p.code}</td>
                  <td>
                    <strong>{p.designation}</strong>
                    {!p.actif && <span className="pastille grise" style={{ marginLeft: 8 }}>Archivé</span>}
                    <div className="secondaire">
                      {[p.marque, p.suiviLot ? 'suivi par lot' : null, p.conditionnements.filter((c) => c.actif).map((c) => c.nom).join(', ')].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>{p.categorie}</td>
                  <td className="nombre">
                    {p.seuilAlerte > 0 && p.stock <= p.seuilAlerte ? <span className="pastille orange">{formaterNombre(p.stock)}</span> : formaterNombre(p.stock)}
                  </td>
                  <td className="nombre">{formaterMontant(prixPiece(p))}</td>
                  {peut('couts.voir') && <td className="nombre">{formaterMontant(p.cmp)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edition && (
        <FicheProduit
          produit={edition === 'nouveau' ? undefined : edition}
          onFermer={() => setEdition(undefined)}
          onEnregistre={() => {
            setEdition(undefined);
            void charger();
          }}
        />
      )}
    </>
  );
}
