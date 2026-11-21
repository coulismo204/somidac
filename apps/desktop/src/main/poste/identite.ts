import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import * as crypto from 'node:crypto';

const webcrypto = crypto.webcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

const JOUR_MS = 24 * 3600_000;

/**
 * Crée la paire de clés de l'appareil (§10.1 étape 3) et la demande de certificat.
 * La clé privée reste sur l'appareil ; seule la CSR (clé publique) est envoyée.
 */
export async function creerCleEtDemande(nom: string): Promise<{ clePem: string; csrPem: string }> {
  const cles = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${nom.replace(/[,=+<>#;"\\]/g, ' ').slice(0, 60)}`,
    keys: cles,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', cles.privateKey));
  const clePem = crypto
    .createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return { clePem, csrPem: csr.toString('pem') };
}

/** Nouvelle demande de certificat pour la clé existante (renouvellement). */
export async function demandeDepuisCle(clePem: string, nom: string): Promise<string> {
  const privee = crypto.createPrivateKey(clePem);
  const publique = crypto.createPublicKey(privee);
  const cles = {
    privateKey: await webcrypto.subtle.importKey(
      'pkcs8',
      privee.export({ type: 'pkcs8', format: 'der' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    ),
    publicKey: await webcrypto.subtle.importKey(
      'spki',
      publique.export({ type: 'spki', format: 'der' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    ),
  } as CryptoKeyPair;
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${nom.replace(/[,=+<>#;"\\]/g, ' ').slice(0, 60)}`,
    keys: cles,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  });
  return csr.toString('pem');
}

export function dateExpiration(certificatPem: string): Date {
  return new Date(new crypto.X509Certificate(certificatPem).validTo);
}

export function joursAvantExpiration(certificatPem: string, maintenant = Date.now()): number {
  return Math.floor((dateExpiration(certificatPem).getTime() - maintenant) / JOUR_MS);
}
