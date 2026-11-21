import * as crypto from 'node:crypto';

/**
 * Format des sauvegardes SOMIDAC (§9, §10.4).
 *
 * - Le gérant choisit un mot de passe de restauration. Il protège une clé privée X25519 (scrypt + AES-256-GCM) ;
 *   le serveur ne garde que la clé publique et cette clé privée chiffrée.
 * - Chaque sauvegarde est chiffrée avec une clé éphémère (X25519 + HKDF + AES-256-GCM) : le serveur peut donc
 *   sauvegarder seul chaque jour, mais seul le mot de passe de restauration permet de relire une sauvegarde.
 *
 * Fichier : "SOMIDAC1" | longueur de l'en-tête (uint32) | en-tête JSON (authentifié) | contenu chiffré.
 * Contenu : "SOMIDACP" | longueur du manifeste (uint32) | manifeste JSON | fichiers bout à bout.
 */

const MAGIE_FICHIER = Buffer.from('SOMIDAC1');
const MAGIE_CONTENU = Buffer.from('SOMIDACP');
const INFO_HKDF = 'somidac-sauvegarde-v1';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

export class ErreurSauvegarde extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ClePriveeChiffree {
  version: 1;
  sel: string;
  nonce: string;
  tag: string;
  donnees: string;
}

function deriverCleMotDePasse(motDePasse: string, sel: Buffer): Buffer {
  return crypto.scryptSync(motDePasse.normalize('NFC'), sel, 32, SCRYPT);
}

function chiffrerClePrivee(cle: crypto.KeyObject, motDePasse: string): string {
  const sel = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriverCleMotDePasse(motDePasse, sel), nonce);
  const donnees = Buffer.concat([c.update(cle.export({ type: 'pkcs8', format: 'der' })), c.final()]);
  const resultat: ClePriveeChiffree = {
    version: 1,
    sel: sel.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    donnees: donnees.toString('base64'),
  };
  return JSON.stringify(resultat);
}

/** Déchiffre la clé privée ; un mauvais mot de passe est détecté (authentification GCM). */
export function dechiffrerClePrivee(json: string, motDePasse: string): crypto.KeyObject {
  const c = JSON.parse(json) as ClePriveeChiffree;
  try {
    const d = crypto.createDecipheriv(
      'aes-256-gcm',
      deriverCleMotDePasse(motDePasse, Buffer.from(c.sel, 'base64')),
      Buffer.from(c.nonce, 'base64'),
    );
    d.setAuthTag(Buffer.from(c.tag, 'base64'));
    const der = Buffer.concat([d.update(Buffer.from(c.donnees, 'base64')), d.final()]);
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    throw new ErreurSauvegarde('MOT_DE_PASSE_RESTAURATION_INCORRECT', 'Mot de passe de restauration incorrect');
  }
}

/** Première configuration : nouvelle paire de clés protégée par le mot de passe de restauration. */
export function creerClesSauvegarde(motDePasse: string): { clePublique: string; clePriveeChiffree: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    clePublique: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    clePriveeChiffree: chiffrerClePrivee(privateKey, motDePasse),
  };
}

/** Changement de mot de passe : même paire de clés, donc les anciennes sauvegardes restent lisibles. */
export function changerMotDePasseRestauration(json: string, ancien: string, nouveau: string): string {
  return chiffrerClePrivee(dechiffrerClePrivee(json, ancien), nouveau);
}

export interface EnteteSauvegarde {
  version: 1;
  creeLe: string;
  entreprise: string;
  versionApplication: string;
  /** Clé publique éphémère (DER SPKI, base64). */
  ephemere: string;
  sel: string;
  nonce: string;
  tag: string;
}

function cleSymetrique(partage: Buffer, sel: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', partage, sel, INFO_HKDF, 32));
}

export function chiffrerSauvegarde(
  contenu: Buffer,
  clePubliqueB64: string,
  infos: { entreprise: string; versionApplication: string; creeLe?: Date },
): Buffer {
  const destinataire = crypto.createPublicKey({ key: Buffer.from(clePubliqueB64, 'base64'), format: 'der', type: 'spki' });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const sel = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const cle = cleSymetrique(crypto.diffieHellman({ privateKey, publicKey: destinataire }), sel);

  const entete: Omit<EnteteSauvegarde, 'tag'> = {
    version: 1,
    creeLe: (infos.creeLe ?? new Date()).toISOString(),
    entreprise: infos.entreprise,
    versionApplication: infos.versionApplication,
    ephemere: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    sel: sel.toString('base64'),
    nonce: nonce.toString('base64'),
  };
  // L'en-tête sans le tag est authentifié (AAD) : il ne peut pas être modifié sans être détecté.
  const aad = Buffer.from(JSON.stringify(entete));
  const c = crypto.createCipheriv('aes-256-gcm', cle, nonce);
  c.setAAD(aad);
  const chiffre = Buffer.concat([c.update(contenu), c.final()]);
  const enteteComplet = Buffer.from(JSON.stringify({ ...entete, tag: c.getAuthTag().toString('base64') }));
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(enteteComplet.length);
  return Buffer.concat([MAGIE_FICHIER, longueur, enteteComplet, chiffre]);
}

export function lireEntete(fichier: Buffer): { entete: EnteteSauvegarde; debutContenu: number } {
  if (fichier.length < 12 || !fichier.subarray(0, 8).equals(MAGIE_FICHIER)) {
    throw new ErreurSauvegarde('FICHIER_INVALIDE', "Ce fichier n'est pas une sauvegarde SOMIDAC");
  }
  const longueur = fichier.readUInt32BE(8);
  if (longueur > 64 * 1024 || 12 + longueur > fichier.length) {
    throw new ErreurSauvegarde('FICHIER_INVALIDE', 'Sauvegarde endommagée (en-tête)');
  }
  const entete = JSON.parse(fichier.subarray(12, 12 + longueur).toString('utf8')) as EnteteSauvegarde;
  if (entete.version !== 1) throw new ErreurSauvegarde('VERSION_INCONNUE', 'Version de sauvegarde non prise en charge');
  return { entete, debutContenu: 12 + longueur };
}

export function dechiffrerSauvegarde(fichier: Buffer, clePrivee: crypto.KeyObject): { entete: EnteteSauvegarde; contenu: Buffer } {
  const { entete, debutContenu } = lireEntete(fichier);
  const { tag, ...sansTag } = entete;
  try {
    const ephemere = crypto.createPublicKey({ key: Buffer.from(entete.ephemere, 'base64'), format: 'der', type: 'spki' });
    const cle = cleSymetrique(crypto.diffieHellman({ privateKey: clePrivee, publicKey: ephemere }), Buffer.from(entete.sel, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', cle, Buffer.from(entete.nonce, 'base64'));
    d.setAAD(Buffer.from(JSON.stringify(sansTag)));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return { entete, contenu: Buffer.concat([d.update(fichier.subarray(debutContenu)), d.final()]) };
  } catch {
    throw new ErreurSauvegarde(
      'SAUVEGARDE_ALTEREE',
      'Sauvegarde illisible : fichier modifié ou endommagé, ou clé de restauration différente',
    );
  }
}

export interface FichierSauvegarde {
  nom: string;
  donnees: Buffer;
}

export interface Manifeste {
  version: 1;
  derniereMigration: string | null;
  fichiers: { nom: string; taille: number; sha256: string }[];
}

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

export function empaqueter(fichiers: FichierSauvegarde[], derniereMigration: string | null): Buffer {
  const manifeste: Manifeste = {
    version: 1,
    derniereMigration,
    fichiers: fichiers.map((f) => ({ nom: f.nom, taille: f.donnees.length, sha256: sha256(f.donnees) })),
  };
  const m = Buffer.from(JSON.stringify(manifeste));
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(m.length);
  return Buffer.concat([MAGIE_CONTENU, longueur, m, ...fichiers.map((f) => f.donnees)]);
}

/** Relit le contenu et vérifie l'empreinte de chaque fichier. */
export function deballer(contenu: Buffer): { manifeste: Manifeste; fichiers: Map<string, Buffer> } {
  if (!contenu.subarray(0, 8).equals(MAGIE_CONTENU)) throw new ErreurSauvegarde('FICHIER_INVALIDE', 'Contenu de sauvegarde invalide');
  const longueur = contenu.readUInt32BE(8);
  const manifeste = JSON.parse(contenu.subarray(12, 12 + longueur).toString('utf8')) as Manifeste;
  const fichiers = new Map<string, Buffer>();
  let position = 12 + longueur;
  for (const f of manifeste.fichiers) {
    const donnees = contenu.subarray(position, position + f.taille);
    if (donnees.length !== f.taille || sha256(donnees) !== f.sha256) {
      throw new ErreurSauvegarde('SAUVEGARDE_ALTEREE', `Sauvegarde endommagée : ${f.nom}`);
    }
    fichiers.set(f.nom, donnees);
    position += f.taille;
  }
  return { manifeste, fichiers };
}

/**
 * Conservation (§9) : les 30 dernières sauvegardes quotidiennes et la dernière de chacun des 12 derniers mois.
 * Reçoit des dates de sauvegarde, renvoie celles à supprimer.
 */
export function aSupprimer(dates: Date[], maintenant = new Date(), quotidiennes = 30, mensuelles = 12): Date[] {
  const triees = [...dates].sort((a, b) => b.getTime() - a.getTime());
  const garder = new Set<number>();
  // Une par jour (la plus récente du jour), pour les 30 derniers jours ayant une sauvegarde.
  const jours = new Map<string, Date>();
  for (const d of triees) {
    const j = d.toISOString().slice(0, 10);
    if (!jours.has(j)) jours.set(j, d);
  }
  [...jours.values()].slice(0, quotidiennes).forEach((d) => garder.add(d.getTime()));
  // Une par mois (la plus récente du mois), pour les 12 derniers mois.
  const limite = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - (mensuelles - 1), 1));
  const mois = new Map<string, Date>();
  for (const d of triees) {
    if (d < limite) continue;
    const m = d.toISOString().slice(0, 7);
    if (!mois.has(m)) mois.set(m, d);
  }
  mois.forEach((d) => garder.add(d.getTime()));
  return triees.filter((d) => !garder.has(d.getTime()));
}
