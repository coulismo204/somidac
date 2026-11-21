// Lance l'application en développement, quel que soit le dossier ou le terminal :
//   npm run dev:desktop   (depuis la racine du projet)
// - retire ELECTRON_RUN_AS_NODE (exporté par VS Code, qui ferait tourner Electron comme Node) ;
// - sous Linux sans trousseau de clés : stockage de développement (--password-store=basic) ;
// - sous Linux, si le bac à sable de Chromium n'est pas configuré : explique comment le faire
//   et, en attendant, lance sans bac à sable (développement uniquement).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const optionsVite = [];
const optionsElectron = [];

if (process.platform === 'linux') {
  optionsElectron.push('--password-store=basic');
  const sandbox = path.join(path.dirname(require('electron')), 'chrome-sandbox');
  let configure = false;
  try {
    const s = fs.statSync(sandbox);
    configure = s.uid === 0 && (s.mode & 0o4000) !== 0;
  } catch {
    configure = false;
  }
  if (!configure) {
    console.warn(
      [
        '',
        "⚠  Bac à sable de Chromium non configuré : l'application est lancée SANS bac à sable (développement uniquement).",
        '   Pour le réactiver (une seule fois, à refaire après réinstallation d’Electron) :',
        `   sudo chown root:root "${sandbox}" && sudo chmod 4755 "${sandbox}"`,
        '',
      ].join('\n'),
    );
    optionsVite.push('--noSandbox');
  }
}

const cli = path.join(path.dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
const args = [cli, 'dev', ...optionsVite, ...process.argv.slice(2), '--', ...optionsElectron];
const enfant = spawn(process.execPath, args, { cwd: dossier, env, stdio: 'inherit' });
enfant.on('exit', (code) => process.exit(code ?? 0));
