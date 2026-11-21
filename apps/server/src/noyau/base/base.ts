import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Une opération peut s'exécuter sur la base ou dans une transaction en cours. */
export type DbOuTx = Db | Tx;
