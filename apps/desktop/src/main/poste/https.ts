import { CN_CERTIFICAT_SERVEUR } from '@somidac/shared';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import type { TLSSocket } from 'node:tls';

export interface AdresseServeur {
  hote: string;
  port: number;
}

export interface ReponseApi<T = unknown> {
  statut: number;
  corps: T;
  /** Certificat présenté par le serveur (DER), pour vérification après l'enregistrement. */
  certificatServeurDer?: Buffer;
}

export interface OptionsRequete {
  corps?: unknown;
  jeton?: string;
  /** Identité de l'appareil : clé privée + certificat. */
  cle?: string;
  certificat?: string;
  /** Autorité interne épinglée. Absente uniquement pendant l'enregistrement. */
  ca?: string;
  delaiMs?: number;
}

export class ErreurReseau extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Requête HTTPS vers le serveur SOMIDAC.
 * Avec `ca` : seul le certificat « SOMIDAC Serveur » signé par l'autorité interne est accepté.
 * Sans `ca` (enregistrement) : la vérification se fait après coup (preuve HMAC + chaîne).
 */
export function requeteServeur<T = unknown>(
  adresse: AdresseServeur,
  methode: string,
  chemin: string,
  options: OptionsRequete = {},
): Promise<ReponseApi<T>> {
  const corps = options.corps === undefined ? undefined : JSON.stringify(options.corps);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: adresse.hote,
        port: adresse.port,
        method: methode,
        path: `/api/v1${chemin}`,
        key: options.certificat ? options.cle : undefined,
        cert: options.certificat,
        ca: options.ca,
        rejectUnauthorized: !!options.ca,
        checkServerIdentity: (_hote, cert) =>
          cert.subject?.CN === CN_CERTIFICAT_SERVEUR
            ? undefined
            : new Error('Le serveur ne présente pas un certificat SOMIDAC'),
        servername: undefined,
        agent: false,
        timeout: options.delaiMs ?? 15_000,
        headers: {
          accept: 'application/json',
          ...(corps ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps) } : {}),
          ...(options.jeton ? { authorization: `Bearer ${options.jeton}` } : {}),
        },
      },
      (res) => {
        const socket = res.socket as TLSSocket;
        const certServeur = socket.getPeerCertificate?.();
        let donnees = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (donnees += c));
        res.on('end', () => {
          let parse: unknown = undefined;
          try {
            parse = donnees ? JSON.parse(donnees) : undefined;
          } catch {
            parse = { message: donnees };
          }
          resolve({ statut: res.statusCode ?? 0, corps: parse as T, certificatServeurDer: certServeur?.raw });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', (e) => reject(new ErreurReseau(messageReseau(e), e)));
    if (corps) req.write(corps);
    req.end();
  });
}

/** Vérifie que le certificat présenté par le serveur est bien signé par l'autorité reçue. */
export function certificatServeurSigneParAutorite(certificatDer: Buffer | undefined, caPem: string): boolean {
  if (!certificatDer) return false;
  try {
    const cert = new crypto.X509Certificate(certificatDer);
    const ca = new crypto.X509Certificate(caPem);
    return cert.checkIssued(ca) && cert.verify(ca.publicKey) && cert.subject.includes(`CN=${CN_CERTIFICAT_SERVEUR}`);
  } catch {
    return false;
  }
}

function messageReseau(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ECONNREFUSED':
      return 'Le serveur SOMIDAC ne répond pas à cette adresse.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ETIMEDOUT':
      return 'Serveur injoignable : vérifiez le Wi-Fi et que le poste principal est allumé.';
    case 'ENOTFOUND':
      return 'Adresse du serveur introuvable.';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'Connexion au serveur interrompue.';
    default:
      if (code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
        return "Le serveur présente un certificat inconnu : ce n'est peut-être pas le serveur SOMIDAC.";
      }
      return `Erreur de connexion au serveur${code ? ` (${code})` : ''}.`;
  }
}
