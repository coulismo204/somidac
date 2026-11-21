import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aSupprimer,
  changerMotDePasseRestauration,
  chiffrerSauvegarde,
  creerClesSauvegarde,
  deballer,
  dechiffrerClePrivee,
  dechiffrerSauvegarde,
  empaqueter,
} from '../src/noyau/sauvegardes/format';

describe('Format des sauvegardes chiffrées', () => {
  const MDP = 'Restauration#2026';
  const cles = creerClesSauvegarde(MDP);
  const contenu = empaqueter(
    [
      { nom: 'base.dump', donnees: Buffer.from('DONNEES-SECRETES-DE-LA-BASE') },
      { nom: 'pki/autorite.cert.pem', donnees: Buffer.from('CERT') },
    ],
    'abc',
  );
  const fichier = chiffrerSauvegarde(contenu, cles.clePublique, { entreprise: 'SOMIDAC SARL', versionApplication: 'test' });

  it('le contenu n’apparaît pas en clair dans le fichier', () => {
    assert.ok(!fichier.includes(Buffer.from('DONNEES-SECRETES')));
  });

  it('se relit avec le mot de passe de restauration', () => {
    const cle = dechiffrerClePrivee(cles.clePriveeChiffree, MDP);
    const { entete, contenu: clair } = dechiffrerSauvegarde(fichier, cle);
    assert.equal(entete.entreprise, 'SOMIDAC SARL');
    const { manifeste, fichiers } = deballer(clair);
    assert.equal(manifeste.derniereMigration, 'abc');
    assert.equal(fichiers.get('base.dump')!.toString(), 'DONNEES-SECRETES-DE-LA-BASE');
  });

  it('refuse un mauvais mot de passe', () => {
    assert.throws(() => dechiffrerClePrivee(cles.clePriveeChiffree, 'mauvais'), { code: 'MOT_DE_PASSE_RESTAURATION_INCORRECT' });
  });

  it('détecte un octet modifié dans le contenu', () => {
    const altere = Buffer.from(fichier);
    altere[altere.length - 5] ^= 0xff;
    const cle = dechiffrerClePrivee(cles.clePriveeChiffree, MDP);
    assert.throws(() => dechiffrerSauvegarde(altere, cle), { code: 'SAUVEGARDE_ALTEREE' });
  });

  it('détecte un en-tête modifié (nom de l’entreprise)', () => {
    const texte = fichier.toString('latin1').replace('SOMIDAC SARL', 'AUTRE  SARL!');
    const cle = dechiffrerClePrivee(cles.clePriveeChiffree, MDP);
    assert.throws(() => dechiffrerSauvegarde(Buffer.from(texte, 'latin1'), cle), { code: 'SAUVEGARDE_ALTEREE' });
  });

  it('après changement de mot de passe, les anciennes sauvegardes restent lisibles', () => {
    const nouvelle = changerMotDePasseRestauration(cles.clePriveeChiffree, MDP, 'Nouveau#Mot2026');
    assert.throws(() => dechiffrerClePrivee(nouvelle, MDP));
    const { contenu: clair } = dechiffrerSauvegarde(fichier, dechiffrerClePrivee(nouvelle, 'Nouveau#Mot2026'));
    assert.equal(deballer(clair).fichiers.get('pki/autorite.cert.pem')!.toString(), 'CERT');
  });

  it('conserve 30 sauvegardes quotidiennes et une par mois sur 12 mois', () => {
    const maintenant = new Date('2026-11-21T20:00:00Z');
    const dates: Date[] = [];
    for (let j = 0; j < 400; j++) dates.push(new Date(maintenant.getTime() - j * 24 * 3600_000));
    dates.push(new Date('2026-11-21T08:00:00Z')); // deuxième sauvegarde du même jour
    const supprimees = new Set(aSupprimer(dates, maintenant).map((d) => d.getTime()));
    const gardees = dates.filter((d) => !supprimees.has(d.getTime()));
    // 30 jours + les mois plus anciens (11 mois avant celui des 30 derniers jours, au plus).
    assert.ok(gardees.length >= 30 && gardees.length <= 42, `gardées : ${gardees.length}`);
    assert.ok(supprimees.has(new Date('2026-11-21T08:00:00Z').getTime()), 'une seule sauvegarde gardée par jour');
    assert.ok(gardees.every((d) => d >= new Date('2025-12-01T00:00:00Z')), 'rien de plus de 12 mois');
  });
});
