// Exécute une commande en CI ; en cas d'échec, publie la fin de la sortie en annotation GitHub
// (lisible sans authentification, contrairement aux journaux complets).
// Usage : node scripts/ci.mjs "<titre>" <commande...>
import { spawn } from 'node:child_process';

const [titre, ...commande] = process.argv.slice(2);
const lignes = [];
const enfant = spawn(commande.join(' '), { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
const capter = (flux, sortie) =>
  flux.on('data', (d) => {
    sortie.write(d);
    lignes.push(...d.toString().split(/\r?\n/));
    if (lignes.length > 4000) lignes.splice(0, lignes.length - 4000);
  });
capter(enfant.stdout, process.stdout);
capter(enfant.stderr, process.stderr);
enfant.on('close', (code) => {
  if (code !== 0) {
    const nettoyer = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
    const utiles = lignes.map(nettoyer).filter((l) => l.trim());
    // Les lignes d'erreur d'abord (tests en échec, exceptions), puis la fin brute.
    const erreurs = utiles.filter((l) => /✖|error|erreur|Error|failed|ÉCHEC|not ok|assert/i.test(l)).slice(-40);
    const fin = utiles.slice(-40);
    const echapper = (t) => t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=${titre} (erreurs)::${echapper(erreurs.join('\n').slice(-6000))}`);
    console.log(`::error title=${titre} (fin)::${echapper(fin.join('\n').slice(-6000))}`);
  }
  process.exit(code ?? 1);
});
