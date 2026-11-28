import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { achats, fournisseurs } from './catalogue';
import { utilisateurs } from './noyau';
import { clients, factures } from './ventes';

/*
 * Lot 4 - Trésorerie (cahier des charges §5.6, §7 domaine « Trésorerie », §10.3).
 * Montants en FCFA entiers. Le solde d'un compte est la somme de ses opérations
 * (mouvements_tresorerie), tenue à jour dans la même transaction que l'opération.
 */

const horodatage = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'date' });
const montant = (nom: string) => bigint(nom, { mode: 'number' });

export const typeCompte = pgEnum('type_compte', ['caisse', 'mobile_money', 'banque']);

export const comptesTresorerie = pgTable(
  'comptes_tresorerie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    type: typeCompte('type').notNull(),
    reference: text('reference'),
    soldeInitial: montant('solde_initial').notNull().default(0),
    solde: montant('solde').notNull().default(0),
    actif: boolean('actif').notNull().default(true),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('comptes_tresorerie_nom_uq').on(sql`lower(${t.nom})`)],
);

export const typeOperationTresorerie = pgEnum('type_operation_tresorerie', [
  'ouverture',
  'encaissement',
  'paiement_fournisseur',
  'depense',
  'transfert',
  'ecart_cloture',
  'annulation',
]);

/** Journal de chaque compte : positif quand l'argent entre, négatif quand il sort. */
export const mouvementsTresorerie = pgTable(
  'mouvements_tresorerie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compteId: uuid('compte_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    date: horodatage('date').notNull().defaultNow(),
    montant: montant('montant').notNull(),
    /** Solde du compte après l'opération (journal de caisse). */
    soldeApres: montant('solde_apres').notNull(),
    type: typeOperationTresorerie('type').notNull(),
    documentType: text('document_type'),
    documentId: uuid('document_id'),
    libelle: text('libelle').notNull(),
    utilisateurId: uuid('utilisateur_id').references(() => utilisateurs.id),
  },
  (t) => [index('mouvements_tresorerie_compte_date_idx').on(t.compteId, t.date), index('mouvements_tresorerie_document_idx').on(t.documentType, t.documentId)],
);

export const sensPaiement = pgEnum('sens_paiement', ['client', 'fournisseur']);
export const statutOperation = pgEnum('statut_operation', ['valide', 'annule']);

/** Paiements reçus des clients et versés aux fournisseurs (PAI-2026-00001, R6). */
export const paiements = pgTable(
  'paiements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: text('numero').notNull(),
    sens: sensPaiement('sens').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    fournisseurId: uuid('fournisseur_id').references(() => fournisseurs.id),
    compteId: uuid('compte_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    date: date('date', { mode: 'string' }).notNull(),
    montant: montant('montant').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    statut: statutOperation('statut').notNull().default('valide'),
    motifAnnulation: text('motif_annulation'),
    annulePar: uuid('annule_par').references(() => utilisateurs.id),
    annuleLe: horodatage('annule_le'),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('paiements_numero_uq').on(t.numero),
    index('paiements_date_idx').on(t.date),
    check('paiements_montant', sql`${t.montant} > 0`),
    check('paiements_tiers', sql`(${t.sens} = 'client' AND ${t.clientId} IS NOT NULL) OR (${t.sens} = 'fournisseur' AND ${t.fournisseurId} IS NOT NULL)`),
  ],
);

/** Un paiement est affecté à une ou plusieurs factures, ou à un ou plusieurs achats (§7). */
export const paiementAffectations = pgTable(
  'paiement_affectations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paiementId: uuid('paiement_id')
      .notNull()
      .references(() => paiements.id),
    factureId: uuid('facture_id').references(() => factures.id),
    achatId: uuid('achat_id').references(() => achats.id),
    montant: montant('montant').notNull(),
  },
  (t) => [
    index('paiement_affectations_paiement_idx').on(t.paiementId),
    index('paiement_affectations_facture_idx').on(t.factureId),
    index('paiement_affectations_achat_idx').on(t.achatId),
    check('paiement_affectations_montant', sql`${t.montant} > 0`),
  ],
);

export const categoriesDepenses = pgTable(
  'categories_depenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nom: text('nom').notNull(),
    actif: boolean('actif').notNull().default(true),
  },
  (t) => [uniqueIndex('categories_depenses_nom_uq').on(sql`lower(${t.nom})`)],
);

/** Dépenses (DEP-2026-00001, R6). */
export const depenses = pgTable(
  'depenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: text('numero').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    categorieId: uuid('categorie_id')
      .notNull()
      .references(() => categoriesDepenses.id),
    compteId: uuid('compte_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    montant: montant('montant').notNull(),
    libelle: text('libelle').notNull(),
    beneficiaire: text('beneficiaire'),
    statut: statutOperation('statut').notNull().default('valide'),
    motifAnnulation: text('motif_annulation'),
    annulePar: uuid('annule_par').references(() => utilisateurs.id),
    annuleLe: horodatage('annule_le'),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('depenses_numero_uq').on(t.numero), index('depenses_date_idx').on(t.date), check('depenses_montant', sql`${t.montant} > 0`)],
);

export const transferts = pgTable(
  'transferts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date', { mode: 'string' }).notNull(),
    compteSourceId: uuid('compte_source_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    compteDestinationId: uuid('compte_destination_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    montant: montant('montant').notNull(),
    libelle: text('libelle'),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [check('transferts_montant', sql`${t.montant} > 0`), check('transferts_comptes', sql`${t.compteSourceId} <> ${t.compteDestinationId}`)],
);

export const statutCloture = pgEnum('statut_cloture', ['a_valider', 'validee', 'refusee']);

/** Clôture journalière d'une caisse (§5.6, §10.3) : solde calculé contre solde compté. */
export const cloturesCaisse = pgTable(
  'clotures_caisse',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compteId: uuid('compte_id')
      .notNull()
      .references(() => comptesTresorerie.id),
    jour: date('jour', { mode: 'string' }).notNull(),
    soldeCalcule: montant('solde_calcule').notNull(),
    montantCompte: montant('montant_compte').notNull(),
    ecart: montant('ecart').notNull(),
    justification: text('justification'),
    statut: statutCloture('statut').notNull().default('a_valider'),
    commentaire: text('commentaire'),
    saisiePar: uuid('saisie_par').references(() => utilisateurs.id),
    saisieLe: horodatage('saisie_le').notNull().defaultNow(),
    validePar: uuid('valide_par').references(() => utilisateurs.id),
    valideLe: horodatage('valide_le'),
  },
  (t) => [
    // Une seule clôture retenue par caisse et par jour (une clôture refusée peut être refaite).
    uniqueIndex('clotures_caisse_jour_uq').on(t.compteId, t.jour).where(sql`${t.statut} <> 'refusee'`),
    index('clotures_caisse_jour_idx').on(t.jour),
  ],
);

/** Photos des justificatifs (§7 « pieces_jointes ») : gardées dans la base, donc dans les sauvegardes. */
export const piecesJointes = pgTable(
  'pieces_jointes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentType: text('document_type').notNull(),
    documentId: uuid('document_id').notNull(),
    nom: text('nom').notNull(),
    typeMime: text('type_mime').notNull(),
    taille: integer('taille').notNull(),
    contenuBase64: text('contenu_base64').notNull(),
    creePar: uuid('cree_par').references(() => utilisateurs.id),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
  },
  (t) => [index('pieces_jointes_document_idx').on(t.documentType, t.documentId)],
);
