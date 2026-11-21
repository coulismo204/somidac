import { z } from 'zod';
import { TOUTES_PERMISSIONS } from './permissions';

export const motDePasseSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128);

export const connexionSchema = z.object({
  identifiant: z.string().trim().min(1, 'Identifiant requis').max(64),
  motDePasse: z.string().min(1, 'Mot de passe requis').max(128),
});
export type ConnexionDto = z.infer<typeof connexionSchema>;

export const changementMotDePasseSchema = z.object({
  ancienMotDePasse: z.string().min(1),
  nouveauMotDePasse: motDePasseSchema,
});
export type ChangementMotDePasseDto = z.infer<typeof changementMotDePasseSchema>;

export const creationUtilisateurSchema = z.object({
  identifiant: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, 'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -)'),
  nomComplet: z.string().trim().min(2).max(120),
  motDePasseInitial: motDePasseSchema,
  roles: z.array(z.string()).min(1, 'Au moins un rôle'),
  plafondRemisePct: z.number().int().min(0).max(100).default(0),
});
export type CreationUtilisateurDto = z.infer<typeof creationUtilisateurSchema>;

export const modificationUtilisateurSchema = z.object({
  nomComplet: z.string().trim().min(2).max(120).optional(),
  roles: z.array(z.string()).min(1).optional(),
  plafondRemisePct: z.number().int().min(0).max(100).optional(),
  actif: z.boolean().optional(),
});
export type ModificationUtilisateurDto = z.infer<typeof modificationUtilisateurSchema>;

export const modificationRoleSchema = z.object({
  permissions: z.array(z.enum(TOUTES_PERMISSIONS as [string, ...string[]])),
});
export type ModificationRoleDto = z.infer<typeof modificationRoleSchema>;

/** Création d'un appareil par le gérant → code d'activation (§10.1 étape 1). */
export const creationAppareilSchema = z.object({
  nom: z.string().trim().min(2).max(60),
});
export type CreationAppareilDto = z.infer<typeof creationAppareilSchema>;

/**
 * Enregistrement d'un appareil (§10.1 étapes 2-4).
 * Le code d'activation XXXX-XXXX-XXXX = identifiant public (4) + secret (8).
 * Le secret ne circule jamais : l'appareil envoie seulement une preuve HMAC calculée avec lui.
 */
export const enrolementSchema = z.object({
  idCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, "Code d'activation invalide"),
  /** Demande de certificat (CSR PKCS#10, PEM) contenant la clé publique de l'appareil. */
  csrPem: z.string().min(100).max(10_000),
  /** HMAC-SHA256(secret, PREFIXE_PREUVE_APPAREIL + csrPem), en hexadécimal. */
  preuve: z.string().regex(/^[0-9a-f]{64}$/),
  infosSysteme: z
    .object({
      nomMachine: z.string().max(120).optional(),
      systeme: z.string().max(120).optional(),
      versionApp: z.string().max(40).optional(),
    })
    .default({}),
});
export type EnrolementDto = z.infer<typeof enrolementSchema>;

export const renouvellementCertificatSchema = z.object({
  csrPem: z.string().min(100).max(10_000),
});
export type RenouvellementCertificatDto = z.infer<typeof renouvellementCertificatSchema>;

/** Première mise en route du poste principal (uniquement depuis le PC lui-même). */
export const initialisationSchema = z.object({
  raisonSociale: z.string().trim().min(2).max(120).optional(),
  gerant: z.object({
    identifiant: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,32}$/, 'Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -)'),
    nomComplet: z.string().trim().min(2).max(120),
    motDePasse: motDePasseSchema,
  }),
  appareil: z.object({
    nom: z.string().trim().min(2).max(60),
    csrPem: z.string().min(100).max(10_000),
    infosSysteme: z
      .object({
        nomMachine: z.string().max(120).optional(),
        systeme: z.string().max(120).optional(),
        versionApp: z.string().max(40).optional(),
      })
      .default({}),
  }),
});
export type InitialisationDto = z.infer<typeof initialisationSchema>;

/** Réenregistrement du poste principal (clé perdue, Windows réinstallé) : local uniquement, avec le gérant. */
export const reenregistrementPostePrincipalSchema = z.object({
  identifiant: z.string().trim().min(1).max(64),
  motDePasse: z.string().min(1).max(128),
  appareil: z.object({
    nom: z.string().trim().min(2).max(60),
    csrPem: z.string().min(100).max(10_000),
    infosSysteme: z
      .object({
        nomMachine: z.string().max(120).optional(),
        systeme: z.string().max(120).optional(),
        versionApp: z.string().max(40).optional(),
      })
      .default({}),
  }),
});
export type ReenregistrementPostePrincipalDto = z.infer<typeof reenregistrementPostePrincipalSchema>;

export const deverrouillageSchema = z.object({
  motDePasse: z.string().min(1).max(128),
});
export type DeverrouillageDto = z.infer<typeof deverrouillageSchema>;

export const reinitialisationMotDePasseSchema = z.object({
  motDePasseInitial: motDePasseSchema,
});
export type ReinitialisationMotDePasseDto = z.infer<typeof reinitialisationMotDePasseSchema>;

export const parametresEntrepriseSchema = z.object({
  raisonSociale: z.string().trim().min(2).max(120),
  slogan: z.string().trim().max(160).optional().nullable(),
  adresse: z.string().trim().max(240).optional().nullable(),
  telephone: z.string().trim().max(60).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal('')),
  nif: z.string().trim().max(60).optional().nullable(),
  rccm: z.string().trim().max(60).optional().nullable(),
  coordonneesBancaires: z.string().trim().max(240).optional().nullable(),
  devise: z.string().trim().min(1).max(10),
  tvaActive: z.boolean(),
  tauxTvaPct: z.number().min(0).max(100),
  delaiAlertePeremptionJours: z.number().int().min(1).max(730),
  nbMaxAppareils: z.number().int().min(1).max(100),
  modulesActifs: z.array(z.string()),
});
export type ParametresEntrepriseDto = z.infer<typeof parametresEntrepriseSchema>;
