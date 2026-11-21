import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Horodatages communs (cahier des charges §7 : cree_le, cree_par, modifie_le). */
const horodatage = (nom: string) => timestamp(nom, { withTimezone: true, mode: 'date' });

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  nom: text('nom').notNull(),
  creeLe: horodatage('cree_le').notNull().defaultNow(),
});

/** Ligne unique (id = 1) : paramètres de l'entreprise. */
export const parametres = pgTable('parametres', {
  id: smallint('id').primaryKey().default(1),
  raisonSociale: text('raison_sociale').notNull().default('SOMIDAC SARL'),
  slogan: text('slogan'),
  adresse: text('adresse'),
  telephone: text('telephone'),
  email: text('email'),
  nif: text('nif'),
  rccm: text('rccm'),
  coordonneesBancaires: text('coordonnees_bancaires'),
  devise: text('devise').notNull().default('FCFA'),
  tvaActive: boolean('tva_active').notNull().default(false),
  /** Taux en points de base : 1800 = 18,00 %. */
  tauxTvaBp: integer('taux_tva_bp').notNull().default(0),
  delaiAlertePeremptionJours: integer('delai_alerte_peremption_jours').notNull().default(90),
  nbMaxAppareils: integer('nb_max_appareils').notNull().default(5),
  modulesActifs: text('modules_actifs').array().notNull(),
  /** Sauvegarde automatique quotidienne (§9) : heure « HH:MM » et dossiers de copie externes. */
  sauvegardeHeure: text('sauvegarde_heure').notNull().default('20:00'),
  sauvegardeDossiers: text('sauvegarde_dossiers').array().notNull().default([]),
  /** Clé publique X25519 qui chiffre les sauvegardes (DER SPKI, base64). */
  sauvegardeClePublique: text('sauvegarde_cle_publique'),
  /** Clé privée correspondante, chiffrée par le mot de passe de restauration du gérant (JSON). */
  sauvegardeClePriveeChiffree: text('sauvegarde_cle_privee_chiffree'),
  /** Vrai une fois le compte gérant et le poste principal créés. */
  initialise: boolean('initialise').notNull().default(false),
  modifieLe: horodatage('modifie_le').notNull().defaultNow(),
  modifiePar: uuid('modifie_par'),
});

export const utilisateurs = pgTable(
  'utilisateurs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    identifiant: text('identifiant').notNull(),
    nomComplet: text('nom_complet').notNull(),
    hashMotDePasse: text('hash_mot_de_passe').notNull(),
    doitChangerMotDePasse: boolean('doit_changer_mot_de_passe').notNull().default(true),
    actif: boolean('actif').notNull().default(true),
    plafondRemisePct: integer('plafond_remise_pct').notNull().default(0),
    echecsConnexion: integer('echecs_connexion').notNull().default(0),
    bloqueJusquA: horodatage('bloque_jusqu_a'),
    derniereConnexion: horodatage('derniere_connexion'),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    creePar: uuid('cree_par'),
    modifieLe: horodatage('modifie_le').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('utilisateurs_identifiant_uq').on(t.identifiant)],
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  libelle: text('libelle').notNull(),
  /** Rôle fourni à l'installation (non supprimable). */
  systeme: boolean('systeme').notNull().default(false),
  creeLe: horodatage('cree_le').notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const utilisateurRoles = pgTable(
  'utilisateur_roles',
  {
    utilisateurId: uuid('utilisateur_id')
      .notNull()
      .references(() => utilisateurs.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.utilisateurId, t.roleId] })],
);

export const statutAppareil = pgEnum('statut_appareil', ['en_attente', 'actif', 'revoque']);

/** Appareils enregistrés avec leur clé chiffrée (cahier des charges §10.1). */
export const appareils = pgTable(
  'appareils',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    nom: text('nom').notNull(),
    statut: statutAppareil('statut').notNull().default('en_attente'),
    /** Partie publique du code d'activation (4 caractères), sert d'identifiant. */
    idCode: text('id_code'),
    /** Partie secrète du code d'activation ; effacée dès l'enregistrement ou l'expiration. */
    secretCode: text('secret_code'),
    codeExpireLe: horodatage('code_expire_le'),
    tentativesCode: integer('tentatives_code').notNull().default(0),
    empreinteClePublique: text('empreinte_cle_publique'),
    numeroSerieCertificat: text('numero_serie_certificat'),
    certificatPem: text('certificat_pem'),
    certificatExpireLe: horodatage('certificat_expire_le'),
    infosSysteme: jsonb('infos_systeme').$type<Record<string, string>>(),
    enregistreLe: horodatage('enregistre_le'),
    derniereConnexion: horodatage('derniere_connexion'),
    dernierUtilisateurId: uuid('dernier_utilisateur_id'),
    revoqueLe: horodatage('revoque_le'),
    revoquePar: uuid('revoque_par'),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    creePar: uuid('cree_par'),
  },
  (t) => [
    uniqueIndex('appareils_id_code_uq').on(t.idCode),
    uniqueIndex('appareils_serie_uq').on(t.numeroSerieCertificat),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    utilisateurId: uuid('utilisateur_id')
      .notNull()
      .references(() => utilisateurs.id),
    appareilId: uuid('appareil_id')
      .notNull()
      .references(() => appareils.id),
    hashJeton: text('hash_jeton').notNull(),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    derniereActivite: horodatage('derniere_activite').notNull().defaultNow(),
    expireLe: horodatage('expire_le').notNull(),
    verrouillee: boolean('verrouillee').notNull().default(false),
    fermeeLe: horodatage('fermee_le'),
  },
  (t) => [uniqueIndex('sessions_hash_uq').on(t.hashJeton), index('sessions_utilisateur_idx').on(t.utilisateurId)],
);

/** Séries de numérotation annuelles, continues et sans trou (règle R6). */
export const sequencesDocuments = pgTable(
  'sequences_documents',
  {
    type: text('type').notNull(),
    annee: integer('annee').notNull(),
    derniereValeur: integer('derniere_valeur').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.type, t.annee] })],
);

/** Journal d'audit chaîné (cahier des charges §10.5) : chaque entrée référence l'empreinte de la précédente. */
export const journalAudit = pgTable(
  'journal_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    horodatage: horodatage('horodatage').notNull(),
    utilisateurId: uuid('utilisateur_id'),
    appareilId: uuid('appareil_id'),
    action: text('action').notNull(),
    entite: text('entite'),
    entiteId: text('entite_id'),
    avant: jsonb('avant'),
    apres: jsonb('apres'),
    details: jsonb('details'),
    hashPrecedent: text('hash_precedent').notNull(),
    hash: text('hash').notNull(),
  },
  (t) => [index('journal_audit_entite_idx').on(t.entite, t.entiteId), index('journal_audit_horodatage_idx').on(t.horodatage)],
);

export const statutSauvegarde = pgEnum('statut_sauvegarde', ['reussie', 'echouee']);

/** Historique des sauvegardes et de leurs copies externes (§9). */
export const sauvegardes = pgTable(
  'sauvegardes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creeLe: horodatage('cree_le').notNull().defaultNow(),
    declenchement: text('declenchement').notNull(),
    utilisateurId: uuid('utilisateur_id'),
    statut: statutSauvegarde('statut').notNull(),
    fichier: text('fichier'),
    taille: integer('taille'),
    empreinte: text('empreinte'),
    /** Résultat de chaque copie externe : [{ dossier, ok, erreur? }]. */
    copies: jsonb('copies').$type<{ dossier: string; ok: boolean; erreur?: string }[]>().notNull().default([]),
    erreur: text('erreur'),
    dureeMs: integer('duree_ms'),
  },
  (t) => [index('sauvegardes_cree_le_idx').on(t.creeLe)],
);
