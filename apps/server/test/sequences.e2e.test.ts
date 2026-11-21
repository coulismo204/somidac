import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DB, Db } from '../src/noyau/base/base';
import { SequencesService } from '../src/noyau/sequences/sequences.service';
import { demarrerServeur, ServeurTest, viderBase } from './outils';

/** Règle R6 : séries annuelles, continues et sans trou. */
describe('Numérotation des documents', () => {
  let srv: ServeurTest;
  let db: Db;
  let sequences: SequencesService;

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    db = srv.app.get(DB);
    sequences = srv.app.get(SequencesService);
  });
  after(async () => srv?.arreter());

  it('numérote en continu par type et par année', async () => {
    const date = new Date('2026-06-01');
    const n1 = await db.transaction((tx) => sequences.suivant(tx, 'FAC', date));
    const n2 = await db.transaction((tx) => sequences.suivant(tx, 'FAC', date));
    const bl = await db.transaction((tx) => sequences.suivant(tx, 'BL', date));
    const an2027 = await db.transaction((tx) => sequences.suivant(tx, 'FAC', new Date('2027-01-02')));
    assert.deepEqual([n1, n2, bl, an2027], ['FAC-2026-00001', 'FAC-2026-00002', 'BL-2026-00001', 'FAC-2027-00001']);
  });

  it('un document annulé avant validation ne consomme pas de numéro', async () => {
    const date = new Date('2026-06-01');
    await assert.rejects(
      db.transaction(async (tx) => {
        await sequences.suivant(tx, 'FAC', date);
        throw new Error('validation échouée');
      }),
    );
    const suivant = await db.transaction((tx) => sequences.suivant(tx, 'FAC', date));
    assert.equal(suivant, 'FAC-2026-00003');
  });

  it('deux validations simultanées n’obtiennent jamais le même numéro', async () => {
    const date = new Date('2026-06-01');
    const numeros = await Promise.all(
      Array.from({ length: 20 }, () => db.transaction((tx) => sequences.suivant(tx, 'PAI', date))),
    );
    assert.equal(new Set(numeros).size, 20);
    assert.deepEqual(
      [...numeros].sort(),
      Array.from({ length: 20 }, (_, i) => `PAI-2026-${String(i + 1).padStart(5, '0')}`),
    );
  });
});
