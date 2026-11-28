import { PERMISSIONS, TYPES_COMPTES, TypeCompte } from '@somidac/shared';
import { useEffect, useMemo, useState } from 'react';
import { Message } from '../../composants/communs';
import { CarteRapport, ChoixPeriode, DonneesRapport, libellePeriode, periodesUsuelles } from '../../composants/Rapport';
import { messageErreur, useSession } from '../../contexte';
import { aujourdhuiIso, formaterDateHeure, formaterJour, formaterMontant } from '../../format';

function useRapport<T>(chemin: string | undefined) {
  const { appeler } = useSession();
  const [donnees, setDonnees] = useState<T>();
  const [erreur, setErreur] = useState<string>();
  useEffect(() => {
    if (!chemin) return;
    setDonnees(undefined);
    setErreur(undefined);
    appeler<T>('GET', chemin).then(setDonnees).catch((e) => setErreur(messageErreur(e)));
  }, [appeler, chemin]);
  return { donnees, erreur };
}

const moisCourant = () => periodesUsuelles()[2];

// ------------------------------------------------------------------ ventes et marges

interface LigneVente {
  cle: string;
  libelle: string;
  detail: string | null;
  pieces: number;
  factures: number;
  ca: number;
  cout?: number;
  marge?: number;
  tauxMarge?: number | null;
}
interface RapportVentes {
  sesVentesSeulement: boolean;
  lignes: LigneVente[];
  totaux: Omit<LigneVente, 'cle' | 'libelle' | 'detail'>;
}

const GROUPES: [string, string][] = [
  ['jour', 'Par jour'],
  ['mois', 'Par mois'],
  ['client', 'Par client'],
  ['produit', 'Par produit'],
  ['categorie', 'Par catégorie'],
  ['vendeur', 'Par commercial'],
];

function Ventes() {
  const [, d, a] = moisCourant();
  const [du, setDu] = useState(d);
  const [au, setAu] = useState(a);
  const [groupe, setGroupe] = useState('produit');
  const { donnees, erreur } = useRapport<RapportVentes>(`/rapports/ventes?du=${du}&au=${au}&groupe=${groupe}`);
  const rapport = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    const couts = donnees.totaux.marge !== undefined;
    const libelleGroupe = GROUPES.find(([g]) => g === groupe)![1].toLowerCase();
    const titreColonne = { jour: 'Jour', mois: 'Mois', client: 'Client', produit: 'Produit', categorie: 'Catégorie', vendeur: 'Commercial' }[groupe]!;
    return {
      titre: `${couts ? 'Ventes et marges' : 'Ventes'} ${libelleGroupe}${donnees.sesVentesSeulement ? ' (mes ventes)' : ''}`,
      sousTitre: `${libellePeriode(du, au)} · montants hors taxe, avoirs déduits`,
      nomFichier: `Ventes-${groupe}-${du}-${au}`,
      colonnes: [
        { titre: titreColonne, type: 'texte', detail: 99 },
        { titre: 'Factures', type: 'nombre', largeur: 10 },
        { titre: 'Pièces', type: 'nombre', largeur: 10 },
        { titre: 'Chiffre d’affaires HT', type: 'montant' },
        ...(couts ? ([{ titre: 'Coût', type: 'montant' }, { titre: 'Marge', type: 'montant' }, { titre: 'Taux de marge', type: 'pct', largeur: 12 }] as const) : []),
      ],
      lignes: donnees.lignes.map((l) => {
        const ligne = [l.libelle, l.factures, l.pieces, l.ca, ...(couts ? [l.cout, l.marge, l.tauxMarge] : [])];
        ligne[99] = l.detail;
        return ligne;
      }),
      totaux: ['Total', donnees.totaux.factures, donnees.totaux.pieces, donnees.totaux.ca, ...(couts ? [donnees.totaux.cout, donnees.totaux.marge, donnees.totaux.tauxMarge] : [])],
    };
  }, [donnees, du, au, groupe]);
  return (
    <>
      <div className="barre-outils">
        <ChoixPeriode du={du} au={au} onChange={(x, y) => (setDu(x), setAu(y))} />
      </div>
      <Message type="erreur">{erreur}</Message>
      <CarteRapport
        r={rapport}
        vide="Aucune vente facturée sur cette période."
        entete={
          <select value={groupe} onChange={(e) => setGroupe(e.target.value)} style={{ height: 30, borderRadius: 6, border: '1px solid var(--bord)' }} aria-label="Regroupement">
            {GROUPES.map(([g, l]) => <option key={g} value={g}>{l}</option>)}
          </select>
        }
      />
    </>
  );
}

// ------------------------------------------------------------------ stock

interface RapportStock {
  jours: number;
  produits: { designation: string; code: string; categorie: string; stock: number; seuil: number; ventes: number; derniereVente: string | null; couverture: number | null; rotationLente: boolean; cmp?: number; valeur?: number }[];
  lots: { produit: string; code: string; numero: string; datePeremption: string; quantite: number; perime: boolean; valeur?: number }[];
  totaux: { produits: number; pieces: number; rotationLente: number; valeur?: number };
}

function Stock() {
  const [jours, setJours] = useState(90);
  const [lentsSeulement, setLentsSeulement] = useState(false);
  const { donnees, erreur } = useRapport<RapportStock>(`/rapports/stock?jours=${jours}`);
  const valeurs = donnees?.totaux.valeur !== undefined;
  const produits = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    const liste = donnees.produits.filter((p) => !lentsSeulement || p.rotationLente);
    return {
      titre: lentsSeulement ? 'Produits qui tournent lentement' : 'Stock valorisé',
      sousTitre: `Au ${formaterJour(aujourdhuiIso())} · ventes des ${jours} derniers jours${valeurs ? ' · valeur au coût moyen' : ''}`,
      nomFichier: lentsSeulement ? `Rotation-lente-${aujourdhuiIso()}` : `Stock-valorise-${aujourdhuiIso()}`,
      colonnes: [
        { titre: 'Produit', type: 'texte', detail: 99 },
        { titre: 'Catégorie', type: 'texte', largeur: 20 },
        { titre: 'Stock (pièces)', type: 'nombre' },
        { titre: `Vendu (${jours} j)`, type: 'nombre' },
        { titre: 'Couverture (jours)', type: 'nombre' },
        { titre: 'Dernière vente', type: 'date', largeur: 14 },
        ...(valeurs ? ([{ titre: 'Coût moyen', type: 'montant' }, { titre: 'Valeur', type: 'montant' }] as const) : []),
      ],
      lignes: liste.map((p) => {
        const l = [p.designation, p.categorie, p.stock, p.ventes, p.couverture ?? (p.stock > 0 ? 'Aucune vente' : 0), p.derniereVente ? new Date(p.derniereVente).toISOString().slice(0, 10) : null, ...(valeurs ? [p.cmp, p.valeur] : [])];
        l[99] = `${p.code}${p.rotationLente ? ' · rotation lente' : ''}`;
        return l;
      }),
      totaux: ['Total', null, liste.reduce((t, p) => t + p.stock, 0), liste.reduce((t, p) => t + p.ventes, 0), null, null, ...(valeurs ? [null, liste.reduce((t, p) => t + (p.valeur ?? 0), 0)] : [])],
    };
  }, [donnees, jours, lentsSeulement, valeurs]);
  const lots = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    return {
      titre: 'Lots proches de la péremption',
      sousTitre: `Au ${formaterJour(aujourdhuiIso())} · périmés en tête`,
      nomFichier: `Lots-a-ecouler-${aujourdhuiIso()}`,
      colonnes: [
        { titre: 'Produit', type: 'texte', detail: 99 },
        { titre: 'Lot', type: 'texte', largeur: 14 },
        { titre: 'Péremption', type: 'date', largeur: 14 },
        { titre: 'État', type: 'texte', largeur: 12 },
        { titre: 'Pièces', type: 'nombre' },
        ...(valeurs ? ([{ titre: 'Valeur', type: 'montant' }] as const) : []),
      ],
      lignes: donnees.lots.map((l) => {
        const x = [l.produit, l.numero || 'Sans lot', l.datePeremption, l.perime ? 'Périmé' : 'À écouler', l.quantite, ...(valeurs ? [l.valeur] : [])];
        x[99] = l.code;
        return x;
      }),
      totaux: ['Total', null, null, null, donnees.lots.reduce((t, l) => t + l.quantite, 0), ...(valeurs ? [donnees.lots.reduce((t, l) => t + (l.valeur ?? 0), 0)] : [])],
    };
  }, [donnees, valeurs]);
  return (
    <>
      {donnees && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          {valeurs && <div className="carte indicateur"><div className="libelle">Valeur du stock</div><div className="valeur">{formaterMontant(donnees.totaux.valeur)}</div><div className="detail">au coût moyen pondéré</div></div>}
          <div className="carte indicateur"><div className="libelle">Pièces en stock</div><div className="valeur">{donnees.totaux.pieces.toLocaleString('fr-FR')}</div><div className="detail">{donnees.totaux.produits} produits actifs</div></div>
          <button className={`carte indicateur filtre-type ${lentsSeulement ? 'actif' : ''}`} onClick={() => setLentsSeulement(!lentsSeulement)}>
            <div className="libelle">Rotation lente</div>
            <div className="valeur" style={{ color: donnees.totaux.rotationLente ? 'var(--alerte)' : undefined }}>{donnees.totaux.rotationLente}</div>
            <div className="detail">stock pour plus de {jours * 2} jours, ou aucune vente</div>
          </button>
          <div className="carte indicateur"><div className="libelle">Lots à écouler</div><div className="valeur">{donnees.lots.length}</div><div className="detail">dont {donnees.lots.filter((l) => l.perime).length} périmé(s)</div></div>
        </div>
      )}
      <Message type="erreur">{erreur}</Message>
      <CarteRapport
        r={produits}
        vide={lentsSeulement ? 'Aucun produit à rotation lente.' : 'Aucun produit.'}
        entete={
          <select value={jours} onChange={(e) => setJours(Number(e.target.value))} style={{ height: 30, borderRadius: 6, border: '1px solid var(--bord)' }} aria-label="Période de vente">
            {[30, 60, 90, 180].map((j) => <option key={j} value={j}>Ventes sur {j} jours</option>)}
          </select>
        }
      />
      <div style={{ height: 16 }} />
      <CarteRapport r={lots} vide="Aucun lot proche de la péremption." />
    </>
  );
}

// ------------------------------------------------------------------ achats

interface RapportAchats {
  lignes: { libelle: string; detail?: string; achats: number; pieces?: number; montant: number; frais: number; total: number; paye?: number; reste?: number }[];
  totaux: { achats?: number; pieces?: number; montant: number; frais: number; total: number; paye?: number; reste?: number };
}

function Achats() {
  const [, d, a] = moisCourant();
  const [du, setDu] = useState(d);
  const [au, setAu] = useState(a);
  const [groupe, setGroupe] = useState<'fournisseur' | 'produit'>('fournisseur');
  const { donnees, erreur } = useRapport<RapportAchats>(`/rapports/achats?du=${du}&au=${au}&groupe=${groupe}`);
  const rapport = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    const parF = groupe === 'fournisseur';
    return {
      titre: parF ? 'Achats par fournisseur' : 'Achats par produit',
      sousTitre: `${libellePeriode(du, au)} · achats validés`,
      nomFichier: `Achats-${groupe}-${du}-${au}`,
      colonnes: parF
        ? [
            { titre: 'Fournisseur', type: 'texte' },
            { titre: 'Achats', type: 'nombre', largeur: 10 },
            { titre: 'Marchandises', type: 'montant' },
            { titre: 'Frais d’approche', type: 'montant' },
            { titre: 'Total', type: 'montant' },
            { titre: 'Payé', type: 'montant' },
            { titre: 'Reste à payer', type: 'montant' },
          ]
        : [
            { titre: 'Produit', type: 'texte', detail: 99 },
            { titre: 'Achats', type: 'nombre', largeur: 10 },
            { titre: 'Pièces', type: 'nombre' },
            { titre: 'Marchandises', type: 'montant' },
            { titre: 'Frais d’approche', type: 'montant' },
            { titre: 'Coût total', type: 'montant' },
          ],
      lignes: donnees.lignes.map((l) => {
        if (parF) return [l.libelle, l.achats, l.montant, l.frais, l.total, l.paye, l.reste];
        const x = [l.libelle, l.achats, l.pieces, l.montant, l.frais, l.total];
        x[99] = l.detail;
        return x;
      }),
      totaux: parF
        ? ['Total', donnees.totaux.achats, donnees.totaux.montant, donnees.totaux.frais, donnees.totaux.total, donnees.totaux.paye, donnees.totaux.reste]
        : ['Total', null, donnees.totaux.pieces, donnees.totaux.montant, donnees.totaux.frais, donnees.totaux.total],
    };
  }, [donnees, du, au, groupe]);
  return (
    <>
      <div className="barre-outils"><ChoixPeriode du={du} au={au} onChange={(x, y) => (setDu(x), setAu(y))} /></div>
      <Message type="erreur">{erreur}</Message>
      <CarteRapport
        r={rapport}
        vide="Aucun achat validé sur cette période."
        entete={
          <select value={groupe} onChange={(e) => setGroupe(e.target.value as 'fournisseur' | 'produit')} style={{ height: 30, borderRadius: 6, border: '1px solid var(--bord)' }} aria-label="Regroupement">
            <option value="fournisseur">Par fournisseur</option>
            <option value="produit">Par produit</option>
          </select>
        }
      />
    </>
  );
}

// ------------------------------------------------------------------ trésorerie

interface RapportTresorerie {
  comptes: { nom: string; type: TypeCompte; masque: boolean; debut: number | null; entrees: number | null; sorties: number | null; fin: number | null }[];
}

function Tresorerie() {
  const [, d, a] = moisCourant();
  const [du, setDu] = useState(d);
  const [au, setAu] = useState(a);
  const { donnees, erreur } = useRapport<RapportTresorerie>(`/rapports/tresorerie?du=${du}&au=${au}`);
  const rapport = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    const visibles = donnees.comptes.filter((c) => !c.masque);
    const somme = (k: 'debut' | 'entrees' | 'sorties' | 'fin') => visibles.reduce((t, c) => t + (c[k] ?? 0), 0);
    return {
      titre: 'Trésorerie par compte',
      sousTitre: libellePeriode(du, au) + (visibles.length < donnees.comptes.length ? ' · caisse visible du gérant seulement' : ''),
      nomFichier: `Tresorerie-${du}-${au}`,
      colonnes: [
        { titre: 'Compte', type: 'texte', detail: 99 },
        { titre: 'Solde au début', type: 'montant' },
        { titre: 'Entrées', type: 'montant' },
        { titre: 'Sorties', type: 'montant' },
        { titre: 'Solde à la fin', type: 'montant' },
      ],
      lignes: donnees.comptes.map((c) => {
        const l = c.masque ? [c.nom, 'Masqué', 'Masqué', 'Masqué', 'Masqué'] : [c.nom, c.debut, c.entrees, c.sorties, c.fin];
        l[99] = TYPES_COMPTES[c.type];
        return l;
      }),
      totaux: ['Total' + (visibles.length < donnees.comptes.length ? ' (hors caisse)' : ''), somme('debut'), somme('entrees'), somme('sorties'), somme('fin')],
    };
  }, [donnees, du, au]);
  return (
    <>
      <div className="barre-outils"><ChoixPeriode du={du} au={au} onChange={(x, y) => (setDu(x), setAu(y))} /></div>
      <Message type="erreur">{erreur}</Message>
      <CarteRapport r={rapport} />
    </>
  );
}

// ------------------------------------------------------------------ résultat du mois

interface Resultat {
  mois: string;
  ventes: number;
  coutMarchandises: number;
  margeBrute: number;
  tauxMarge: number | null;
  depenses: { categorie: string; montant: number }[];
  totalDepenses: number;
  pertesStock: { libelle: string; valeur: number }[];
  totalPertesStock: number;
  resultat: number;
  tvaCollectee: number;
}

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function ResultatMois() {
  const [mois, setMois] = useState(aujourdhuiIso().slice(0, 7));
  const { donnees, erreur } = useRapport<Resultat>(`/rapports/resultat?mois=${mois}`);
  const nomMois = `${NOMS_MOIS[Number(mois.slice(5)) - 1]} ${mois.slice(0, 4)}`;
  const rapport = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    const l: (string | number | null)[][] = [
      ['Ventes (hors taxe, avoirs déduits)', donnees.ventes],
      ['Coût des marchandises vendues', -donnees.coutMarchandises],
      [`Marge brute${donnees.tauxMarge != null ? ` (${donnees.tauxMarge.toLocaleString('fr-FR')} %)` : ''}`, donnees.margeBrute],
      ...donnees.depenses.map((d) => [`Dépense : ${d.categorie}`, -d.montant]),
      ...donnees.pertesStock.map((p) => [`Stock : ${p.libelle}`, p.valeur]),
    ];
    return {
      titre: `Résultat simplifié de ${nomMois}`,
      sousTitre: 'Ventes - coût des marchandises vendues - dépenses - pertes de stock',
      nomFichier: `Resultat-${mois}`,
      colonnes: [
        { titre: 'Poste', type: 'texte', largeur: 46 },
        { titre: 'Montant (FCFA)', type: 'montant', largeur: 18 },
      ],
      lignes: l,
      totaux: [donnees.resultat >= 0 ? 'Bénéfice du mois' : 'Perte du mois', donnees.resultat],
    };
  }, [donnees, mois, nomMois]);
  return (
    <>
      <div className="barre-outils">
        <label className="periode">Mois <input type="month" value={mois} max={aujourdhuiIso().slice(0, 7)} onChange={(e) => e.target.value && setMois(e.target.value)} /></label>
      </div>
      <Message type="erreur">{erreur}</Message>
      {donnees && (
        <div className="grille-cartes" style={{ marginBottom: 16 }}>
          <div className="carte indicateur"><div className="libelle">Ventes HT</div><div className="valeur">{formaterMontant(donnees.ventes)}</div></div>
          <div className="carte indicateur"><div className="libelle">Marge brute</div><div className="valeur">{formaterMontant(donnees.margeBrute)}</div><div className="detail">{donnees.tauxMarge != null ? `${donnees.tauxMarge.toLocaleString('fr-FR')} % des ventes` : ' '}</div></div>
          <div className="carte indicateur"><div className="libelle">Dépenses</div><div className="valeur">{formaterMontant(donnees.totalDepenses)}</div><div className="detail">Pertes de stock : {formaterMontant(-donnees.totalPertesStock)}</div></div>
          <div className={`carte indicateur ${donnees.resultat >= 0 ? 'bord-entree' : 'bord-sortie'}`}>
            <div className="libelle">{donnees.resultat >= 0 ? 'Bénéfice' : 'Perte'}</div>
            <div className="valeur" style={{ color: donnees.resultat >= 0 ? 'var(--succes)' : 'var(--danger)' }}>{formaterMontant(donnees.resultat)}</div>
            <div className="detail">{donnees.tvaCollectee ? `TVA collectée : ${formaterMontant(donnees.tvaCollectee)}` : ' '}</div>
          </div>
        </div>
      )}
      <CarteRapport r={rapport} />
    </>
  );
}

// ------------------------------------------------------------------ actions sensibles (§10.3)

interface ActionsSensibles {
  heureOuverture: string;
  heureFermeture: string;
  actions: { id: number; horodatage: string; action: string; libelle: string; horsHeures: boolean; utilisateur: string | null; details: Record<string, unknown> | null }[];
}

const LIBELLES_DETAILS: [string, string, 'montant' | 'texte' | 'pct'][] = [
  ['numero', 'n°', 'texte'],
  ['produit', 'produit', 'texte'],
  ['client', 'client', 'texte'],
  ['fournisseur', 'fournisseur', 'texte'],
  ['motif', 'motif', 'texte'],
  ['quantite', 'quantité', 'texte'],
  ['montant', 'montant', 'montant'],
  ['totalTTC', 'montant TTC', 'montant'],
  ['ecart', 'écart', 'montant'],
  ['remiseGlobalePct', 'remise sur le total', 'pct'],
  ['remisesLignes', 'lignes avec remise', 'texte'],
  ['identifiant', 'identifiant', 'texte'],
];

/** Détails utiles d'une entrée du journal, en clair. */
function resumeDetails(d: Record<string, unknown> | null): string {
  if (!d) return '';
  return LIBELLES_DETAILS.filter(([k]) => d[k] !== undefined && d[k] !== null && d[k] !== '' && !(k.startsWith('remise') && !Number(d[k])))
    .map(([k, l, t]) => `${l} : ${t === 'montant' ? formaterMontant(Number(d[k])) : t === 'pct' ? `${d[k]} %` : String(d[k])}`)
    .join(' · ');
}

function Sensibles() {
  const [du, setDu] = useState(aujourdhuiIso());
  const [au, setAu] = useState(aujourdhuiIso());
  const { donnees, erreur } = useRapport<ActionsSensibles>(`/rapports/actions-sensibles?du=${du}&au=${au}`);
  const rapport = useMemo<DonneesRapport | undefined>(() => {
    if (!donnees) return undefined;
    return {
      titre: 'Récapitulatif des actions sensibles',
      sousTitre: `${libellePeriode(du, au)} · heures d’ouverture ${donnees.heureOuverture} - ${donnees.heureFermeture}`,
      nomFichier: `Actions-sensibles-${du}-${au}`,
      colonnes: [
        { titre: 'Date et heure', type: 'texte', largeur: 18 },
        { titre: 'Action', type: 'texte', largeur: 30, detail: 99 },
        { titre: 'Par', type: 'texte', largeur: 20 },
        { titre: 'Hors heures', type: 'texte', largeur: 12 },
      ],
      lignes: donnees.actions.map((x) => {
        const l = [formaterDateHeure(x.horodatage), x.libelle, x.utilisateur ?? '-', x.horsHeures ? 'Oui' : ''];
        l[99] = resumeDetails(x.details);
        return l;
      }),
    };
  }, [donnees, du, au]);
  return (
    <>
      <div className="barre-outils"><ChoixPeriode du={du} au={au} onChange={(x, y) => (setDu(x), setAu(y))} /></div>
      <Message type="erreur">{erreur}</Message>
      <CarteRapport r={rapport} vide="Aucune action sensible sur cette période." />
    </>
  );
}

// ------------------------------------------------------------------ page

type Onglet = 'ventes' | 'stock' | 'achats' | 'tresorerie' | 'resultat' | 'sensibles';

/** Module « Rapports » (§5.7) : chaque rapport s'exporte en Excel et en PDF. */
export function Rapports() {
  const { peut } = useSession();
  const tous = peut(PERMISSIONS.RAPPORTS_TOUS);
  const onglets: [Onglet, string, boolean][] = [
    ['ventes', 'Ventes et marges', tous || peut(PERMISSIONS.RAPPORTS_SES_VENTES)],
    ['stock', 'Stock', tous || peut(PERMISSIONS.RAPPORTS_STOCK)],
    ['achats', 'Achats', tous],
    ['tresorerie', 'Trésorerie', tous],
    ['resultat', 'Résultat du mois', tous && peut(PERMISSIONS.COUTS_VOIR)],
    ['sensibles', 'Actions sensibles', peut(PERMISSIONS.AUDIT_VOIR)],
  ];
  const visibles = onglets.filter(([, , v]) => v);
  const [onglet, setOnglet] = useState<Onglet>(visibles[0]?.[0] ?? 'ventes');
  return (
    <>
      <div className="entete-page">
        <div>
          <h1>Rapports</h1>
        </div>
      </div>
      <div className="onglets">
        {visibles.map(([o, l]) => <button key={o} className={onglet === o ? 'actif' : ''} onClick={() => setOnglet(o)}>{l}</button>)}
      </div>
      {onglet === 'ventes' && <Ventes />}
      {onglet === 'stock' && <Stock />}
      {onglet === 'achats' && <Achats />}
      {onglet === 'tresorerie' && <Tresorerie />}
      {onglet === 'resultat' && <ResultatMois />}
      {onglet === 'sensibles' && <Sensibles />}
    </>
  );
}
