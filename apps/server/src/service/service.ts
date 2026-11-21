import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { creerApplication } from '../application';
import { Coffre, CoffreDpapi, CoffreFichier } from '../noyau/pki/coffre';
import { PostgresEmbarque } from './postgres';

/**
 * Service « SOMIDAC Serveur » du poste principal.
 * 1. prépare le dossier de données (C:\ProgramData\SOMIDAC) ;
 * 2. crée puis démarre PostgreSQL, en local uniquement ;
 * 3. démarre le serveur SOMIDAC (HTTPS, TLS mutuel) ;
 * 4. arrête proprement les deux à la fermeture du service.
 */
export interface ConfigService {
  racine: string;
  pgBin: string;
  pgPort: number;
  port: number;
  coffre: Coffre;
}

export function configServiceParDefaut(env: NodeJS.ProcessEnv = process.env): ConfigService {
  const windows = process.platform === 'win32';
  const racine = path.resolve(
    env.SOMIDAC_PROGRAMDATA ?? (windows ? path.join(env.ProgramData ?? 'C:\\ProgramData', 'SOMIDAC') : path.join(process.cwd(), '.service')),
  );
  return {
    racine,
    pgBin: path.resolve(env.SOMIDAC_PG_BIN ?? path.join(__dirname, '..', 'postgresql', 'bin')),
    pgPort: Number(env.SOMIDAC_PG_PORT ?? 5433),
    port: Number(env.SOMIDAC_PORT ?? 7443),
    // Sous Windows, les secrets sont chiffrés par DPAPI pour le compte du service.
    coffre: windows && env.SOMIDAC_COFFRE !== 'fichier' ? new CoffreDpapi(path.join(racine, 'secrets')) : new CoffreFichier(path.join(racine, 'secrets')),
  };
}

export async function demarrerService(c: ConfigService): Promise<{ arreter: () => Promise<void>; app: INestApplication }> {
  const journal = new Logger('Service');
  for (const d of ['base', 'serveur', 'journaux', 'secrets', 'sauvegardes']) {
    fs.mkdirSync(path.join(c.racine, d), { recursive: true });
  }

  let motDePasseBase = c.coffre.lire('motDePasseBase');
  if (!motDePasseBase) {
    motDePasseBase = crypto.randomBytes(24).toString('base64url');
    c.coffre.ecrire('motDePasseBase', motDePasseBase);
  }

  const pg = new PostgresEmbarque({
    binDir: c.pgBin,
    dataDir: path.join(c.racine, 'base'),
    journalDir: path.join(c.racine, 'journaux'),
    port: c.pgPort,
    utilisateur: 'somidac',
  });
  if (!pg.initialisee) {
    journal.log('Première installation : création de la base de données');
    pg.initialiser(motDePasseBase);
  }
  pg.demarrer();
  pg.creerBase('somidac', motDePasseBase);
  journal.log(`PostgreSQL prêt (127.0.0.1:${c.pgPort})`);

  let app: INestApplication;
  try {
    ({ app } = await creerApplication(
      {
        databaseUrl: `postgres://somidac:${encodeURIComponent(motDePasseBase)}@127.0.0.1:${c.pgPort}/somidac`,
        dataDir: path.join(c.racine, 'serveur'),
        port: c.port,
        hoteEcoute: '0.0.0.0',
        version: process.env.SOMIDAC_VERSION ?? '0.1.0',
        pgBin: c.pgBin,
        sauvegardesDir: path.join(c.racine, 'sauvegardes'),
      },
      { coffre: c.coffre },
    ));
    await app.listen(c.port, '0.0.0.0');
  } catch (e) {
    pg.arreter();
    throw e;
  }
  journal.log(`Serveur SOMIDAC démarré sur le port ${c.port}`);

  let arrete = false;
  const arreter = async () => {
    if (arrete) return;
    arrete = true;
    journal.log('Arrêt du service');
    await app.close().catch(() => undefined);
    pg.arreter();
  };
  return { arreter, app };
}
