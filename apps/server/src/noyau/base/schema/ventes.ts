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
import { conditionnements, lots, produits } from './catalogue';
import { sites, utilisateurs } from './noyau';

/*
 * Lot 3 - Clients et ventes (cahier des charges §5.5, §7 domaine « Ventes »).
 * Montants : FCFA entiers, hors taxe (R9). Remises : points de base (500 = 5 %).
 * Coûts : centimes de FCFA, comme le coût moyen pondéré.
 */

const horodatage = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'date' });
const montant = (nom: string) => bigint(nom, { mode: 'number' });

export const typeClient = pgEnum('type_client', ['supermarche', 'boutique', 'revendeur', 'particulier']);
export const conditionPaiement = pgEnum('condition_paiement', ['comptant', 'credit']);

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    /** Code attribué automatiquement : C-0001… */
    code: text('code').notNull(),
    raisonSociale: text('raison_sociale').notNull(),
    type: typeClient('type').notNull(),
    contact: text('contact'),
    telephone: text('telephone'),
    email: text('email'),
    adresse: text('adresse'),
    nif: text('nif'),
    conditionPaiement: conditionPaiement('condition_paiement').notNull().default('comptant'),
    delaiPaiementJours: integer('delai_paiement_jours').notNull().default(0),
    /** Prévu pour le module « Crédit client » (désactivé en V1). */
    plafondCredit: montant('plafond_credit'),
    blSansPrix: boolean('bl_sans_prix').notNull().default(false),
    notes: text('notes'),
    actif: boolean('actif').notNull().default(true),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    modifieLe: horodatage('modifie_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('clients_code_uq').on(t.code), uniqueIndex('clients_raison_sociale_uq').on(sql`lower(${t.raisonSociale})`)],
);

/** Prix particulier d'un client pour un conditionnement (R3). */
export const prixClients = pgTable(
  'prix_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    conditionnementId: uuid('conditionnement_id')
      .notNull()
      .references(() => conditionnements.id),
    prix: montant('prix').notNull(),
    modifieLe: horodatage('modifie_le').notNull().defaultNow(),
    modifiePar: uuid('modifie_par').references(() => utilisateurs.id),
  },
  (t) => [uniqueIndex('prix_clients_uq').on(t.clientId, t.conditionnementId), check('prix_clients_positif', sql`${t.prix} >= 0`)],
);

/**
 * brouillon : préparé, le stock n'a pas bougé ; livre : validé, le stock est sorti ;
 * receptionne : quantités acceptées saisies ; facture : facture émise ; retourne : tout a été refusé.
 */
export const statutLivraison = pgEnum('statut_livraison', ['brouillon', 'livre', 'receptionne', 'facture', 'retourne']);

export const bonsLivraison = pgTable(
  'bons_livraison',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Attribué à la validation (R6) : BL-2026-00001. */
    numero: text('numero'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    date: date('date', { mode: 'string' }).notNull(),
    referenceClient: text('reference_client'),
    statut: statutLivraison('statut').notNull().default('brouillon'),
    remiseGlobaleBp: integer('remise_globale_bp').notNull().default(0),
    /** Totaux de la marchandise livrée (HT). */
    totalLignes: montant('total_lignes').notNull().default(0),
    totalHT: montant('total_ht').notNull().default(0),
    notes: text('notes'),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    validePar: uuid('valide_par').references(() => utilisateurs.id),
    valideLe: horodatage('valide_le'),
    receptionPar: uuid('reception_par').references(() => utilisateurs.id),
    receptionLe: horodatage('reception_le'),
  },
  (t) => [
    uniqueIndex('bons_livraison_numero_uq').on(t.numero),
    index('bons_livraison_date_idx').on(t.date),
    index('bons_livraison_client_idx').on(t.clientId),
    check('bons_livraison_remise', sql`${t.remiseGlobaleBp} BETWEEN 0 AND 10000`),
  ],
);

/** Une ligne de BL garde la quantité livrée et la quantité acceptée (§7). */
export const blLignes = pgTable(
  'bl_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blId: uuid('bl_id')
      .notNull()
      .references(() => bonsLivraison.id, { onDelete: 'cascade' }),
    ordre: integer('ordre').notNull(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    conditionnementId: uuid('conditionnement_id')
      .notNull()
      .references(() => conditionnements.id),
    quantite: integer('quantite').notNull(),
    /** Prix HT d'un conditionnement (R3), figé à la validation. */
    prixUnitaire: montant('prix_unitaire'),
    remiseBp: integer('remise_bp').notNull().default(0),
    montant: montant('montant'),
    quantitePieces: integer('quantite_pieces'),
    /** Coût moyen d'une pièce au moment de la sortie (R2). */
    coutPieceCentimes: bigint('cout_piece_centimes', { mode: 'number' }),
    quantiteAcceptee: integer('quantite_acceptee'),
    motifRefus: text('motif_refus'),
  },
  (t) => [
    index('bl_lignes_bl_idx').on(t.blId),
    check('bl_lignes_quantite', sql`${t.quantite} > 0`),
    check('bl_lignes_acceptee', sql`${t.quantiteAcceptee} IS NULL OR (${t.quantiteAcceptee} >= 0 AND ${t.quantiteAcceptee} <= ${t.quantite})`),
    check('bl_lignes_remise', sql`${t.remiseBp} BETWEEN 0 AND 10000`),
  ],
);

/** Détail par lot de ce qui est sorti pour une ligne de BL, et de ce qui y est revenu. */
export const blSorties = pgTable(
  'bl_sorties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blLigneId: uuid('bl_ligne_id')
      .notNull()
      .references(() => blLignes.id, { onDelete: 'cascade' }),
    ordre: integer('ordre').notNull(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    quantite: integer('quantite').notNull(),
    coutCentimes: bigint('cout_centimes', { mode: 'number' }).notNull(),
    quantiteRetournee: integer('quantite_retournee').notNull().default(0),
  },
  (t) => [
    index('bl_sorties_ligne_idx').on(t.blLigneId),
    check('bl_sorties_retour', sql`${t.quantiteRetournee} >= 0 AND ${t.quantiteRetournee} <= ${t.quantite}`),
  ],
);

export const factures = pgTable(
  'factures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FAC-2026-00001, attribué à l'émission (R6). */
    numero: text('numero').notNull(),
    blId: uuid('bl_id')
      .notNull()
      .references(() => bonsLivraison.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    date: date('date', { mode: 'string' }).notNull(),
    echeance: date('echeance', { mode: 'string' }).notNull(),
    referenceClient: text('reference_client'),
    remiseGlobaleBp: integer('remise_globale_bp').notNull().default(0),
    totalLignes: montant('total_lignes').notNull(),
    remiseGlobale: montant('remise_globale').notNull(),
    totalHT: montant('total_ht').notNull(),
    /** Taux appliqué à l'émission (0 si la TVA est désactivée). */
    tauxTvaBp: integer('taux_tva_bp').notNull().default(0),
    tva: montant('tva').notNull(),
    totalTTC: montant('total_ttc').notNull(),
    /** Somme des paiements reçus (module Trésorerie, lot 4). */
    montantPaye: montant('montant_paye').notNull().default(0),
    /** Somme des avoirs émis sur cette facture (TTC). */
    montantAvoirs: montant('montant_avoirs').notNull().default(0),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('factures_numero_uq').on(t.numero),
    uniqueIndex('factures_bl_uq').on(t.blId),
    index('factures_date_idx').on(t.date),
    index('factures_client_idx').on(t.clientId),
  ],
);

export const factureLignes = pgTable(
  'facture_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    factureId: uuid('facture_id')
      .notNull()
      .references(() => factures.id),
    blLigneId: uuid('bl_ligne_id')
      .notNull()
      .references(() => blLignes.id),
    ordre: integer('ordre').notNull(),
    produitId: uuid('produit_id')
      .notNull()
      .references(() => produits.id),
    conditionnementId: uuid('conditionnement_id')
      .notNull()
      .references(() => conditionnements.id),
    /** Désignation telle qu'imprimée (le produit peut être renommé plus tard). */
    designation: text('designation').notNull(),
    quantite: integer('quantite').notNull(),
    prixUnitaire: montant('prix_unitaire').notNull(),
    remiseBp: integer('remise_bp').notNull().default(0),
    montant: montant('montant').notNull(),
    quantitePieces: integer('quantite_pieces').notNull(),
    coutPieceCentimes: bigint('cout_piece_centimes', { mode: 'number' }).notNull(),
    quantiteRetournee: integer('quantite_retournee').notNull().default(0),
  },
  (t) => [
    index('facture_lignes_facture_idx').on(t.factureId),
    check('facture_lignes_quantite', sql`${t.quantite} > 0`),
    check('facture_lignes_retour', sql`${t.quantiteRetournee} >= 0 AND ${t.quantiteRetournee} <= ${t.quantite}`),
  ],
);

export const avoirs = pgTable(
  'avoirs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** AV-2026-00001 (R6). */
    numero: text('numero').notNull(),
    factureId: uuid('facture_id')
      .notNull()
      .references(() => factures.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    date: date('date', { mode: 'string' }).notNull(),
    motif: text('motif').notNull(),
    totalHT: montant('total_ht').notNull(),
    tva: montant('tva').notNull(),
    totalTTC: montant('total_ttc').notNull(),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('avoirs_numero_uq').on(t.numero), index('avoirs_facture_idx').on(t.factureId)],
);

export const destinationRetour = pgEnum('destination_retour', ['stock', 'casse']);

export const avoirLignes = pgTable(
  'avoir_lignes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    avoirId: uuid('avoir_id')
      .notNull()
      .references(() => avoirs.id),
    factureLigneId: uuid('facture_ligne_id')
      .notNull()
      .references(() => factureLignes.id),
    ordre: integer('ordre').notNull(),
    quantite: integer('quantite').notNull(),
    /** Part HT de la ligne retournée, avant remise sur le total. */
    montant: montant('montant').notNull(),
    destination: destinationRetour('destination').notNull(),
  },
  (t) => [index('avoir_lignes_avoir_idx').on(t.avoirId), check('avoir_lignes_quantite', sql`${t.quantite} > 0`)],
);
