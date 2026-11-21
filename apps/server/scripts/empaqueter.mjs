// Empaquette le serveur pour l'installation Windows : un seul fichier JavaScript,
// plus le binaire natif d'argon2 et les migrations. Aucun node_modules : electron-builder
// les écarte des ressources embarquées.
// Usage : node scripts/empaqueter.mjs <dossier-sortie>
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const serveur = path.resolve(ici, '..');
const racine = path.resolve(serveur, '../..');
const sortie = path.resolve(process.argv[2] ?? path.join(serveur, 'paquet'));

fs.rmSync(sortie, { recursive: true, force: true });
fs.mkdirSync(sortie, { recursive: true });

// Dépendances facultatives de NestJS, chargées seulement si présentes.
const optionnelles = [
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  '@nestjs/websockets',
  '@nestjs/websockets/socket-module',
  '@nestjs/platform-socket.io',
  'class-transformer',
  'class-transformer/storage',
  'class-validator',
  '@fastify/static',
  'pg-native',
  'cache-manager',
];

await build({
  // Sortie de tsc (conserve les métadonnées de décorateurs nécessaires à NestJS).
  entryPoints: [path.join(serveur, 'dist/service/demarrage.js')],
  outfile: path.join(sortie, 'service.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  keepNames: true,
  sourcemap: 'linked',
  external: optionnelles,
  logLevel: 'warning',
});

fs.cpSync(path.join(serveur, 'drizzle'), path.join(sortie, 'drizzle'), { recursive: true });

// Binaires précompilés d'argon2 (Windows, et Linux pour les tests), cherchés par node-gyp-build
// dans prebuilds/<plateforme>-<architecture>/ à côté de service.js.
const prebuilds = path.join(racine, 'node_modules', 'argon2', 'prebuilds');
for (const cible of ['win32-x64', 'linux-x64']) {
  fs.cpSync(path.join(prebuilds, cible), path.join(sortie, 'prebuilds', cible), { recursive: true });
}

const taille = fs.statSync(path.join(sortie, 'service.js')).size;
console.log(`Serveur empaqueté dans ${sortie} (service.js : ${(taille / 1024 / 1024).toFixed(1)} Mo)`);
