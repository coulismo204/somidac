import { CODES_ERREUR as E } from '@somidac/shared';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  demarrerServeur,
  IdentiteAppareil,
  nouvelleIdentite,
  preuveEnrolement,
  requete,
  ServeurTest,
  sql,
  verifierPreuveServeur,
  viderBase,
} from './outils';

/**
 * Scénario complet du socle de sécurité (cahier des charges §3 et §10),
 * joué contre un vrai serveur HTTPS avec authentification mutuelle des appareils.
 */
describe('Socle de sécurité', () => {
  let srv: ServeurTest;
  const postePrincipal = {} as IdentiteAppareil;
  const pcMagasin = {} as IdentiteAppareil;
  let jetonGerant = '';
  const GERANT = { identifiant: 'gerant', nomComplet: 'Gérant SOMIDAC', motDePasse: 'Somidac#2026' };

  before(async () => {
    await viderBase();
    srv = await demarrerServeur();
  });
  after(async () => {
    await srv?.arreter();
  });

  describe('Appareils non enregistrés', () => {
    it('le serveur répond au contrôle de santé sans certificat', async () => {
      const r = await requete(srv, 'GET', '/sante');
      assert.equal(r.statut, 200);
      assert.equal(r.corps.statut, 'ok');
    });

    it('refuse toute autre route sans certificat d’appareil', async () => {
      const r = await requete(srv, 'GET', '/parametres');
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.APPAREIL_NON_RECONNU);
    });

    it('refuse la connexion sans certificat, même avec un bon mot de passe', async () => {
      const r = await requete(srv, 'POST', '/auth/connexion', {
        corps: { identifiant: GERANT.identifiant, motDePasse: GERANT.motDePasse },
      });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.APPAREIL_NON_RECONNU);
    });
  });

  describe('Initialisation du poste principal', () => {
    it('crée le gérant et enregistre le poste principal', async () => {
      Object.assign(postePrincipal, await nouvelleIdentite());
      const r = await requete(srv, 'POST', '/initialisation', {
        corps: {
          raisonSociale: 'SOMIDAC SARL',
          gerant: GERANT,
          appareil: { nom: 'Poste principal', csrPem: postePrincipal.csrPem, infosSysteme: { systeme: 'test' } },
        },
      });
      assert.equal(r.statut, 201, JSON.stringify(r.corps));
      assert.match(r.corps.certificatPem, /BEGIN CERTIFICATE/);
      assert.equal(r.corps.caPem.trim(), srv.caPem.trim());
      postePrincipal.certificatPem = r.corps.certificatPem;
    });

    it('ne peut pas être refaite', async () => {
      const autre = await nouvelleIdentite();
      const r = await requete(srv, 'POST', '/initialisation', {
        corps: { gerant: { ...GERANT, identifiant: 'pirate' }, appareil: { nom: 'Pirate', csrPem: autre.csrPem } },
      });
      assert.equal(r.statut, 409);
      assert.equal(r.corps.code, E.DEJA_INITIALISE);
    });

    it('le gérant se connecte depuis le poste principal', async () => {
      const r = await requete(srv, 'POST', '/auth/connexion', {
        appareil: postePrincipal,
        corps: { identifiant: 'GERANT', motDePasse: GERANT.motDePasse },
      });
      assert.equal(r.statut, 200, JSON.stringify(r.corps));
      assert.equal(r.corps.utilisateur.doitChangerMotDePasse, false);
      assert.ok(r.corps.utilisateur.permissions.includes('admin.appareils'));
      jetonGerant = r.corps.jeton;
      const moi = await requete(srv, 'GET', '/auth/moi', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(moi.statut, 200);
      assert.equal(moi.corps.identifiant, 'gerant');
    });
  });

  describe('Réenregistrement du poste principal (clé perdue)', () => {
    it('refuse un mauvais mot de passe', async () => {
      const id = await nouvelleIdentite();
      const r = await requete(srv, 'POST', '/initialisation/poste-principal', {
        corps: { identifiant: 'gerant', motDePasse: 'mauvais', appareil: { nom: 'Poste principal', csrPem: id.csrPem } },
      });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.IDENTIFIANTS_INCORRECTS);
    });

    it('avec les identifiants du gérant, le poste principal reçoit une nouvelle clé', async () => {
      const id = await nouvelleIdentite();
      const r = await requete(srv, 'POST', '/initialisation/poste-principal', {
        corps: { identifiant: 'gerant', motDePasse: GERANT.motDePasse, appareil: { nom: 'Poste principal (réinstallé)', csrPem: id.csrPem } },
      });
      assert.equal(r.statut, 200, JSON.stringify(r.corps));
      id.certificatPem = r.corps.certificatPem;
      const c = await requete(srv, 'POST', '/auth/connexion', {
        appareil: id,
        corps: { identifiant: 'gerant', motDePasse: GERANT.motDePasse },
      });
      assert.equal(c.statut, 200);
      // On révoque cette identité de test pour ne pas fausser la suite.
      const liste = await requete(srv, 'GET', '/appareils', { appareil: postePrincipal, jeton: jetonGerant });
      const reinst = liste.corps.find((a: { nom: string }) => a.nom === 'Poste principal (réinstallé)');
      const rev = await requete(srv, 'POST', `/appareils/${reinst.id}/revoquer`, { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(rev.statut, 200);
    });
  });

  describe('Enregistrement d’un nouvel appareil par clé chiffrée', () => {
    let code = '';

    it('le gérant crée l’appareil et obtient un code à usage unique', async () => {
      const r = await requete(srv, 'POST', '/appareils', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { nom: 'PC magasin' },
      });
      assert.equal(r.statut, 201, JSON.stringify(r.corps));
      assert.match(r.corps.codeActivation, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.equal(r.corps.appareil.statut, 'en_attente');
      assert.equal(r.corps.appareil.secretCode, undefined);
      code = r.corps.codeActivation;
    });

    it('le secret du code ne transite jamais : une mauvaise preuve est refusée', async () => {
      Object.assign(pcMagasin, await nouvelleIdentite());
      const { idCode } = preuveEnrolement(code, pcMagasin.csrPem);
      const r = await requete(srv, 'POST', '/enrolement', {
        corps: { idCode, csrPem: pcMagasin.csrPem, preuve: 'a'.repeat(64) },
      });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.CODE_ACTIVATION_INVALIDE);
    });

    it('avec le bon code, l’appareil reçoit son certificat et vérifie la preuve du serveur', async () => {
      const { idCode, preuve, secret } = preuveEnrolement(code, pcMagasin.csrPem);
      const r = await requete(srv, 'POST', '/enrolement', {
        corps: { idCode, csrPem: pcMagasin.csrPem, preuve, infosSysteme: { nomMachine: 'MAGASIN-01' } },
      });
      assert.equal(r.statut, 200, JSON.stringify(r.corps));
      assert.ok(verifierPreuveServeur(secret, r.corps.certificatPem, r.corps.caPem, r.corps.preuveServeur));
      assert.ok(!verifierPreuveServeur('MAUVAIS1', r.corps.certificatPem, r.corps.caPem, r.corps.preuveServeur));
      pcMagasin.certificatPem = r.corps.certificatPem;
    });

    it('le code ne peut pas être réutilisé', async () => {
      const autre = await nouvelleIdentite();
      const { idCode, preuve } = preuveEnrolement(code, autre.csrPem);
      const r = await requete(srv, 'POST', '/enrolement', { corps: { idCode, csrPem: autre.csrPem, preuve } });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.CODE_ACTIVATION_INVALIDE);
    });

    it('le nouvel appareil permet la connexion', async () => {
      const r = await requete(srv, 'POST', '/auth/connexion', {
        appareil: pcMagasin,
        corps: { identifiant: GERANT.identifiant, motDePasse: GERANT.motDePasse },
      });
      assert.equal(r.statut, 200);
    });

    it('un jeton de session ne fonctionne que sur l’appareil qui l’a obtenu', async () => {
      const r = await requete(srv, 'GET', '/auth/moi', { appareil: pcMagasin, jeton: jetonGerant });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.SESSION_EXPIREE);
    });

    it('un certificat d’appareil inconnu (autre autorité) est refusé', async () => {
      const intrus = await nouvelleIdentite();
      // Certificat auto-signé : le serveur ne le reconnaît pas.
      const x509 = await import('@peculiar/x509');
      const crypto = await import('node:crypto');
      const cles = (await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      const cert = await x509.X509CertificateGenerator.createSelfSigned({
        name: 'CN=intrus',
        keys: cles,
        signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      });
      const der = Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', cles.privateKey));
      intrus.clePem = crypto
        .createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
      intrus.certificatPem = cert.toString('pem');
      const r = await requete(srv, 'POST', '/auth/connexion', {
        appareil: intrus,
        corps: { identifiant: GERANT.identifiant, motDePasse: GERANT.motDePasse },
      });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.APPAREIL_NON_RECONNU);
    });

    it('le renouvellement n’est accordé qu’à l’approche de l’expiration', async () => {
      const r = await requete(srv, 'POST', '/appareils/moi/renouveler', {
        appareil: pcMagasin,
        corps: { csrPem: (await nouvelleIdentite()).csrPem },
      });
      assert.equal(r.statut, 400);
      assert.equal(r.corps.code, 'RENOUVELLEMENT_PREMATURE');
    });

    it('le gérant ne peut pas révoquer l’appareil qu’il utilise', async () => {
      const liste = await requete(srv, 'GET', '/appareils', { appareil: postePrincipal, jeton: jetonGerant });
      const principal = liste.corps.find((a: { nom: string }) => a.nom === 'Poste principal');
      const r = await requete(srv, 'POST', `/appareils/${principal.id}/revoquer`, {
        appareil: postePrincipal,
        jeton: jetonGerant,
      });
      assert.equal(r.statut, 400);
      assert.equal(r.corps.code, 'REVOCATION_APPAREIL_COURANT');
    });

    it('la révocation a un effet immédiat', async () => {
      const connexion = await requete(srv, 'POST', '/auth/connexion', {
        appareil: pcMagasin,
        corps: { identifiant: GERANT.identifiant, motDePasse: GERANT.motDePasse },
      });
      const liste = await requete(srv, 'GET', '/appareils', { appareil: postePrincipal, jeton: jetonGerant });
      const magasin = liste.corps.find((a: { nom: string }) => a.nom === 'PC magasin');
      const rev = await requete(srv, 'POST', `/appareils/${magasin.id}/revoquer`, {
        appareil: postePrincipal,
        jeton: jetonGerant,
      });
      assert.equal(rev.statut, 200);
      assert.equal(rev.corps.statut, 'revoque');

      const apres = await requete(srv, 'GET', '/auth/moi', { appareil: pcMagasin, jeton: connexion.corps.jeton });
      assert.equal(apres.statut, 401);
      assert.equal(apres.corps.code, E.APPAREIL_REVOQUE);
      const [session] = await sql<{ fermee_le: Date | null }>(
        'SELECT fermee_le FROM sessions WHERE appareil_id = $1 ORDER BY cree_le DESC LIMIT 1',
        [magasin.id],
      );
      assert.ok(session.fermee_le, 'la session de l’appareil révoqué est fermée');
    });

    it('la limite d’appareils est respectée', async () => {
      const p = await requete(srv, 'GET', '/parametres', { appareil: postePrincipal, jeton: jetonGerant });
      const maj = await requete(srv, 'PUT', '/parametres', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { ...p.corps, nbMaxAppareils: 2 },
      });
      assert.equal(maj.statut, 200, JSON.stringify(maj.corps));
      const premier = await requete(srv, 'POST', '/appareils', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { nom: 'Tablette' },
      });
      assert.equal(premier.statut, 201);
      const second = await requete(srv, 'POST', '/appareils', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { nom: 'Téléphone' },
      });
      assert.equal(second.statut, 409);
      assert.equal(second.corps.code, E.LIMITE_APPAREILS);
    });
  });

  describe('Comptes utilisateurs et rôles', () => {
    let jetonCaissier = '';

    it('le gérant crée un caissier, qui doit changer son mot de passe', async () => {
      const r = await requete(srv, 'POST', '/utilisateurs', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: {
          identifiant: 'awa',
          nomComplet: 'Awa Caisse',
          motDePasseInitial: 'Initial#2026',
          roles: ['caissier'],
        },
      });
      assert.equal(r.statut, 201, JSON.stringify(r.corps));
      assert.equal(r.corps.hashMotDePasse, undefined);

      const c = await requete(srv, 'POST', '/auth/connexion', {
        appareil: postePrincipal,
        corps: { identifiant: 'awa', motDePasse: 'Initial#2026' },
      });
      assert.equal(c.statut, 200);
      assert.equal(c.corps.utilisateur.doitChangerMotDePasse, true);
      jetonCaissier = c.corps.jeton;

      const bloque = await requete(srv, 'GET', '/parametres', { appareil: postePrincipal, jeton: jetonCaissier });
      assert.equal(bloque.statut, 403);
      assert.equal(bloque.corps.code, E.CHANGEMENT_MOT_DE_PASSE_REQUIS);

      const change = await requete(srv, 'POST', '/auth/mot-de-passe', {
        appareil: postePrincipal,
        jeton: jetonCaissier,
        corps: { ancienMotDePasse: 'Initial#2026', nouveauMotDePasse: 'AwaCaisse#1' },
      });
      assert.equal(change.statut, 200);
      const ok = await requete(srv, 'GET', '/parametres', { appareil: postePrincipal, jeton: jetonCaissier });
      assert.equal(ok.statut, 200);
    });

    it('les permissions du rôle sont appliquées', async () => {
      const r = await requete(srv, 'GET', '/appareils', { appareil: postePrincipal, jeton: jetonCaissier });
      assert.equal(r.statut, 403);
      assert.equal(r.corps.code, E.PERMISSION_REFUSEE);
      const audit = await requete(srv, 'GET', '/audit', { appareil: postePrincipal, jeton: jetonCaissier });
      assert.equal(audit.statut, 403);
    });

    it('le compte est bloqué 15 minutes après 5 mots de passe faux', async () => {
      for (let i = 0; i < 5; i++) {
        const r = await requete(srv, 'POST', '/auth/connexion', {
          appareil: postePrincipal,
          corps: { identifiant: 'awa', motDePasse: 'faux-mot-de-passe' },
        });
        assert.equal(r.statut, 401);
      }
      const bon = await requete(srv, 'POST', '/auth/connexion', {
        appareil: postePrincipal,
        corps: { identifiant: 'awa', motDePasse: 'AwaCaisse#1' },
      });
      assert.equal(bon.statut, 401);
      assert.equal(bon.corps.code, E.COMPTE_BLOQUE);
    });

    it('un identifiant inconnu donne le même message qu’un mauvais mot de passe', async () => {
      const r = await requete(srv, 'POST', '/auth/connexion', {
        appareil: postePrincipal,
        corps: { identifiant: 'inconnu', motDePasse: 'peu-importe' },
      });
      assert.equal(r.statut, 401);
      assert.equal(r.corps.code, E.IDENTIFIANTS_INCORRECTS);
    });

    it('la session se verrouille après 15 minutes d’inactivité et se déverrouille avec le mot de passe', async () => {
      await sql(
        "UPDATE sessions SET derniere_activite = now() - interval '16 minutes' WHERE fermee_le IS NULL AND utilisateur_id = (SELECT id FROM utilisateurs WHERE identifiant = 'gerant')",
      );
      const verrou = await requete(srv, 'GET', '/auth/moi', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(verrou.statut, 401);
      assert.equal(verrou.corps.code, E.SESSION_VERROUILLEE);
      const faux = await requete(srv, 'POST', '/auth/deverrouiller', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { motDePasse: 'mauvais' },
      });
      assert.equal(faux.statut, 401);
      const ok = await requete(srv, 'POST', '/auth/deverrouiller', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { motDePasse: GERANT.motDePasse },
      });
      assert.equal(ok.statut, 200);
      const moi = await requete(srv, 'GET', '/auth/moi', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(moi.statut, 200);
    });

    it('le verrouillage manuel est appliqué par le serveur', async () => {
      const v = await requete(srv, 'POST', '/auth/verrouiller', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(v.statut, 200);
      const bloque = await requete(srv, 'GET', '/parametres', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(bloque.corps.code, E.SESSION_VERROUILLEE);
      const ok = await requete(srv, 'POST', '/auth/deverrouiller', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { motDePasse: GERANT.motDePasse },
      });
      assert.equal(ok.statut, 200);
    });

    it('le gérant ne peut pas se désactiver ni retirer le dernier droit d’administration', async () => {
      const liste = await requete(srv, 'GET', '/utilisateurs', { appareil: postePrincipal, jeton: jetonGerant });
      const gerant = liste.corps.find((u: { identifiant: string }) => u.identifiant === 'gerant');
      const auto = await requete(srv, 'PATCH', `/utilisateurs/${gerant.id}`, {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { actif: false },
      });
      assert.equal(auto.statut, 400);

      const roles = await requete(srv, 'GET', '/roles', { appareil: postePrincipal, jeton: jetonGerant });
      const roleGerant = roles.corps.find((r: { code: string }) => r.code === 'gerant');
      const r = await requete(srv, 'PUT', `/roles/${roleGerant.id}/permissions`, {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { permissions: ['rapports.tous'] },
      });
      assert.equal(r.statut, 400);
      assert.equal(r.corps.code, 'DERNIER_ADMINISTRATEUR');
    });

    it('désactiver un compte ferme ses sessions', async () => {
      const liste = await requete(srv, 'GET', '/utilisateurs', { appareil: postePrincipal, jeton: jetonGerant });
      const awa = liste.corps.find((u: { identifiant: string }) => u.identifiant === 'awa');
      const r = await requete(srv, 'PATCH', `/utilisateurs/${awa.id}`, {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { actif: false },
      });
      assert.equal(r.statut, 200);
      const apres = await requete(srv, 'GET', '/auth/moi', { appareil: postePrincipal, jeton: jetonCaissier });
      assert.equal(apres.statut, 401);
    });
  });

  describe('Modules et paramètres', () => {
    it('un module ne peut pas être activé sans ses dépendances', async () => {
      const p = await requete(srv, 'GET', '/parametres', { appareil: postePrincipal, jeton: jetonGerant });
      const r = await requete(srv, 'PUT', '/parametres', {
        appareil: postePrincipal,
        jeton: jetonGerant,
        corps: { ...p.corps, modulesActifs: ['credit_client'] },
      });
      assert.equal(r.statut, 400);
      assert.equal(r.corps.code, 'DEPENDANCE_MODULE');
    });
  });

  describe('Journal d’audit', () => {
    it('ne contient aucun secret', async () => {
      const lignes = await sql<{ contenu: string }>(
        "SELECT coalesce(avant::text,'') || coalesce(apres::text,'') || coalesce(details::text,'') AS contenu FROM journal_audit",
      );
      const tout = lignes.map((l) => l.contenu).join('\n');
      assert.ok(!tout.includes(GERANT.motDePasse));
      assert.ok(!tout.includes('Initial#2026'));
      assert.ok(!/\$argon2/.test(tout));
    });

    it('la chaîne est valide', async () => {
      const r = await requete(srv, 'GET', '/audit/verification', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(r.statut, 200);
      assert.equal(r.corps.valide, true);
      assert.ok(r.corps.nbEntrees > 10);
    });

    it('refuse toute modification ou suppression, même en SQL direct', async () => {
      await assert.rejects(sql("UPDATE journal_audit SET action = 'falsifie'"), /ne peut être ni modifié/);
      await assert.rejects(sql('DELETE FROM journal_audit'), /ne peut être ni modifié/);
    });

    it('détecte une entrée insérée frauduleusement', async () => {
      await sql(
        "INSERT INTO journal_audit (horodatage, action, hash_precedent, hash) SELECT now(), 'faux', hash, repeat('f', 64) FROM journal_audit ORDER BY id DESC LIMIT 1",
      );
      const r = await requete(srv, 'GET', '/audit/verification', { appareil: postePrincipal, jeton: jetonGerant });
      assert.equal(r.corps.valide, false);
      assert.ok(r.corps.premiereRuptureId);
    });
  });
});
