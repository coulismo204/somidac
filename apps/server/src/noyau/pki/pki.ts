import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { CN_CERTIFICAT_SERVEUR, DUREE_CERTIFICAT_APPAREIL_JOURS, PREFIXE_CN_APPAREIL } from '@somidac/shared';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const webcrypto = crypto.webcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

const ALGO_CLE = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ALGO_SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const;
const JOUR_MS = 24 * 3600 * 1000;

export const PKI = Symbol('PKI');

/**
 * Autorité de certification interne de SOMIDAC (cahier des charges §10.1).
 * - La clé de l'autorité est créée à l'installation et stockée chiffrée (AES-256).
 * - Le serveur présente un certificat signé par cette autorité (usage serverAuth).
 * - Chaque appareil reçoit un certificat (usage clientAuth) pour sa propre clé publique.
 */
export class Pki {
  private constructor(
    private readonly caCle: CryptoKey,
    readonly caCertificat: x509.X509Certificate,
    readonly serveurClePem: string,
    readonly serveurCertificatPem: string,
  ) {}

  get caPem(): string {
    return this.caCertificat.toString('pem');
  }

  /** Charge l'autorité depuis le dossier de données, ou la crée au premier démarrage. */
  static async charger(dataDir: string, nomsServeur: NomsServeur = nomsServeurParDefaut()): Promise<Pki> {
    const dossier = path.join(dataDir, 'pki');
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const secret = lireOuCreerSecret(dataDir);

    const fichierCaCle = path.join(dossier, 'autorite.key.pem');
    const fichierCaCert = path.join(dossier, 'autorite.cert.pem');
    let caCle: CryptoKey;
    let caCert: x509.X509Certificate;

    if (fs.existsSync(fichierCaCle) && fs.existsSync(fichierCaCert)) {
      caCle = await importerCleChiffree(fs.readFileSync(fichierCaCle, 'utf8'), secret.motDePasseCleAutorite);
      caCert = new x509.X509Certificate(fs.readFileSync(fichierCaCert, 'utf8'));
    } else {
      const paire = (await webcrypto.subtle.generateKey(ALGO_CLE, true, ['sign', 'verify'])) as CryptoKeyPair;
      caCert = await x509.X509CertificateGenerator.createSelfSigned({
        serialNumber: numeroSerie(),
        name: 'CN=SOMIDAC Autorite interne, O=SOMIDAC SARL',
        notBefore: new Date(Date.now() - JOUR_MS),
        notAfter: new Date(Date.now() + 20 * 365 * JOUR_MS),
        keys: paire,
        signingAlgorithm: ALGO_SIGNATURE,
        extensions: [
          new x509.BasicConstraintsExtension(true, 0, true),
          new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
          await x509.SubjectKeyIdentifierExtension.create(paire.publicKey),
        ],
      });
      ecrireFichierPrive(fichierCaCle, await exporterCleChiffree(paire.privateKey, secret.motDePasseCleAutorite));
      ecrireFichierPrive(fichierCaCert, caCert.toString('pem'));
      caCle = paire.privateKey;
    }

    const serveur = await chargerOuCreerCertificatServeur(dossier, caCle, caCert, nomsServeur);
    return new Pki(caCle, caCert, serveur.clePem, serveur.certPem);
  }

  /**
   * Émet le certificat d'un appareil à partir de sa demande (CSR).
   * La CSR prouve que l'appareil possède la clé privée correspondante.
   */
  async emettreCertificatAppareil(appareilId: string, csrPem: string): Promise<CertificatEmis> {
    let csr: x509.Pkcs10CertificateRequest;
    try {
      csr = new x509.Pkcs10CertificateRequest(csrPem);
    } catch {
      throw new ErreurPki('Demande de certificat illisible');
    }
    if (!(await csr.verify())) throw new ErreurPki('Signature de la demande de certificat invalide');
    const algo = csr.publicKey.algorithm as EcKeyAlgorithm;
    if (algo.name !== 'ECDSA' || algo.namedCurve !== 'P-256') {
      throw new ErreurPki('Type de clé non accepté (ECDSA P-256 attendu)');
    }

    const maintenant = Date.now();
    const notAfter = new Date(maintenant + DUREE_CERTIFICAT_APPAREIL_JOURS * JOUR_MS);
    const serie = numeroSerie();
    const cert = await x509.X509CertificateGenerator.create({
      serialNumber: serie,
      subject: `CN=${PREFIXE_CN_APPAREIL}${appareilId}, O=SOMIDAC SARL`,
      issuer: this.caCertificat.subject,
      notBefore: new Date(maintenant - 5 * 60 * 1000),
      notAfter,
      publicKey: csr.publicKey,
      signingKey: this.caCle,
      signingAlgorithm: ALGO_SIGNATURE,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], true),
        await x509.AuthorityKeyIdentifierExtension.create(this.caCertificat.publicKey),
      ],
    });
    return {
      certificatPem: cert.toString('pem'),
      numeroSerie: normaliserSerie(serie),
      expireLe: notAfter,
      empreinteClePublique: Buffer.from(await csr.publicKey.getThumbprint('SHA-256')).toString('hex'),
    };
  }
}

export interface CertificatEmis {
  certificatPem: string;
  numeroSerie: string;
  expireLe: Date;
  empreinteClePublique: string;
}

export class ErreurPki extends Error {}

export interface NomsServeur {
  dns: string[];
  ip: string[];
}

/** Noms sous lesquels le serveur peut être joint sur le réseau local. */
export function nomsServeurParDefaut(): NomsServeur {
  const ip = new Set(['127.0.0.1']);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) ip.add(i.address);
    }
  }
  const nom = os.hostname().toLowerCase();
  return { dns: [...new Set(['localhost', nom, `${nom}.local`])], ip: [...ip] };
}

/** Numéro de série tel que Node le présente pour un certificat pair : hexadécimal majuscule sans zéros de tête. */
export function normaliserSerie(serie: string): string {
  return serie.toUpperCase().replace(/^0+/, '');
}

function numeroSerie(): string {
  const octets = crypto.randomBytes(16);
  octets[0] = (octets[0] & 0x7f) | 0x10; // positif et sans zéro de tête
  return octets.toString('hex');
}

interface SecretServeur {
  motDePasseCleAutorite: string;
}

function lireOuCreerSecret(dataDir: string): SecretServeur {
  const fichier = path.join(dataDir, 'secrets.json');
  if (fs.existsSync(fichier)) return JSON.parse(fs.readFileSync(fichier, 'utf8')) as SecretServeur;
  const secret: SecretServeur = { motDePasseCleAutorite: crypto.randomBytes(32).toString('base64url') };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  ecrireFichierPrive(fichier, JSON.stringify(secret, null, 2));
  return secret;
}

function ecrireFichierPrive(fichier: string, contenu: string) {
  fs.writeFileSync(fichier, contenu, { mode: 0o600 });
}

async function exporterCleChiffree(cle: CryptoKey, motDePasse: string): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', cle));
  return crypto
    .createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: motDePasse })
    .toString();
}

async function importerCleChiffree(pem: string, motDePasse: string): Promise<CryptoKey> {
  const der = crypto
    .createPrivateKey({ key: pem, format: 'pem', passphrase: motDePasse })
    .export({ type: 'pkcs8', format: 'der' });
  return webcrypto.subtle.importKey('pkcs8', der, ALGO_CLE, false, ['sign']);
}

async function chargerOuCreerCertificatServeur(
  dossier: string,
  caCle: CryptoKey,
  caCert: x509.X509Certificate,
  noms: NomsServeur,
): Promise<{ clePem: string; certPem: string }> {
  const fichierCle = path.join(dossier, 'serveur.key.pem');
  const fichierCert = path.join(dossier, 'serveur.cert.pem');
  if (fs.existsSync(fichierCle) && fs.existsSync(fichierCert)) {
    const certPem = fs.readFileSync(fichierCert, 'utf8');
    const cert = new x509.X509Certificate(certPem);
    const san = cert.getExtension(x509.SubjectAlternativeNameExtension);
    const existants = new Set((san?.names.toJSON() ?? []).map((n) => `${n.type}:${n.value}`));
    const tousPresents = [...noms.dns.map((d) => `dns:${d}`), ...noms.ip.map((i) => `ip:${i}`)].every((n) =>
      existants.has(n),
    );
    const valideEncore = cert.notAfter.getTime() - Date.now() > 30 * JOUR_MS;
    if (tousPresents && valideEncore) return { clePem: fs.readFileSync(fichierCle, 'utf8'), certPem };
  }

  // Nouveau certificat : premier démarrage, adresse IP changée ou expiration proche.
  const paire = (await webcrypto.subtle.generateKey(ALGO_CLE, true, ['sign', 'verify'])) as CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: numeroSerie(),
    subject: `CN=${CN_CERTIFICAT_SERVEUR}, O=SOMIDAC SARL`,
    issuer: caCert.subject,
    notBefore: new Date(Date.now() - JOUR_MS),
    notAfter: new Date(Date.now() + 2 * 365 * JOUR_MS),
    publicKey: paire.publicKey,
    signingKey: caCle,
    signingAlgorithm: ALGO_SIGNATURE,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], true),
      new x509.SubjectAlternativeNameExtension([
        ...noms.dns.map((value) => ({ type: 'dns' as const, value })),
        ...noms.ip.map((value) => ({ type: 'ip' as const, value })),
      ]),
      await x509.AuthorityKeyIdentifierExtension.create(caCert.publicKey),
    ],
  });
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', paire.privateKey));
  const clePem = crypto
    .createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  ecrireFichierPrive(fichierCle, clePem);
  ecrireFichierPrive(fichierCert, cert.toString('pem'));
  return { clePem, certPem: cert.toString('pem') };
}
