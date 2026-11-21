import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { CONFIGURATION, Configuration } from '../../config/configuration';
import { DB, Db, POOL } from './base';
import { trouverDossierMigrations } from './migrations';
import * as schema from './schema';
import { InitialiserDonnees } from './donnees-initiales';

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [CONFIGURATION],
      useFactory: (config: Configuration) => {
        const pool = new Pool({ connectionString: config.databaseUrl, max: 10, application_name: 'somidac-serveur' });
        // Connexion inactive coupée (redémarrage de PostgreSQL, restauration) : elle est simplement remplacée.
        pool.on('error', (e) => new Logger('Base').warn(`Connexion à la base perdue : ${e.message}`));
        return pool;
      },
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (pool: Pool) => drizzle({ client: pool, schema }),
    },
    InitialiserDonnees,
  ],
  exports: [DB, POOL],
})
export class BaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Base');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(POOL) private readonly pool: Pool,
    private readonly donnees: InitialiserDonnees,
  ) {}

  async onModuleInit() {
    const dossier = trouverDossierMigrations();
    await migrate(this.db, { migrationsFolder: dossier });
    this.logger.log('Schéma de la base à jour');
    await this.donnees.executer();
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
