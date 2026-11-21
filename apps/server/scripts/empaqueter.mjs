// Empaquette le serveur pour l'installation Windows : un seul fichier JavaScript,
// plus argon2 (module natif), les migrations, et rien d'autre.
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
  external: ['argon2', ...optionnelles],
  logLevel: 'warning',
});

fs.cpSync(path.join(serveur, 'drizzle'), path.join(sortie, 'drizzle'), { recursive: true });

// argon2 et ses deux dépendances, avec les binaires précompilés Windows (et Linux pour les tests).
const nm = path.join(racine, 'node_modules');
const copier = (paquet, filtre = () => true) =>
  fs.cpSync(path.join(nm, paquet), path.join(sortie, 'node_modules', paquet), {
    recursive: true,
    filter: (src) => filtre(path.relative(path.join(nm, paquet), src)),
  });
copier('argon2', (rel) => !rel.startsWith('prebuilds') || rel === 'prebuilds' || /^prebuilds[\\/](win32-x64|linux-x64)/.test(rel));
copier('@phc/format');
copier('node-gyp-build');

const taille = fs.statSync(path.join(sortie, 'service.js')).size;
console.log(`Serveur empaqueté dans ${sortie} (service.js : ${(taille / 1024 / 1024).toFixed(1)} Mo)`);
