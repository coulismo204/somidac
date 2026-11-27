import { useCallback, useEffect, useState } from 'react';
import { Message } from '../../composants/communs';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterJour, formaterMontant, formaterNombre } from '../../format';

type Sens = 'entree' | 'sortie';

interface MouvementJournal {
  id: string;
  date: string;
  type: string;
  quantite: number;
  pieces: number;
  motif: string | null;
  codeProduit: string;
  produit: string;
  lotNumero: string | null;
  lotPeremption: string | null;
  document: string | null;
  tiers: string | null;
  utilisateur: string | null;
  valeur?: number;
}
interface Journal {
  mouvements: MouvementJournal[];
  resume: { mouvements: number; pieces: number; produits: number; valeur?: number; parType: Record<string, { mouvements: number; pieces: number; valeur?: number }> };
  limite: boolean;
}

/** Types de mouvements possibles dans chaque sens (§5.4, §7 table mouvements_stock). */
const TYPES: Record<Sens, [string, string][]> = {
  entree: [
    ['achat', 'Achats'],
    ['retour_client', 'Retours clients'],
    ['ajustement', 'Ajustements'],
    ['inventaire', 'Inventaires'],
  ],
  sortie: [
    ['vente', 'Ventes'],
    ['casse', 'Casse'],
    ['peremption', 'Péremption'],
    ['retour_fournisseur', 'Retours fournisseurs'],
    ['ajustement', 'Ajustements'],
    ['inventaire', 'Inventaires'],
  ],
};
const LIBELLE_TYPE: Record<string, string> = {
  achat: 'Achat',
  vente: 'Vente',
  retour_client: 'Retour client',
  retour_fournisseur: 'Retour fournisseur',
  ajustement: 'Ajustement',
  casse: 'Casse',
  peremption: 'Péremption',
  inventaire: 'Inventaire',
};

function decaler(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function periodes(): [string, string, string][] {
  const jour = aujourdhuiIso();
  const debutMois = `${jour.slice(0, 8)}01`;
  const d = new Date(`${debutMois}T12:00:00`);
  d.setMonth(d.getMonth() - 1);
  const debutMoisPrecedent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const finMoisPrecedent = new Date(`${debutMois}T12:00:00`);
  finMoisPrecedent.setDate(0);
  const fin = `${finMoisPrecedent.getFullYear()}-${String(finMoisPrecedent.getMonth() + 1).padStart(2, '0')}-${String(finMoisPrecedent.getDate()).padStart(2, '0')}`;
  return [
    ['Aujourd’hui', jour, jour],
    ['7 derniers jours', decaler(-6), jour],
    ['Ce mois', debutMois, jour],
    ['Mois dernier', debutMoisPrecedent, fin],
  ];
}

/** Entrées ou sorties de stock sur une période, avec leur document d'origine. */
export function Mouvements({ sens }: { sens: Sens }) {
  const { appeler } = useSession();
  const presets = periodes();
  const [du, setDu] = useState(presets[2][1]);
  const [au, setAu] = useState(presets[2][2]);
  const [recherche, setRecherche] = useState('');
  const [type, setType] = useState('');
  const [journal, setJournal] = useState<Journal>();
  const [erreur, setErreur] = useState<string>();
  const entree = sens === 'entree';
  const couleur = entree ? 'var(--succes)' : 'var(--danger)';

  const charger = useCallback(async () => {
    setErreur(undefined);
    try {
      const q = new URLSearchParams({ sens, du, au });
      if (recherche.trim()) q.set('recherche', recherche.trim());
      if (type) q.set('type', type);
      setJournal(await appeler<Journal>('GET', `/stock/mouvements?${q}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [appeler, sens, du, au, recherche, type]);
  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);

  const voirValeur = journal?.resume.valeur !== undefined;
  const r = journal?.resume;

  return (
    <>
      <div className="barre-outils">
        <div className="segments" role="group" aria-label="Période">
          {presets.map(([libelle, d, a]) => (
            <button key={libelle} className={du === d && au === a ? 'actif' : ''} onClick={() => (setDu(d), setAu(a))}>
              {libelle}
            </button>
          ))}
        </div>
        <label className="periode">
          Du <input type="date" value={du} max={au} onChange={(e) => e.target.value && setDu(e.target.value)} />
        </label>
        <label className="periode">
          au <input type="date" value={au} min={du} onChange={(e) => e.target.value && setAu(e.target.value)} />
        </label>
      </div>

      {r && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          <div className={`carte indicateur ${entree ? 'bord-entree' : 'bord-sortie'}`}>
            <div className="libelle">{entree ? 'Pièces entrées' : 'Pièces sorties'}</div>
            <div className="valeur" style={{ color: couleur }}>
              {entree ? '+' : '-'} {formaterNombre(r.pieces)}
            </div>
            <div className="detail">
              {r.mouvements} mouvement{r.mouvements > 1 ? 's' : ''} · {r.produits} produit{r.produits > 1 ? 's' : ''}
            </div>
          </div>
          {voirValeur && (
            <div className="carte indicateur">
              <div className="libelle">Valeur au coût</div>
              <div className="valeur">{formaterMontant(r.valeur)}</div>
              <div className="detail">du {formaterJour(du)} au {formaterJour(au)}</div>
            </div>
          )}
          {TYPES[sens]
            .filter(([t]) => r.parType[t])
            .map(([t, libelle]) => (
              <button key={t} className={`carte indicateur filtre-type ${type === t ? 'actif' : ''}`} onClick={() => setType(type === t ? '' : t)} title="Filtrer sur ce type">
                <div className="libelle">{libelle}</div>
                <div className="valeur">{formaterNombre(r.parType[t].pieces)}</div>
                <div className="detail">
                  {r.parType[t].mouvements} mouvement{r.parType[t].mouvements > 1 ? 's' : ''}
                  {r.parType[t].valeur !== undefined ? ` · ${formaterMontant(r.parType[t].valeur)}` : ''}
                </div>
              </button>
            ))}
        </div>
      )}

      <div className="barre-outils">
        <input className="recherche" placeholder="Rechercher un produit (nom ou code)" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de mouvement">
          <option value="">Tous les types</option>
          {TYPES[sens].map(([t, l]) => <option key={t} value={t}>{l}</option>)}
        </select>
      </div>
      <Message type="erreur">{erreur}</Message>
      {journal?.limite && <div style={{ marginBottom: 12 }}><Message type="attention">Seuls les 2 000 mouvements les plus récents sont affichés : réduisez la période.</Message></div>}

      <div className="carte">
        {!journal ? (
          <div className="vide">Chargement…</div>
        ) : journal.mouvements.length === 0 ? (
          <div className="vide">Aucune {entree ? 'entrée' : 'sortie'} de stock sur cette période.</div>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Date</th>
                <th>Produit</th>
                <th>Type</th>
                <th>Document</th>
                <th>Lot</th>
                <th className="nombre">Pièces</th>
                {voirValeur && <th className="nombre">Valeur</th>}
                <th>Par</th>
              </tr>
            </thead>
            <tbody>
              {journal.mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="sans-retour">
                    {new Date(m.date).toLocaleDateString('fr-FR')}
                    <div className="secondaire">{new Date(m.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td>
                    <strong>{m.produit}</strong>
                    <div className="secondaire">{m.codeProduit}</div>
                  </td>
                  <td>
                    <span className={`pastille ${entree ? 'verte' : 'rouge'}`}>{LIBELLE_TYPE[m.type] ?? m.type}</span>
                    {m.motif && <div className="secondaire" style={{ maxWidth: 220 }}>{m.motif}</div>}
                  </td>
                  <td>
                    {m.document ? <span className="mono">{m.document}</span> : <span className="secondaire">-</span>}
                    {m.tiers && <div className="secondaire">{m.tiers}</div>}
                  </td>
                  <td>
                    {m.lotNumero || <span className="secondaire">Sans lot</span>}
                    {m.lotPeremption && <div className="secondaire">exp. {formaterJour(m.lotPeremption)}</div>}
                  </td>
                  <td className="nombre" style={{ color: couleur, fontWeight: 700 }}>
                    {entree ? '+' : '-'}{formaterNombre(m.pieces)}
                  </td>
                  {voirValeur && <td className="nombre">{formaterMontant(m.valeur)}</td>}
                  <td className="sans-retour">{m.utilisateur ?? <span className="secondaire">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
