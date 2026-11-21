import * as fs from 'node:fs';
import * as path from 'node:path';

/** Retrouve le dossier `drizzle/` des migrations, que l'on tourne depuis src, dist ou l'application installée. */
export function trouverDossierMigrations(depart: string = __dirname): string {
  if (process.env.SOMIDAC_MIGRATIONS_DIR) return process.env.SOMIDAC_MIGRATIONS_DIR;
  let dossier = depart;
  for (let i = 0; i < 8; i++) {
    const candidat = path.join(dossier, 'drizzle');
    if (fs.existsSync(path.join(candidat, 'meta', '_journal.json'))) return candidat;
    const parent = path.dirname(dossier);
    if (parent === dossier) break;
    dossier = parent;
  }
  throw new Error('Dossier des migrations introuvable');
}
