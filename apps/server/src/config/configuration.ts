import * as path from 'node:path';

export interface Configuration {
  databaseUrl: string;
  /** Dossier des données du serveur : certificats, secrets, sauvegardes. */
  dataDir: string;
  port: number;
  hoteEcoute: string;
  version: string;
  /** Dossier des outils PostgreSQL (pg_dump, pg_restore) pour les sauvegardes. */
  pgBin?: string;
  /** Dossier local des sauvegardes. */
  sauvegardesDir: string;
}

export const CONFIGURATION = Symbol('CONFIGURATION');

export function chargerConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const databaseUrl = env.SOMIDAC_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Variable SOMIDAC_DATABASE_URL manquante');
  }
  const port = Number(env.SOMIDAC_PORT ?? 7443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SOMIDAC_PORT invalide : ${env.SOMIDAC_PORT}`);
  }
  const dataDir = path.resolve(env.SOMIDAC_DATA_DIR ?? path.join(process.cwd(), '.donnees'));
  return {
    databaseUrl,
    dataDir,
    pgBin: env.SOMIDAC_PG_BIN ? path.resolve(env.SOMIDAC_PG_BIN) : undefined,
    sauvegardesDir: path.resolve(env.SOMIDAC_SAUVEGARDES_DIR ?? path.join(dataDir, 'sauvegardes')),
    port,
    hoteEcoute: env.SOMIDAC_HOTE ?? '0.0.0.0',
    version: env.npm_package_version ?? '0.1.0',
  };
}
