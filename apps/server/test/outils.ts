import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import {
  CN_CERTIFICAT_SERVEUR,
  decouperCodeActivation,
  PREFIXE_PREUVE_APPAREIL,
  PREFIXE_PREUVE_SERVEUR,
} from '@somidac/shared';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import type { INestApplication } from '@nestjs/common';
import { creerApplication } from '../src/application';
import { Configuration } from '../src/config/configuration';

const webcrypto = crypto.webcrypto as unknown as Crypto;
x509.cryptoProvider.set(webcrypto);

// Pas de sauvegarde automatique pendant les tests.
process.env.SOMIDAC_SAUVEGARDE_AUTO = '0';

/** Outils PostgreSQL de la machine (pg_dump, pg_restore). */
export const PG_BIN =
  process.env.SOMIDAC_TEST_PG_BIN ??
  fs
    .readdirSync('/usr/lib/postgresql')
    .sort((a, b) => Number(a) - Number(b))
    .map((v) => `/usr/lib/postgresql/${v}/bin`)
    .pop()!;

export const URL_BASE_TEST =
  process.env.SOMIDAC_TEST_DATABASE_URL ?? 'postgres://somidac:somidac_dev@127.0.0.1:5433/somidac_test';

/** Repart d'une base vide. */
export async function viderBase() {
  const client = new Client({ connectionString: URL_BASE_TEST });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await client.end();
}

export async function sql<T = Record<string, unknown>>(texte: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: URL_BASE_TEST });
  await client.connect();
  try {
    return (await client.query(texte, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export interface ServeurTest {
  app: INestApplication;
  port: number;
  dataDir: string;
  caPem: string;
  arreter(): Promise<void>;
}

export async function demarrerServeur(): Promise<ServeurTest> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'somidac-test-'));
  const config: Configuration = {
    databaseUrl: URL_BASE_TEST,
    dataDir,
    port: 0,
    hoteEcoute: '127.0.0.1',
    version: 'test',
    pgBin: PG_BIN,
    portDecouverte: 0,
    sauvegardesDir: path.join(dataDir, 'sauvegardes'),
  };
  const { app, pki } = await creerApplication(config, {
    journaux: false,
    nomsServeur: { dns: ['localhost'], ip: ['127.0.0.1'] },
  });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return {
    app,
    port,
    dataDir,
    caPem: pki.caPem,
    async arreter() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Ce que possède un appareil : sa clé privée (jamais transmise) et son certificat. */
export interface IdentiteAppareil {
  clePem: string;
  certificatPem?: string;
  caPem?: string;
  csrPem: string;
}

export async function nouvelleIdentite(): Promise<IdentiteAppareil> {
  const cles = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: 'CN=nouvel appareil',
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

export function hmac(secret: string, message: string) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/** Preuve calculée par l'appareil à partir du code saisi par l'utilisateur. */
export function preuveEnrolement(code: string, csrPem: string) {
  const parties = decouperCodeActivation(code);
  if (!parties) throw new Error('code mal formé');
  return { idCode: parties.idCode, preuve: hmac(parties.secret, PREFIXE_PREUVE_APPAREIL + csrPem), secret: parties.secret };
}

export function verifierPreuveServeur(secret: string, certificatPem: string, caPem: string, preuve: string) {
  return hmac(secret, PREFIXE_PREUVE_SERVEUR + certificatPem + caPem) === preuve;
}

export interface Reponse<T = any> {
  statut: number;
  corps: T;
}

/** Requête HTTPS comme le ferait un poste : certificat client + vérification stricte du serveur. */
export function requete<T = any>(
  serveur: ServeurTest,
  methode: string,
  chemin: string,
  options: { corps?: unknown; appareil?: IdentiteAppareil; jeton?: string } = {},
): Promise<Reponse<T>> {
  const corps = options.corps === undefined ? undefined : JSON.stringify(options.corps);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: serveur.port,
        method: methode,
        path: `/api/v1${chemin}`,
        ca: serveur.caPem,
        key: options.appareil?.certificatPem ? options.appareil.clePem : undefined,
        cert: options.appareil?.certificatPem,
        // Seul le certificat « SOMIDAC Serveur » signé par l'autorité interne est accepté.
        checkServerIdentity: (_hote, cert) =>
          cert.subject?.CN === CN_CERTIFICAT_SERVEUR ? undefined : new Error('Serveur non reconnu'),
        headers: {
          'content-type': 'application/json',
          ...(corps ? { 'content-length': Buffer.byteLength(corps) } : {}),
          ...(options.jeton ? { authorization: `Bearer ${options.jeton}` } : {}),
        },
        agent: false,
      },
      (res) => {
        let donnees = '';
        res.on('data', (c) => (donnees += c));
        res.on('end', () => {
          let parse: unknown = donnees;
          try {
            parse = donnees ? JSON.parse(donnees) : undefined;
          } catch {
            /* texte brut */
          }
          resolve({ statut: res.statusCode ?? 0, corps: parse as T });
        });
      },
    );
    req.on('error', reject);
    if (corps) req.write(corps);
    req.end();
  });
}

/** Initialise le serveur et connecte le gérant depuis le poste principal. */
export async function initialiserAvecGerant(srv: ServeurTest, motDePasse = 'Somidac#2026') {
  const poste = await nouvelleIdentite();
  const init = await requete(srv, 'POST', '/initialisation', {
    corps: { gerant: { identifiant: 'gerant', nomComplet: 'Gérant', motDePasse }, appareil: { nom: 'Poste principal', csrPem: poste.csrPem } },
  });
  if (init.statut !== 201) throw new Error(`initialisation : ${JSON.stringify(init.corps)}`);
  poste.certificatPem = init.corps.certificatPem;
  const c = await requete(srv, 'POST', '/auth/connexion', { appareil: poste, corps: { identifiant: 'gerant', motDePasse } });
  return { poste, jeton: c.corps.jeton as string };
}

/** Enregistre un nouvel appareil (code d'activation + preuve) et le renvoie prêt à l'emploi. */
export async function enregistrerAppareil(srv: ServeurTest, admin: { poste: IdentiteAppareil; jeton: string }, nom: string) {
  const code = await requete(srv, 'POST', '/appareils', { appareil: admin.poste, jeton: admin.jeton, corps: { nom } });
  const id = await nouvelleIdentite();
  const { idCode, preuve } = preuveEnrolement(code.corps.codeActivation, id.csrPem);
  const r = await requete(srv, 'POST', '/enrolement', { corps: { idCode, csrPem: id.csrPem, preuve } });
  id.certificatPem = r.corps.certificatPem;
  return { identite: id, id: code.corps.appareil.id as string };
}
