import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { demarrerServeur, ServeurTest, sql, viderBase } from '../../server/test/outils';
import { DecouverteService } from '../../server/src/noyau/decouverte/decouverte.service';
import { rechercherPostesPrincipaux } from '../src/main/poste/decouverte';
import { Chiffreur, ErreurPoste, Poste } from '../src/main/poste/poste';

/** Simule le chiffrement du système (DPAPI) : une clé propre à « ce PC ». */
function chiffreurDuPc(): Chiffreur {
  const cle = crypto.randomBytes(32);
  return {
    disponible: () => true,
    chiffrer(texte) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
      const donnees = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), donnees]);
    },
    dechiffrer(b) {
      const d = crypto.createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}

const dossierTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'somidac-poste-'));
const GERANT = { identifiant: 'gerant', nomComplet: 'Gérant', motDePasse: 'Somidac#2026' };

describe('Poste : enregistrement et connexion', () => {
  let srv: ServeurTest;
  const pcPrincipal = chiffreurDuPc();
  const pcMagasin = chiffreurDuPc();
  const dossierPrincipal = dossierTemp();
  const dossierMagasin = dossierTemp();
  let principal: Poste;
  let magasin: Poste;

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
  });
  after(async () => srv?.arreter());

  it('trouve le poste principal sur le réseau, sans saisir d’adresse', async () => {
    const port = srv.app.get(DecouverteService).port!;
    const trouves = await rechercherPostesPrincipaux({ port, delaiMs: 1000 });
    assert.equal(trouves.length, 1, JSON.stringify(trouves));
    assert.equal(trouves[0].application, 'somidac');
    assert.equal(trouves[0].port, srv.port);
    assert.equal(trouves[0].initialise, false);
    assert.equal(trouves[0].local, true);
  });

  it('initialise le poste principal et protège sa clé', async () => {
    principal = new Poste(dossierPrincipal, pcPrincipal);
    assert.equal(principal.etat().configure, false);
    assert.equal(await principal.serveurJoignable({ hote: '127.0.0.1', port: srv.port }), true);
    const etat = await principal.initialiserPostePrincipal({ gerant: GERANT, nomPoste: 'Poste principal', port: srv.port });
    assert.equal(etat.configure, true);
    assert.equal(etat.mode, 'principal');
    const fichier = fs.readFileSync(path.join(dossierPrincipal, 'poste.json'), 'utf8');
    assert.ok(!fichier.includes('PRIVATE KEY'), 'la clé privée n’est jamais écrite en clair');
  });

  it('le gérant se connecte et crée un appareil', async () => {
    const profil = await principal.connecter('gerant', GERANT.motDePasse);
    assert.equal(profil.identifiant, 'gerant');
    assert.equal(principal.etat().connecte, true);
  });

  let code = '';
  it('un code faux est refusé', async () => {
    const r = await principal.appeler<{ codeActivation: string }>('POST', '/appareils', { nom: 'PC magasin' });
    assert.equal(r.statut, 201);
    code = r.corps.codeActivation;
    magasin = new Poste(dossierMagasin, pcMagasin);
    await assert.rejects(
      magasin.enregistrerPosteSecondaire(`127.0.0.1:${srv.port}`, 'AAAA-BBBB-CCCC'),
      (e: ErreurPoste) => e.code === 'CODE_ACTIVATION_INVALIDE',
    );
    await assert.rejects(magasin.enregistrerPosteSecondaire(`127.0.0.1:${srv.port}`, 'n importe quoi'), ErreurPoste);
  });

  it('le poste secondaire s’enregistre avec le code et se connecte', async () => {
    const etat = await magasin.enregistrerPosteSecondaire(`127.0.0.1:${srv.port}`, code.toLowerCase());
    assert.equal(etat.mode, 'secondaire');
    assert.equal(etat.nomAppareil, 'PC magasin');
    const profil = await magasin.connecter('gerant', GERANT.motDePasse);
    assert.equal(profil.nomComplet, 'Gérant');
  });

  it('l’identité est conservée au redémarrage de l’application', async () => {
    const relance = new Poste(dossierMagasin, pcMagasin);
    assert.equal(relance.etat().configure, true);
    await relance.connecter('gerant', GERANT.motDePasse);
  });

  it('le fichier copié sur un autre PC est inutilisable', () => {
    const autrePc = dossierTemp();
    fs.copyFileSync(path.join(dossierMagasin, 'poste.json'), path.join(autrePc, 'poste.json'));
    const copie = new Poste(autrePc, chiffreurDuPc());
    assert.equal(copie.etat().configure, false);
  });

  it('le certificat est renouvelé automatiquement à l’approche de l’expiration', async () => {
    assert.equal(await magasin.renouvelerSiNecessaire(), false);
    const dans340Jours = Date.now() + 340 * 24 * 3600_000;
    const serie = async () =>
      (await sql<{ s: string }>("SELECT numero_serie_certificat AS s FROM appareils WHERE nom = 'PC magasin'"))[0].s;
    const avant = await serie();
    // Côté serveur aussi, le certificat arrive à expiration dans 10 jours.
    await sql("UPDATE appareils SET certificat_expire_le = now() + interval '10 days' WHERE nom = 'PC magasin'");
    assert.equal(await magasin.renouvelerSiNecessaire(dans340Jours), true);
    assert.notEqual(await serie(), avant, 'un nouveau certificat a été émis');
    // Le nouveau certificat fonctionne.
    await magasin.connecter('gerant', GERANT.motDePasse);
  });

  it('un appareil révoqué ne peut plus rien faire', async () => {
    const liste = await principal.appeler<{ id: string; nom: string }[]>('GET', '/appareils');
    const id = liste.corps.find((a) => a.nom === 'PC magasin')!.id;
    await principal.appeler('POST', `/appareils/${id}/revoquer`);
    await assert.rejects(magasin.connecter('gerant', GERANT.motDePasse), (e: ErreurPoste) => e.code === 'APPAREIL_REVOQUE');
  });
});
