import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sites, utilisateurs } from './noyau';

/*
 * Lot 2 — Produits, fournisseurs, achats et stock (cahier des charges §5.2 à §5.4, §7).
 * Quantités : toujours en pièces entières. Montants : FCFA entiers.
 * Coût moyen pondéré : en centimes de FCFA (le coût d'une pièce peut ne pas tomber juste).
 */

const horodatage = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'date' });
const montant = (nom: string) => bigint(nom, { mode: 'number' });

export const typeCategorie = pgEnum('type_categorie', ['cosmetique', 'bazar']);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    type: typeCategorie('type').notNull(),
    actif: boolean('actif').notNull().default(true),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('categories_nom_uq').on(sql`lower(${t.nom})`)],
);

export const marques = pgTable(
  'marques',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('marques_nom_uq').on(sql`lower(${t.nom})`)],
);

export const produits = pgTable(
  'produits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    /** Code interne attribué automatiquement : P-0001… */
    code: text('code').notNull(),
    designation: text('designation').notNull(),
    categorieId: uuid('categorie_id')
      .notNull()
      .references(() => categories.id),
    marqueId: uuid('marque_id').references(() => marques.id),
    /** Lot et date de péremption obligatoires à la réception (cosmétiques). */
    suiviLot: boolean('suivi_lot').notNull().default(false),
    seuilAlerte: integer('seuil_alerte').notNull().default(0),
    /** Stock total en pièces (somme des mouvements, tenue à jour dans la même transaction). */
    stock: integer('stock').notNull().default(0),
    /** Coût moyen pondéré d'une pièce, en centimes de FCFA (règle R1). */
    cmpCentimes: bigint('cmp_centimes', { mode: 'number' }).notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    modifieLe: horodatage('modifie_le').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('produits_code_uq').on(t.code),
    index('produits_designation_idx').on(t.designation),
    check('produits_stock_positif', sql`${t.stock} >= 0`),
  ],
);

/** Unités d'achat et de vente : la pièce (toujours), et par exemple « Carton de 24 ». */
export const conditionnements = pgTable(
  'conditionnements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id, { onDelete: 'cascade' }),
    nom: text('nom').notNull(),
    nbPieces: integer('nb_pieces').notNull(),
    /** Prix de vente par défaut de ce conditionnement (FCFA), si vendu ainsi. */
    prixVente: montant('prix_vente'),
    actif: boolean('actif').notNull().default(true),
  },
  (t) => [
    index('conditionnements_produit_idx').on(t.produitId),
    check('conditionnements_nb_pieces', sql`${t.nbPieces} >= 1`),
  ],
);

export const codesBarres = pgTable(
  'codes_barres',
  {
    code: text('code').primaryKey(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id, { onDelete: 'cascade' }),
    conditionnementId: uuid('conditionnement_id').references(() => conditionnements.id, { onDelete: 'cascade' }),
  },
  (t) => [index('codes_barres_produit_idx').on(t.produitId)],
);

export const fournisseurs = pgTable(
  'fournisseurs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    telephone: text('telephone'),
    adresse: text('adresse'),
    nif: text('nif'),
    notes: text('notes'),
    actif: boolean('actif').notNull().default(true),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fournisseurs_nom_uq').on(sql`lower(${t.nom})`)],
);

/** Lots en stock (§5.4) : un lot par produit, numéro et date de péremption. */
export const lots = pgTable(
  'lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    /** Numéro du fabricant ; vide pour le stock sans suivi de lot. */
    numero: text('numero').notNull().default(''),
    datePeremption: date('date_peremption', { mode: 'string' }),
    quantite: integer('quantite').notNull().default(0),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lots_produit_numero_peremption_uq').on(t.produitId, t.numero, sql`coalesce(${t.datePeremption}, '9999-12-31')`),
    index('lots_peremption_idx').on(t.datePeremption),
    check('lots_quantite_positive', sql`${t.quantite} >= 0`),
  ],
);

export const typeMouvement = pgEnum('type_mouvement', [
  'achat',
  'vente',
  'retour_client',
  'retour_fournisseur',
  'ajustement',
  'casse',
  'peremption',
  'inventaire',
]);

/** Tout mouvement de stock, avec son document d'origine (§7, table centrale). */
export const mouvementsStock = pgTable(
  'mouvements_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: typeMouvement('type').notNull(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    lotId: uuid('lot_id').references(() => lots.id),
    /** Positive en entrée, négative en sortie, en pièces. */
    quantite: integer('quantite').notNull(),
    /** Coût d'une pièce au moment du mouvement (centimes de FCFA). */
    coutCentimes: bigint('cout_centimes', { mode: 'number' }).notNull(),
    documentType: text('document_type'),
    documentId: uuid('document_id'),
    motif: text('motif'),
    utilisateurId: uuid('utilisateur_id').references(() => utilisateurs.id),
    date: horodatage('date').notNull().defaultNow(),
  },
  (t) => [index('mouvements_produit_date_idx').on(t.produitId, t.date), index('mouvements_document_idx').on(t.documentType, t.documentId)],
);

export const statutAchat = pgEnum('statut_achat', ['brouillon', 'valide', 'annule']);

export const achats = pgTable(
  'achats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Attribué à la validation (règle R6) : ACH-2026-00001. */
    numero: text('numero'),
    fournisseurId: uuid('fournisseur_id')
      .notNull()
      .references(() => fournisseurs.id),
    date: date('date', { mode: 'string' }).notNull(),
    referenceFournisseur: text('reference_fournisseur'),
    statut: statutAchat('statut').notNull().default('brouillon'),
    totalMarchandises: montant('total_marchandises').notNull().default(0),
    totalFrais: montant('total_frais').notNull().default(0),
    total: montant('total').notNull().default(0),
    /** Payé au fournisseur à l'achat (les paiements détaillés arrivent avec la trésorerie, lot 4). */
    montantPaye: montant('montant_paye').notNull().default(0),
    notes: text('notes'),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    validePar: uuid('valide_par').references(() => utilisateurs.id),
    valideLe: horodatage('valide_le'),
  },
  (t) => [uniqueIndex('achats_numero_uq').on(t.numero), index('achats_date_idx').on(t.date)],
);

export const achatLignes = pgTable(
  'achat_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    achatId: uuid('achat_id')
      .notNull()
      .references(() => achats.id, { onDelete: 'cascade' }),
    ordre: integer('ordre').notNull(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    conditionnementId: uuid('conditionnement_id')
      .notNull()
      .references(() => conditionnements.id),
    quantite: integer('quantite').notNull(),
    /** Prix d'un conditionnement (FCFA). */
    prixUnitaire: montant('prix_unitaire').notNull(),
    numeroLot: text('numero_lot'),
    datePeremption: date('date_peremption', { mode: 'string' }),
    /** Calculés à la validation : pièces, montant, part des frais, coût d'une pièce. */
    quantitePieces: integer('quantite_pieces'),
    montant: montant('montant'),
    partFrais: montant('part_frais'),
    coutPieceCentimes: bigint('cout_piece_centimes', { mode: 'number' }),
    lotId: uuid('lot_id').references(() => lots.id),
  },
  (t) => [index('achat_lignes_achat_idx').on(t.achatId), check('achat_lignes_quantite', sql`${t.quantite} > 0`)],
);

export const achatFrais = pgTable('achat_frais', {
  id: uuid('id').primaryKey().defaultRandom(),
  achatId: uuid('achat_id')
    .notNull()
    .references(() => achats.id, { onDelete: 'cascade' }),
  libelle: text('libelle').notNull(),
  montant: montant('montant').notNull(),
});

export const statutInventaire = pgEnum('statut_inventaire', ['en_cours', 'valide', 'annule']);

export const inventaires = pgTable('inventaires', {
  id: uuid('id').primaryKey().defaultRandom(),
  libelle: text('libelle').notNull(),
  statut: statutInventaire('statut').notNull().default('en_cours'),
  creePar: uuid('cree_par').references(() => utilisateurs.id),
  creeLe: horodatage('cree_le').notNull().defaultNow(),
  validePar: uuid('valide_par').references(() => utilisateurs.id),
  valideLe: horodatage('valide_le'),
});

/** Une ligne par lot à compter ; la quantité théorique est figée à l'ouverture de l'inventaire. */
export const inventaireLignes = pgTable(
  'inventaire_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventaireId: uuid('inventaire_id')
      .notNull()
      .references(() => inventaires.id, { onDelete: 'cascade' }),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    quantiteTheorique: integer('quantite_theorique').notNull(),
    quantiteComptee: integer('quantite_comptee'),
  },
  (t) => [uniqueIndex('inventaire_lignes_lot_uq').on(t.inventaireId, t.lotId)],
);
