import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { CoffreFichier } from '../src/noyau/pki/coffre';
import { ConfigService, demarrerService } from '../src/service/service';
import { PostgresEmbarque } from '../src/service/postgres';
import { PG_BIN } from './outils';


async function sante(port: number) {
  const https = await import('node:https');
  return new Promise<{ statut: number; corps: any }>((resolve, reject) => {
    https
      .get({ host: '127.0.0.1', port, path: '/api/v1/initialisation', rejectUnauthorized: false }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ statut: res.statusCode ?? 0, corps: JSON.parse(d) }));
      })
      .on('error', reject);
  });
}

/** Le service du poste principal : PostgreSQL embarqué + serveur, de l'installation au redémarrage. */
describe('Service du poste principal', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'somidac-service-'));
  const config: ConfigService = { racine, pgBin: PG_BIN, pgPort: 5499, port: 0, coffre: new CoffreFichier(path.join(racine, 'secrets')) };
  const pg = new PostgresEmbarque({ binDir: PG_BIN, dataDir: path.join(racine, 'base'), journalDir: path.join(racine, 'journaux'), port: 5499, utilisateur: 'somidac' });

  after(() => {
    pg.arreter();
    fs.rmSync(racine, { recursive: true, force: true });
  });

  it('premier démarrage : crée la base, démarre PostgreSQL puis le serveur', async () => {
    const { app, arreter } = await demarrerService(config);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const r = await sante(port);
    assert.equal(r.statut, 200);
    assert.equal(r.corps.initialise, false);
    assert.ok(pg.enCours());
    assert.ok(config.coffre.lire('motDePasseBase'), 'mot de passe de la base dans le coffre');
    assert.ok(config.coffre.lire('motDePasseCleAutorite'), 'mot de passe de la clé d’autorité dans le coffre');
    const conf = fs.readFileSync(path.join(racine, 'base', 'postgresql.conf'), 'utf8');
    assert.match(conf, /listen_addresses = '127\.0\.0\.1'/);
    assert.ok(!fs.readdirSync(racine).some((f) => f.startsWith('.initdb')), 'le fichier temporaire du mot de passe est supprimé');
    const journal = fs.readFileSync(path.join(racine, 'journaux', 'serveur.log'), 'utf8');
    assert.match(journal, /Serveur SOMIDAC prêt/, 'les étapes sont écrites dans le journal du service');
    await arreter();
    assert.equal(pg.enCours(), false, 'PostgreSQL est arrêté avec le service');
  });

  it('redémarrage : réutilise la base et les secrets existants', async () => {
    const autorite = fs.readFileSync(path.join(racine, 'serveur', 'pki', 'autorite.cert.pem'), 'utf8');
    const { app, arreter } = await demarrerService(config);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    assert.equal((await sante(port)).statut, 200);
    assert.equal(fs.readFileSync(path.join(racine, 'serveur', 'pki', 'autorite.cert.pem'), 'utf8'), autorite, 'même autorité');
    await arreter();
  });

  it('reprend après un arrêt brutal (PostgreSQL resté en marche)', async () => {
    pg.demarrer();
    const { app, arreter } = await demarrerService(config);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    assert.equal((await sante(port)).statut, 200);
    await arreter();
  });
});
