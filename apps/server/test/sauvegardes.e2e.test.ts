import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  demarrerServeur,
  enregistrerAppareil,
  IdentiteAppareil,
  initialiserAvecGerant,
  requete,
  ServeurTest,
  sql,
  viderBase,
} from './outils';

/** Sauvegarde chiffrée, copie externe, vérification et restauration (§9). */
describe('Sauvegardes', () => {
  let srv: ServeurTest;
  let admin: { poste: IdentiteAppareil; jeton: string };
  const externe = fs.mkdtempSync(path.join(os.tmpdir(), 'somidac-cle-usb-'));
  const MDP_RESTAURATION = 'Restauration#2026';
  let fichier = '';
  const appel = (methode: string, chemin: string, corps?: unknown) =>
    requete(srv, methode, chemin, { appareil: admin.poste, jeton: admin.jeton, corps });

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
    admin = await initialiserAvecGerant(srv);
  });
  after(async () => {
    await srv?.arreter();
    fs.rmSync(externe, { recursive: true, force: true });
    const anciennes = await sql<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE 'somidac_test_%'");
    for (const { datname } of anciennes) await sql(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  });

  it('signale que les sauvegardes ne sont pas configurées', async () => {
    const r = await appel('GET', '/sauvegardes');
    assert.equal(r.corps.configure, false);
    assert.ok(r.corps.alertes.length > 0);
    const s = await appel('POST', '/sauvegardes');
    assert.equal(s.corps.code, 'SAUVEGARDE_NON_CONFIGUREE');
  });

  it('exige un mot de passe de restauration d’au moins 10 caractères', async () => {
    assert.equal((await appel('PUT', '/sauvegardes/mot-de-passe', { motDePasse: 'court' })).statut, 400);
    const r = await appel('PUT', '/sauvegardes/mot-de-passe', { motDePasse: MDP_RESTAURATION });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
    assert.equal(r.corps.configure, true);
  });

  it('refuse un dossier externe inutilisable, accepte un vrai dossier', async () => {
    const faux = await appel('PUT', '/sauvegardes/reglages', { heure: '20:00', dossiers: ['relatif/dossier'] });
    assert.equal(faux.corps.code, 'DOSSIER_INACCESSIBLE');
    const ok = await appel('PUT', '/sauvegardes/reglages', { heure: '20:00', dossiers: [externe] });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  });

  it('sauvegarde : fichier chiffré, copié sur la « clé USB »', async () => {
    const r = await appel('POST', '/sauvegardes');
    assert.equal(r.statut, 201, JSON.stringify(r.corps));
    assert.equal(r.corps.statut, 'reussie');
    assert.deepEqual(r.corps.copies.map((c: { ok: boolean }) => c.ok), [true]);
    fichier = r.corps.fichier;
    const contenu = fs.readFileSync(path.join(externe, fichier));
    assert.ok(contenu.subarray(0, 8).equals(Buffer.from('SOMIDAC1')));
    assert.ok(!contenu.includes(Buffer.from('Gérant')), 'aucune donnée en clair');
    const etat = await appel('GET', '/sauvegardes');
    assert.deepEqual(etat.corps.alertes, []);
  });

  it('vérification : mauvais mot de passe refusé, bon mot de passe accepté', async () => {
    const faux = await appel('POST', '/sauvegardes/verifier', { nom: fichier, dossier: externe, motDePasse: 'mauvais' });
    assert.equal(faux.statut, 401);
    const ok = await appel('POST', '/sauvegardes/verifier', { nom: fichier, dossier: externe, motDePasse: MDP_RESTAURATION });
    assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
    assert.equal(ok.corps.valide, true);
  });

  it('refuse de lire un fichier hors des dossiers de sauvegarde', async () => {
    const r = await appel('POST', '/sauvegardes/verifier', { nom: fichier, dossier: '/etc', motDePasse: MDP_RESTAURATION });
    assert.equal(r.corps.code, 'DOSSIER_NON_AUTORISE');
  });

  it('restauration : retour à l’état sauvegardé, appareils et révocations conservés', async () => {
    // Changements après la sauvegarde.
    await appel('POST', '/utilisateurs', { identifiant: 'temporaire', nomComplet: 'Créé après', motDePasseInitial: 'Temporaire#1', roles: ['caissier'] });
    const nouveau = await enregistrerAppareil(srv, admin, 'PC après sauvegarde');
    const revoque = await enregistrerAppareil(srv, admin, 'PC révoqué après');
    await appel('POST', `/appareils/${revoque.id}/revoquer`);

    const sansConfirmation = await appel('POST', '/sauvegardes/restaurer', { nom: fichier, dossier: externe, motDePasse: MDP_RESTAURATION });
    assert.equal(sansConfirmation.statut, 400);

    const r = await appel('POST', '/sauvegardes/restaurer', {
      nom: fichier,
      dossier: externe,
      motDePasse: MDP_RESTAURATION,
      confirmation: 'RESTAURER',
    });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));

    // Toutes les sessions sont fermées : on se reconnecte.
    assert.equal((await appel('GET', '/auth/moi')).statut, 401);
    const c = await requete(srv, 'POST', '/auth/connexion', { appareil: admin.poste, corps: { identifiant: 'gerant', motDePasse: 'Somidac#2026' } });
    assert.equal(c.statut, 200);
    admin.jeton = c.corps.jeton;

    const utilisateurs = await appel('GET', '/utilisateurs');
    assert.ok(!utilisateurs.corps.some((u: { identifiant: string }) => u.identifiant === 'temporaire'), 'données revenues à la sauvegarde');

    const auNouveau = await requete(srv, 'POST', '/auth/connexion', { appareil: nouveau.identite, corps: { identifiant: 'gerant', motDePasse: 'Somidac#2026' } });
    assert.equal(auNouveau.statut, 200, 'un appareil enregistré après la sauvegarde reste autorisé');
    const auRevoque = await requete(srv, 'POST', '/auth/connexion', { appareil: revoque.identite, corps: { identifiant: 'gerant', motDePasse: 'Somidac#2026' } });
    assert.equal(auRevoque.corps.code, 'APPAREIL_REVOQUE', 'un appareil révoqué après la sauvegarde reste révoqué');

    const verif = await appel('GET', '/audit/verification');
    assert.equal(verif.corps.valide, true, 'journal d’audit intact après restauration');
    const historique = await appel('GET', '/sauvegardes');
    assert.ok(historique.corps.historique.length >= 1);
  });
});
