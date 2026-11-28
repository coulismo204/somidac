import { PERMISSIONS, TYPES_CLIENTS, TypeClient } from '@somidac/shared';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Icone, Message } from '../composants/communs';
import { GraphiqueEvolution, LegendeEvolution, libelleCle, PointEvolution } from '../composants/GraphiqueEvolution';
import { ChoixPeriode, periodesUsuelles } from '../composants/Rapport';
import { messageErreur, useSession } from '../contexte';
import { creerClasseur } from '../exports/xlsx';
import { formaterJour, formaterMontant, formaterNombre } from '../format';

/** Montant sans l'unité, pour les tableaux denses (l'unité est dans l'en-tête). */
const m = (v: number | undefined | null) => formaterNombre(v ?? 0);

// ------------------------------------------------------------------ données

interface Indicateur {
  valeur: number;
  n1: number;
  variation: number | null;
  taux?: number | null;
}
interface Synthese {
  du: string;
  au: string;
  duN1: string;
  auN1: string;
  granularite: 'jour' | 'mois' | 'annee';
  sesVentesSeulement: boolean;
  indicateurs: { ca: Indicateur; marge?: Indicateur; ventes: Indicateur; panierMoyen: Indicateur; clients: number };
  serie: PointEvolution[];
  produits: { rang: number; id: string; libelle: string; code: string; pieces: number; ca: number; marge?: number; ventes: number }[];
  categories: { id: string; libelle: string; ca: number; caN1: number; marge?: number; margeN1?: number; ventes: number; ventesN1: number }[];
  clients: { id: string; libelle: string; type: TypeClient; ca: number; ventes: number; panierMoyen: number; avoirs: number; resteDu: number | null; marge?: number }[];
  stock: { pieces: number; produits: number; valeurVente: number; valeurCout?: number };
}
interface Global {
  stock?: {
    delaiPeremptionJours: number;
    stockBas: { id: string; designation: string; code: string; stock: number; seuil: number }[];
    nbStockBas: number;
    lots: { produit: string; numero: string; peremption: string; quantite: number; perime: boolean }[];
    nbLotsAEcouler: number;
    nbLotsPerimes: number;
    valeur?: number;
  };
  ventes?: { aEncaisser?: { nombre: number; montant: number }; facturesEnRetard?: { nombre: number; montant: number }; bonsAFacturer?: number };
  tresorerie?: { parType: Record<'caisse' | 'mobile_money' | 'banque', number | null>; dettesFournisseurs: number; depensesMois: number; cloturesAValider: number; encaissementsJour: number };
  alertes?: { ecartsCaisse: { jour: string; compte: string; ecart: number }[]; ecartsInventaire: { libelle: string; valeur: number }[]; horsHeures: number; sensiblesAujourdhui: number };
}

const MOIS_LONGS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** « vs novembre 2025 » si la période tient dans un mois, sinon « vs même période 2025 ». */
function libelleN1(du: string, au: string): string {
  if (du.slice(0, 7) === au.slice(0, 7)) return `vs ${MOIS_LONGS[Number(du.slice(5, 7)) - 1]} ${du.slice(0, 4)}`;
  return `vs ${du.slice(0, 4)}${du.slice(0, 4) !== au.slice(0, 4) ? `-${au.slice(0, 4)}` : ''}`;
}
const pct = (v: number | null | undefined) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
const delta = (a: number, b: number) => (b ? Math.round(((a - b) * 1000) / Math.abs(b)) / 10 : null);

// ------------------------------------------------------------------ éléments

function Variation({ v, libelle }: { v: number | null; libelle: string }) {
  if (v == null) return <span className="variation neutre">Rien à comparer {libelle}</span>;
  const hausse = v >= 0;
  return (
    <span className={`variation ${hausse ? 'hausse' : 'baisse'}`}>
      <span aria-hidden="true">{hausse ? '▲' : '▼'}</span> {pct(v)} {libelle}
    </span>
  );
}

function Kpi({ icone, libelle, valeur, variation, comparaison, detail }: { icone: string; libelle: string; valeur: string; variation?: number | null; comparaison?: string; detail?: ReactNode }) {
  return (
    <div className="carte kpi">
      <div className="kpi-icone"><Icone nom={icone} taille={18} /></div>
      <div>
        <div className="kpi-libelle">{libelle}</div>
        <div className="kpi-valeur">{valeur}</div>
        {comparaison !== undefined ? <Variation v={variation ?? null} libelle={comparaison} /> : detail ? <span className="variation neutre">{detail}</span> : null}
      </div>
    </div>
  );
}

function Pastille({ icone, nombre, titre, lien }: { icone: string; nombre: number; titre: string; lien: string }) {
  return (
    <a className="pastille-alerte" href={lien} title={titre} aria-label={`${titre} : ${nombre}`}>
      <Icone nom={icone} taille={18} />
      {nombre > 0 && <span className="pastille-nombre">{nombre > 99 ? '99+' : nombre}</span>}
    </a>
  );
}

function Carte({ titre, sousTitre, droite, children, className }: { titre: string; sousTitre?: string; droite?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`carte carte-tdb ${className ?? ''}`}>
      <div className="entete-tdb">
        <div>
          <h3>{titre}</h3>
          {sousTitre && <div className="sous-titre-tdb">{sousTitre}</div>}
        </div>
        {droite}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ onglet ventes

function SyntheseVentes({ s, voirMarge, onGranularite }: { s: Synthese; voirMarge: boolean; onGranularite: (g: 'jour' | 'mois' | 'annee') => void }) {
  const comparaison = libelleN1(s.duN1, s.auN1);
  const anneeN1 = s.duN1.slice(0, 4);
  const i = s.indicateurs;
  const recap = [...s.serie].reverse().filter((p) => p.ca || p.caN1 || p.marge || p.margeN1);
  return (
    <>
      <div className="grille-kpi">
        <Kpi icone="ventes" libelle={s.sesVentesSeulement ? 'Mon chiffre d’affaires HT' : 'Chiffre d’affaires HT'} valeur={formaterMontant(i.ca.valeur)} variation={i.ca.variation} comparaison={comparaison} />
        {i.marge && <Kpi icone="rapports" libelle={`Marge brute${i.marge.taux != null ? ` (${i.marge.taux.toLocaleString('fr-FR')} %)` : ''}`} valeur={formaterMontant(i.marge.valeur)} variation={i.marge.variation} comparaison={comparaison} />}
        <Kpi icone="achats" libelle="Nombre de ventes" valeur={formaterNombre(i.ventes.valeur)} variation={i.ventes.variation} comparaison={comparaison} />
        <Kpi icone="tresorerie" libelle="Panier moyen" valeur={formaterMontant(i.panierMoyen.valeur)} variation={i.panierMoyen.variation} comparaison={comparaison} />
        <Kpi
          icone="stock"
          libelle="Stock (prix de vente)"
          valeur={formaterMontant(s.stock.valeurVente)}
          detail={s.stock.valeurCout !== undefined ? `au coût : ${formaterMontant(s.stock.valeurCout)}` : `${formaterNombre(s.stock.pieces)} pièces`}
        />
      </div>

      <div className="grille-tdb grille-2-1">
        <Carte
          titre={voirMarge ? 'CA et marge' : 'Chiffre d’affaires'}
          sousTitre={`Évolution ${s.granularite === 'jour' ? 'journalière' : s.granularite === 'mois' ? 'mensuelle' : 'annuelle'}`}
          droite={
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <LegendeEvolution anneeN1={anneeN1} />
              <div className="segments petits" role="group" aria-label="Regroupement">
                {(['jour', 'mois', 'annee'] as const).map((g) => (
                  <button key={g} className={s.granularite === g ? 'actif' : ''} onClick={() => onGranularite(g)}>{g === 'jour' ? 'Jour' : g === 'mois' ? 'Mois' : 'Année'}</button>
                ))}
              </div>
            </div>
          }
        >
          <div style={{ padding: '6px 14px 10px' }}>
            {s.serie.length ? <GraphiqueEvolution points={s.serie} avecMarge={voirMarge} /> : <div className="vide">Aucune donnée.</div>}
          </div>
        </Carte>
        <Carte titre="Récapitulatif" sousTitre={`${voirMarge ? 'CA et marge' : 'CA'} en FCFA, contre ${anneeN1}`}>
          <div className="defilement-tdb">
            <table className="tableau tableau-dense tableau-recap">
              <thead>
                <tr>
                  <th>{s.granularite === 'jour' ? 'Jour' : s.granularite === 'mois' ? 'Mois' : 'Année'}</th>
                  <th className="nombre">CA</th>
                  {voirMarge && <th className="nombre">Marge</th>}
                </tr>
              </thead>
              <tbody>
                {recap.length === 0 ? (
                  <tr><td colSpan={3} className="vide">Aucune vente sur la période.</td></tr>
                ) : (
                  recap.map((p) => (
                    <tr key={p.cle} title={`${anneeN1} : CA ${formaterMontant(p.caN1)}${voirMarge ? `, marge ${formaterMontant(p.margeN1)}` : ''}`}>
                      <td className="sans-retour">{libelleCle(p.cle, true)}</td>
                      <td className="nombre">
                        <strong>{m(p.ca)}</strong>
                        <div className="secondaire">{anneeN1} : {m(p.caN1)} <EcartTexte v={delta(p.ca, p.caN1)} /></div>
                      </td>
                      {voirMarge && (
                        <td className="nombre">
                          {m(p.marge)}
                          <div className="secondaire">{m(p.margeN1)} <EcartTexte v={delta(p.marge ?? 0, p.margeN1 ?? 0)} /></div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Carte>
      </div>

      <div className="grille-tdb grille-1-1">
        <Carte titre={`${Math.min(50, s.produits.length) || 50} meilleurs produits`} sousTitre="Classés par chiffre d’affaires">
          <div className="defilement-tdb">
            <table className="tableau tableau-dense">
              <thead>
                <tr><th style={{ width: 30 }}>#</th><th>Produit</th><th className="nombre">Pièces</th><th className="nombre">CA (FCFA)</th>{voirMarge && <th className="nombre">Marge</th>}<th className="nombre">Ventes</th></tr>
              </thead>
              <tbody>
                {s.produits.length === 0 ? (
                  <tr><td colSpan={6} className="vide">Aucune vente sur la période.</td></tr>
                ) : (
                  s.produits.map((p) => (
                    <tr key={p.id}>
                      <td className="secondaire">{p.rang}</td>
                      <td><strong>{p.libelle}</strong> <span className="secondaire">{p.code}</span></td>
                      <td className="nombre">{formaterNombre(p.pieces)}</td>
                      <td className="nombre"><strong>{m(p.ca)}</strong></td>
                      {voirMarge && <td className="nombre">{m(p.marge)}</td>}
                      <td className="nombre">{p.ventes}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Carte>
        <Carte titre="Classement des catégories" sousTitre={`Par chiffre d’affaires, contre ${anneeN1}`}>
          <div className="defilement-tdb">
            <table className="tableau tableau-dense">
              <thead>
                <tr><th style={{ width: 30 }}>#</th><th>Catégorie</th><th className="nombre">CA {anneeN1}</th><th className="nombre">CA (FCFA)</th>{voirMarge && <th className="nombre">Marge</th>}<th className="nombre">Ventes</th></tr>
              </thead>
              <tbody>
                {s.categories.length === 0 ? (
                  <tr><td colSpan={6} className="vide">Aucune vente sur la période.</td></tr>
                ) : (
                  s.categories.map((c, n) => (
                    <tr key={c.id}>
                      <td className="secondaire">{n + 1}</td>
                      <td><strong>{c.libelle}</strong></td>
                      <td className="nombre secondaire">{m(c.caN1)}</td>
                      <td className="nombre"><strong>{m(c.ca)}</strong><div><EcartTexte v={delta(c.ca, c.caN1)} /></div></td>
                      {voirMarge && <td className="nombre">{m(c.marge)}</td>}
                      <td className="nombre">{c.ventes}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Carte>
      </div>

      <Carte titre="Performances par client" sousTitre="Activité de chaque client sur la période">
        <table className="tableau tableau-dense">
          <thead>
            <tr>
              <th>Client</th><th>Type</th><th className="nombre">CA</th>{voirMarge && <th className="nombre">Marge</th>}<th className="nombre">Ventes</th><th className="nombre">Panier moyen</th><th className="nombre">Avoirs</th>
              {!s.sesVentesSeulement && <th>Paiement</th>}
            </tr>
          </thead>
          <tbody>
            {s.clients.length === 0 ? (
              <tr><td colSpan={8} className="vide">Aucune vente sur la période.</td></tr>
            ) : (
              s.clients.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.libelle}</strong></td>
                  <td>{TYPES_CLIENTS[c.type]}</td>
                  <td className="nombre"><strong>{formaterMontant(c.ca)}</strong></td>
                  {voirMarge && <td className="nombre">{formaterMontant(c.marge)}</td>}
                  <td className="nombre">{c.ventes}</td>
                  <td className="nombre">{formaterMontant(c.panierMoyen)}</td>
                  <td className="nombre">{c.avoirs ? formaterMontant(c.avoirs) : '-'}</td>
                  {!s.sesVentesSeulement && (
                    <td>{c.resteDu ? <span className="pastille orange">Doit {formaterMontant(c.resteDu)}</span> : <span className="pastille verte">À jour</span>}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Carte>
    </>
  );
}

function EcartTexte({ v }: { v: number | null }) {
  if (v == null) return <span className="secondaire">-</span>;
  return <span className={v >= 0 ? 'texte-hausse' : 'texte-baisse'}>{pct(v)}</span>;
}

// ------------------------------------------------------------------ onglets stock et trésorerie

function OngletStock({ g, valeur }: { g: Global; valeur?: Synthese['stock'] }) {
  const s = g.stock;
  if (!s) return <div className="vide">Module Stock désactivé.</div>;
  return (
    <>
      <div className="grille-kpi">
        {valeur && <Kpi icone="stock" libelle="Valeur au prix de vente" valeur={formaterMontant(valeur.valeurVente)} detail={`${formaterNombre(valeur.pieces)} pièces, ${valeur.produits} produits`} />}
        {s.valeur !== undefined && <Kpi icone="rapports" libelle="Valeur au coût" valeur={formaterMontant(s.valeur)} detail="coût moyen pondéré" />}
        <Kpi icone="stock" libelle="Sous le seuil d’alerte" valeur={String(s.nbStockBas)} detail="produit(s) à réapprovisionner" />
        <Kpi icone="journal" libelle="Lots à écouler" valeur={String(s.nbLotsAEcouler)} detail={`péremption sous ${s.delaiPeremptionJours} jours`} />
        <Kpi icone="fermer" libelle="Lots périmés" valeur={String(s.nbLotsPerimes)} detail="à retirer de la vente" />
      </div>
      <div className="grille-tdb grille-1-1">
        <Carte titre="Produits sous le seuil d’alerte" droite={<a href="#/stock" className="lien-tdb">Voir le stock</a>}>
          <table className="tableau tableau-dense">
            <thead><tr><th>Produit</th><th className="nombre">Stock</th><th className="nombre">Seuil</th></tr></thead>
            <tbody>
              {s.stockBas.length === 0 ? <tr><td colSpan={3} className="vide">Aucun produit sous le seuil.</td></tr> : s.stockBas.map((p) => (
                <tr key={p.id}><td><strong>{p.designation}</strong> <span className="secondaire">{p.code}</span></td><td className="nombre"><span className="pastille orange">{formaterNombre(p.stock)}</span></td><td className="nombre">{p.seuil}</td></tr>
              ))}
            </tbody>
          </table>
        </Carte>
        <Carte titre="Lots proches de la péremption" droite={<a href="#/rapports" className="lien-tdb">Rapport de stock</a>}>
          <table className="tableau tableau-dense">
            <thead><tr><th>Produit</th><th>Lot</th><th className="nombre">Pièces</th><th>Péremption</th></tr></thead>
            <tbody>
              {s.lots.length === 0 ? <tr><td colSpan={4} className="vide">Aucun lot à écouler.</td></tr> : s.lots.map((l, i) => (
                <tr key={i}><td><strong>{l.produit}</strong></td><td>{l.numero || '-'}</td><td className="nombre">{formaterNombre(l.quantite)}</td><td><span className={`pastille ${l.perime ? 'rouge' : 'orange'}`}>{l.perime ? 'Périmé' : 'Exp.'} {formaterJour(l.peremption)}</span></td></tr>
              ))}
            </tbody>
          </table>
        </Carte>
      </div>
    </>
  );
}

function OngletTresorerie({ g }: { g: Global }) {
  const t = g.tresorerie;
  if (!t) return <div className="vide">Trésorerie réservée au gérant et au caissier.</div>;
  return (
    <>
      <div className="grille-kpi">
        <Kpi icone="tresorerie" libelle="Caisse espèces" valeur={t.parType.caisse != null ? formaterMontant(t.parType.caisse) : '•••••'} detail={t.parType.caisse == null ? 'visible du gérant (clôture à l’aveugle)' : 'solde actuel'} />
        <Kpi icone="tresorerie" libelle="Mobile Money" valeur={formaterMontant(t.parType.mobile_money ?? 0)} detail="solde actuel" />
        <Kpi icone="tresorerie" libelle="Banque" valeur={formaterMontant(t.parType.banque ?? 0)} detail="solde actuel" />
        <Kpi icone="ventes" libelle="Encaissé aujourd’hui" valeur={formaterMontant(t.encaissementsJour)} detail={g.ventes?.aEncaisser ? `reste à encaisser : ${formaterMontant(g.ventes.aEncaisser.montant)}` : undefined} />
        <Kpi icone="achats" libelle="Dettes fournisseurs" valeur={formaterMontant(t.dettesFournisseurs)} detail={`dépenses du mois : ${formaterMontant(t.depensesMois)}`} />
      </div>
      <p className="secondaire" style={{ color: 'var(--texte-3)' }}>Le détail des comptes, encaissements et dépenses est dans <a href="#/tresorerie">Trésorerie</a>.</p>
    </>
  );
}

// ------------------------------------------------------------------ page

type Onglet = 'ventes' | 'stock' | 'tresorerie';

/** Tableau de bord (§5.1). */
export function TableauDeBord() {
  const { profil, appeler, peut } = useSession();
  const voitVentes = peut(PERMISSIONS.TABLEAU_DE_BORD_COMPLET) || peut(PERMISSIONS.RAPPORTS_SES_VENTES);
  const voirMarge = peut(PERMISSIONS.COUTS_VOIR);
  const [onglet, setOnglet] = useState<Onglet>(voitVentes ? 'ventes' : 'stock');
  const [, d, a] = periodesUsuelles()[2];
  const [du, setDu] = useState(d);
  const [au, setAu] = useState(a);
  const [granularite, setGranularite] = useState<'jour' | 'mois' | 'annee'>();
  const [filtres, setFiltres] = useState({ categorieId: '', produitId: '', clientId: '' });
  const [synthese, setSynthese] = useState<Synthese>();
  const [global, setGlobal] = useState<Global>();
  const [listes, setListes] = useState<{ categories: { id: string; nom: string }[]; produits: { id: string; code: string; designation: string; categorieId: string }[]; clients: { id: string; raisonSociale: string }[] }>({ categories: [], produits: [], clients: [] });
  const [alertesSauvegarde, setAlertesSauvegarde] = useState<string[]>([]);
  const [miseEnService, setMiseEnService] = useState<{ faites: number; total: number; termine: boolean }>();
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();

  useEffect(() => {
    appeler<Global>('GET', '/tableau-de-bord').then(setGlobal).catch(() => undefined);
    if (peut('admin.sauvegardes')) appeler<{ alertes: string[] }>('GET', '/sauvegardes').then((e) => setAlertesSauvegarde(e.alertes)).catch(() => undefined);
    if (peut('admin.parametres')) appeler<{ faites: number; total: number; termine: boolean }>('GET', '/mise-en-service').then(setMiseEnService).catch(() => undefined);
    void Promise.all([
      appeler<{ id: string; nom: string }[]>('GET', '/categories').catch(() => []),
      appeler<{ id: string; code: string; designation: string; categorieId: string }[]>('GET', '/produits').catch(() => []),
      peut(PERMISSIONS.VENTES_SAISIR) ? appeler<{ id: string; raisonSociale: string }[]>('GET', '/clients').catch(() => []) : Promise.resolve([]),
    ]).then(([categories, produits, clients]) => setListes({ categories, produits, clients }));
  }, [appeler, peut]);

  useEffect(() => {
    if (!voitVentes) return;
    setChargement(true);
    const q = new URLSearchParams({ du, au });
    if (granularite) q.set('granularite', granularite);
    for (const [k, v] of Object.entries(filtres)) if (v) q.set(k, v);
    appeler<Synthese>('GET', `/tableau-de-bord/synthese?${q}`)
      .then((s) => (setSynthese(s), setErreur(undefined)))
      .catch((e) => setErreur(messageErreur(e)))
      .finally(() => setChargement(false));
  }, [appeler, voitVentes, du, au, granularite, filtres]);

  const produitsFiltres = useMemo(() => listes.produits.filter((p) => !filtres.categorieId || p.categorieId === filtres.categorieId), [listes.produits, filtres.categorieId]);

  const exporter = async () => {
    if (!synthese) return;
    setInfo(undefined);
    const s = synthese;
    const marge = voirMarge;
    const titre = `Tableau de bord du ${formaterJour(s.du)} au ${formaterJour(s.au)}`;
    const fichier = creerClasseur([
      {
        titre,
        nomFeuille: 'Indicateurs',
        sousTitre: `Comparaison avec le ${formaterJour(s.duN1)} au ${formaterJour(s.auN1)}`,
        colonnes: [{ titre: 'Indicateur', type: 'texte' }, { titre: 'Période', type: 'montant' }, { titre: 'Année précédente', type: 'montant' }, { titre: 'Écart', type: 'pct' }],
        lignes: [
          ['Chiffre d’affaires HT', s.indicateurs.ca.valeur, s.indicateurs.ca.n1, s.indicateurs.ca.variation],
          ...(s.indicateurs.marge ? [['Marge brute', s.indicateurs.marge.valeur, s.indicateurs.marge.n1, s.indicateurs.marge.variation]] : []),
          ['Nombre de ventes', s.indicateurs.ventes.valeur, s.indicateurs.ventes.n1, s.indicateurs.ventes.variation],
          ['Panier moyen', s.indicateurs.panierMoyen.valeur, s.indicateurs.panierMoyen.n1, s.indicateurs.panierMoyen.variation],
          ['Valeur du stock (prix de vente)', s.stock.valeurVente, null, null],
        ],
      },
      {
        titre: 'Évolution',
        colonnes: [{ titre: 'Période', type: 'texte' }, { titre: 'CA', type: 'montant' }, { titre: 'CA an dernier', type: 'montant' }, ...(marge ? ([{ titre: 'Marge', type: 'montant' }, { titre: 'Marge an dernier', type: 'montant' }] as const) : [])],
        lignes: s.serie.map((p) => [libelleCle(p.cle, true), p.ca, p.caN1, ...(marge ? [p.marge, p.margeN1] : [])]),
      },
      {
        titre: 'Meilleurs produits',
        colonnes: [{ titre: 'Rang', type: 'nombre', largeur: 8 }, { titre: 'Produit', type: 'texte' }, { titre: 'Code', type: 'texte', largeur: 10 }, { titre: 'Pièces', type: 'nombre' }, { titre: 'CA', type: 'montant' }, ...(marge ? ([{ titre: 'Marge', type: 'montant' }] as const) : []), { titre: 'Ventes', type: 'nombre' }],
        lignes: s.produits.map((p) => [p.rang, p.libelle, p.code, p.pieces, p.ca, ...(marge ? [p.marge] : []), p.ventes]),
      },
      {
        titre: 'Catégories',
        colonnes: [{ titre: 'Catégorie', type: 'texte' }, { titre: 'CA an dernier', type: 'montant' }, { titre: 'CA', type: 'montant' }, ...(marge ? ([{ titre: 'Marge', type: 'montant' }] as const) : []), { titre: 'Ventes', type: 'nombre' }],
        lignes: s.categories.map((c) => [c.libelle, c.caN1, c.ca, ...(marge ? [c.marge] : []), c.ventes]),
      },
      {
        titre: 'Clients',
        colonnes: [{ titre: 'Client', type: 'texte' }, { titre: 'CA', type: 'montant' }, ...(marge ? ([{ titre: 'Marge', type: 'montant' }] as const) : []), { titre: 'Ventes', type: 'nombre' }, { titre: 'Panier moyen', type: 'montant' }, { titre: 'Avoirs', type: 'montant' }, { titre: 'Reste dû', type: 'montant' }],
        lignes: s.clients.map((c) => [c.libelle, c.ca, ...(marge ? [c.marge] : []), c.ventes, c.panierMoyen, c.avoirs, c.resteDu]),
      },
    ]);
    const r = await window.somidac.documents.enregistrerFichier(`Tableau-de-bord-${s.du}-${s.au}`, 'xlsx', fichier);
    if (!r.ok) setErreur(r.message);
    else if (r.valeur) setInfo(`Fichier Excel enregistré : ${r.valeur}`);
  };

  const g = global;
  const alertes: { type: 'attention' | 'erreur'; texte: ReactNode }[] = [];
  if (miseEnService && !miseEnService.termine) alertes.push({ type: 'attention', texte: <>Mise en service : {miseEnService.faites} étape(s) sur {miseEnService.total} terminée(s). <a href="#/mise-en-service">Continuer</a></> });
  for (const x of alertesSauvegarde) alertes.push({ type: 'attention', texte: <>{x} <a href="#/sauvegardes">Ouvrir les sauvegardes</a></> });
  if (g?.tresorerie?.cloturesAValider && peut('caisse.valider')) alertes.push({ type: 'attention', texte: <>{g.tresorerie.cloturesAValider} clôture(s) de caisse à valider. <a href="#/tresorerie">Ouvrir la trésorerie</a></> });
  for (const e of g?.alertes?.ecartsCaisse ?? []) alertes.push({ type: 'erreur', texte: `Écart de caisse de ${formaterMontant(e.ecart)} le ${formaterJour(e.jour)} (${e.compte}).` });
  for (const e of g?.alertes?.ecartsInventaire ?? []) alertes.push({ type: 'erreur', texte: `Écart d’inventaire de ${formaterMontant(e.valeur)} (« ${e.libelle} »).` });
  if (g?.alertes?.horsHeures) alertes.push({ type: 'attention', texte: <>{g.alertes.horsHeures} opération(s) hors des heures d’ouverture ces 7 derniers jours. <a href="#/rapports">Voir les actions sensibles</a></> });
  if (g?.ventes?.facturesEnRetard?.nombre) alertes.push({ type: 'attention', texte: <>{g.ventes.facturesEnRetard.nombre} facture(s) en retard de paiement : {formaterMontant(g.ventes.facturesEnRetard.montant)}. <a href="#/ventes">Voir les factures</a></> });

  const onglets: [Onglet, string, boolean][] = [
    ['ventes', 'Synthèse des ventes', voitVentes],
    ['stock', 'Stock', !!g?.stock],
    ['tresorerie', 'Trésorerie', !!g?.tresorerie],
  ];

  return (
    <div className="tdb">
      <div className="barre-tdb">
        <div>
          <div className="segments onglets-tdb" role="tablist">
            {onglets.filter(([, , v]) => v).map(([o, l]) => (
              <button key={o} role="tab" aria-selected={onglet === o} className={onglet === o ? 'actif' : ''} onClick={() => setOnglet(o)}>{l}</button>
            ))}
          </div>
          <span className="bonjour-tdb">Bonjour {profil?.nomComplet.split(' ')[0]} · {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date())}</span>
        </div>
        <div className="pastilles-tdb">
          {g?.stock && <Pastille icone="stock" nombre={g.stock.nbStockBas + g.stock.nbLotsAEcouler + g.stock.nbLotsPerimes} titre="Alertes de stock" lien="#/stock" />}
          {g?.ventes?.aEncaisser && <Pastille icone="tresorerie" nombre={g.ventes.aEncaisser.nombre} titre="Factures à encaisser" lien="#/ventes" />}
          {g?.alertes && <Pastille icone="journal" nombre={g.alertes.sensiblesAujourdhui} titre="Actions sensibles du jour" lien="#/rapports" />}
        </div>
      </div>

      {alertes.length > 0 && (
        <div className="alertes-tdb" role="status">
          {alertes.map((x, n) => (
            <div key={n} className={`alerte-tdb ${x.type}`}>
              <span className="point-alerte" aria-hidden="true" />
              <span>{x.texte}</span>
            </div>
          ))}
        </div>
      )}

      {onglet === 'ventes' && (
        <>
          <div className="filtres-tdb">
            <ChoixPeriode du={du} au={au} onChange={(x, y) => (setDu(x), setAu(y), setGranularite(undefined))} />
            <select value={filtres.categorieId} onChange={(e) => setFiltres({ ...filtres, categorieId: e.target.value, produitId: '' })} aria-label="Catégorie">
              <option value="">Toutes les catégories</option>
              {listes.categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            <select value={filtres.produitId} onChange={(e) => setFiltres({ ...filtres, produitId: e.target.value })} aria-label="Produit">
              <option value="">Tous les produits</option>
              {produitsFiltres.map((p) => <option key={p.id} value={p.id}>{p.designation}</option>)}
            </select>
            {listes.clients.length > 0 && (
              <select value={filtres.clientId} onChange={(e) => setFiltres({ ...filtres, clientId: e.target.value })} aria-label="Client">
                <option value="">Tous les clients</option>
                {listes.clients.map((c) => <option key={c.id} value={c.id}>{c.raisonSociale}</option>)}
              </select>
            )}
            <button className="bouton secondaire" style={{ marginLeft: 'auto' }} disabled={!synthese} onClick={() => void exporter()}>Exporter</button>
          </div>
          <Message type="erreur">{erreur}</Message>
          <Message type="succes">{info}</Message>
          {synthese ? (
            <div style={{ opacity: chargement ? 0.55 : 1, transition: 'opacity 0.15s' }}>
              <SyntheseVentes s={synthese} voirMarge={voirMarge && !!synthese.indicateurs.marge} onGranularite={setGranularite} />
            </div>
          ) : (
            <div className="vide">Chargement…</div>
          )}
        </>
      )}
      {onglet === 'stock' && g && <OngletStock g={g} valeur={synthese?.stock} />}
      {onglet === 'tresorerie' && g && <OngletTresorerie g={g} />}
    </div>
  );
}
