/**
 * Constantes du protocole de sécurité partagées entre le serveur et les appareils
 * (cahier des charges §10). Aucune dépendance à node:crypto ici : chaque côté calcule
 * les HMAC avec sa propre bibliothèque.
 */

/** Alphabet du code d'activation, sans caractères ambigus (0/O, 1/I/L). */
export const ALPHABET_CODE_ACTIVATION = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const DUREE_CODE_ACTIVATION_MIN = 15;
export const TENTATIVES_MAX_CODE_ACTIVATION = 5;
export const DUREE_CERTIFICAT_APPAREIL_JOURS = 365;
/** Un certificat est renouvelable quand il expire dans moins de ce délai. */
export const DELAI_RENOUVELLEMENT_CERTIFICAT_JOURS = 30;

export const INACTIVITE_VERROUILLAGE_MIN = 15;
export const DUREE_MAX_SESSION_HEURES = 12;
export const ECHECS_CONNEXION_MAX = 5;
export const DUREE_BLOCAGE_COMPTE_MIN = 15;

/** Préfixes des messages signés par HMAC lors de l'enregistrement. */
export const PREFIXE_PREUVE_APPAREIL = 'somidac-enrolement-appareil-v1\n';
export const PREFIXE_PREUVE_SERVEUR = 'somidac-enrolement-serveur-v1\n';

/** Nom commun du certificat du serveur ; les appareils refusent tout autre certificat serveur. */
export const CN_CERTIFICAT_SERVEUR = 'SOMIDAC Serveur';
export const PREFIXE_CN_APPAREIL = 'appareil:';

/** Découpe « ABCD-EFGH-JKLM » en identifiant public et secret. */
export function decouperCodeActivation(code: string): { idCode: string; secret: string } | null {
  const propre = code.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z0-9]{4})-?([A-Z0-9]{4})-?([A-Z0-9]{4})$/.exec(propre);
  if (!m) return null;
  return { idCode: m[1], secret: m[2] + m[3] };
}

/** Découverte du poste principal sur le réseau local (UDP). */
export const PORT_SERVEUR = 7443;
export const PORT_DECOUVERTE = 7444;
export const MESSAGE_DECOUVERTE = 'SOMIDAC-DECOUVERTE-1';

/** Réponse d'un poste principal à une recherche sur le réseau (aucune donnée secrète). */
export interface ReponseDecouverte {
  application: 'somidac';
  version: string;
  port: number;
  entreprise: string;
  initialise: boolean;
  nomMachine: string;
}

/** Codes d'erreur stables renvoyés par le serveur. */
export const CODES_ERREUR = {
  APPAREIL_NON_RECONNU: 'APPAREIL_NON_RECONNU',
  APPAREIL_REVOQUE: 'APPAREIL_REVOQUE',
  NON_CONNECTE: 'NON_CONNECTE',
  SESSION_VERROUILLEE: 'SESSION_VERROUILLEE',
  SESSION_EXPIREE: 'SESSION_EXPIREE',
  CHANGEMENT_MOT_DE_PASSE_REQUIS: 'CHANGEMENT_MOT_DE_PASSE_REQUIS',
  IDENTIFIANTS_INCORRECTS: 'IDENTIFIANTS_INCORRECTS',
  COMPTE_BLOQUE: 'COMPTE_BLOQUE',
  PERMISSION_REFUSEE: 'PERMISSION_REFUSEE',
  MODULE_DESACTIVE: 'MODULE_DESACTIVE',
  CODE_ACTIVATION_INVALIDE: 'CODE_ACTIVATION_INVALIDE',
  LIMITE_APPAREILS: 'LIMITE_APPAREILS',
  DEJA_INITIALISE: 'DEJA_INITIALISE',
  ACCES_LOCAL_REQUIS: 'ACCES_LOCAL_REQUIS',
} as const;
