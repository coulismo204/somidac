// Prépare les composants Windows embarqués dans l'installateur du poste principal :
//   <sortie>/postgresql  binaires PostgreSQL (sans pgAdmin, documentation ni fichiers de développement)
//   <sortie>/service     gestionnaire de service WinSW + sa configuration
//   <sortie>/vcredist    bibliothèques Visual C++ de Microsoft, nécessaires à PostgreSQL et souvent
//                        absentes d'un Windows de bureau (installées par l'installateur du poste principal)
// Usage : node scripts/preparer-windows.mjs apps/desktop/ressources-windows
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PG = process.env.PG_VERSION ?? '18.6-1';
const VERSION_WINSW = process.env.WINSW_VERSION ?? 'v2.12.0';
// Empreintes attendues : un fichier modifié en route (ou une autre version) est refusé.
const EMPREINTES = {
  'postgresql-18.6-1': 'fbe23da234ee31547bf8a36d29dfd81e82b849df2d2b78d2eecb43d360252f8c',
  'winsw-v2.12.0': '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da',
  'vcredist-x64': 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b',
};
const sortie = path.resolve(process.argv[2] ?? 'apps/desktop/ressources-windows');
const cache = path.resolve('.cache/windows');
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

fs.mkdirSync(cache, { recursive: true });

async function telecharger(url, fichier) {
  if (fs.existsSync(fichier)) return fichier;
  console.log(`Téléchargement de ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Échec du téléchargement (${r.status}) : ${url}`);
  const temporaire = `${fichier}.partiel`;
  fs.writeFileSync(temporaire, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(temporaire, fichier);
  return fichier;
}

function verifier(fichier, cle, surcharge) {
  const obtenue = crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex');
  const attendue = surcharge ?? EMPREINTES[cle];
  if (!attendue) throw new Error(`Aucune empreinte connue pour ${cle} : définir l'empreinte attendue`);
  if (obtenue !== attendue) {
    fs.rmSync(fichier, { force: true });
    throw new Error(`Empreinte invalide pour ${cle} : ${obtenue} (attendue ${attendue})`);
  }
  console.log(`${cle} vérifié (SHA-256 ${obtenue})`);
}

// --- PostgreSQL ---
const zip = await telecharger(
  `https://get.enterprisedb.com/postgresql/postgresql-${VERSION_PG}-windows-x64-binaries.zip`,
  path.join(cache, `postgresql-${VERSION_PG}.zip`),
);
verifier(zip, `postgresql-${VERSION_PG}`, process.env.PG_SHA256);
const extrait = path.join(cache, `postgresql-${VERSION_PG}`);
if (!fs.existsSync(path.join(extrait, 'pgsql', 'bin'))) {
  fs.mkdirSync(extrait, { recursive: true });
  // tar (bsdtar) sait ouvrir les .zip sous Windows 10+ ; unzip sous Linux.
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', extrait], { stdio: 'inherit' });
  else execFileSync('unzip', ['-q', zip, '-d', extrait], { stdio: 'inherit' });
}
const pgCible = path.join(sortie, 'postgresql');
fs.rmSync(pgCible, { recursive: true, force: true });
for (const dossier of ['bin', 'lib', 'share']) {
  fs.cpSync(path.join(extrait, 'pgsql', dossier), path.join(pgCible, dossier), {
    recursive: true,
    // Fichiers inutiles à l'exécution : bibliothèques de développement et symboles de débogage.
    filter: (src) => !/\.(lib|pdb|a)$/i.test(src),
  });
}
for (const f of ['LICENSE', 'COPYRIGHT']) {
  const src = path.join(extrait, 'pgsql', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(pgCible, f));
}
for (const exe of ['initdb.exe', 'pg_ctl.exe', 'postgres.exe', 'psql.exe', 'createdb.exe', 'pg_dump.exe', 'pg_restore.exe']) {
  if (!fs.existsSync(path.join(pgCible, 'bin', exe))) throw new Error(`Composant PostgreSQL manquant : ${exe}`);
}

// --- Service Windows (WinSW) ---
const winsw = await telecharger(
  `https://github.com/winsw/winsw/releases/download/${VERSION_WINSW}/WinSW-x64.exe`,
  path.join(cache, `WinSW-x64-${VERSION_WINSW}.exe`),
);
verifier(winsw, `winsw-${VERSION_WINSW}`, process.env.WINSW_SHA256);
const serviceCible = path.join(sortie, 'service');
fs.rmSync(serviceCible, { recursive: true, force: true });
fs.mkdirSync(serviceCible, { recursive: true });
fs.copyFileSync(winsw, path.join(serviceCible, 'SOMIDAC-Serveur.exe'));
fs.copyFileSync(
  path.join(racine, 'apps/desktop/installateur/SOMIDAC-Serveur.xml'),
  path.join(serviceCible, 'SOMIDAC-Serveur.xml'),
);

// --- Visual C++ (Microsoft) ---
// Adresse figée d'une version précise (l'empreinte fait partie de l'adresse) : vérifiée ci-dessous.
const vcredist = await telecharger(
  process.env.VCREDIST_URL ??
    'https://download.visualstudio.microsoft.com/download/pr/e9604e21-4b79-4096-a4b3-1b63d4b55b4d/CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe',
  path.join(cache, 'VC_redist.x64.exe'),
);
verifier(vcredist, 'vcredist-x64', process.env.VCREDIST_SHA256);
const vcCible = path.join(sortie, 'vcredist');
fs.rmSync(vcCible, { recursive: true, force: true });
fs.mkdirSync(vcCible, { recursive: true });
fs.copyFileSync(vcredist, path.join(vcCible, 'VC_redist.x64.exe'));

const taille = (dossier) => {
  let total = 0;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size;
  }
  return `${(total / 1024 / 1024).toFixed(0)} Mo`;
};
console.log(`Composants Windows prêts dans ${sortie} (PostgreSQL : ${taille(pgCible)})`);
