import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Coffre à secrets du serveur (mot de passe de la clé d'autorité, mot de passe de la base).
 * - Windows (service installé) : chiffrement DPAPI lié au compte du service (§10.4).
 * - Développement : fichier protégé par les droits du système de fichiers.
 */
export interface Coffre {
  lire(nom: string): string | undefined;
  ecrire(nom: string, valeur: string): void;
}

function ecrirePrive(fichier: string, contenu: string) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
  const temporaire = `${fichier}.tmp`;
  fs.writeFileSync(temporaire, contenu, { mode: 0o600 });
  fs.renameSync(temporaire, fichier);
}

/** Secrets dans un fichier JSON (développement, tests). */
export class CoffreFichier implements Coffre {
  constructor(private readonly dossier: string) {}

  private get fichier() {
    return path.join(this.dossier, 'secrets.json');
  }

  private tout(): Record<string, string> {
    return fs.existsSync(this.fichier) ? (JSON.parse(fs.readFileSync(this.fichier, 'utf8')) as Record<string, string>) : {};
  }

  lire(nom: string) {
    return this.tout()[nom];
  }

  ecrire(nom: string, valeur: string) {
    ecrirePrive(this.fichier, JSON.stringify({ ...this.tout(), [nom]: valeur }, null, 2));
  }
}

const ENTROPIE = 'U09NSURBQy1zZXJ2ZXVy'; // « SOMIDAC-serveur » en base64

function dpapi(operation: 'Protect' | 'Unprotect', entreeBase64: string): string {
  // Le secret passe par l'entrée standard, jamais par la ligne de commande (visible des autres processus).
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$e = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `$x = [Convert]::FromBase64String('${ENTROPIE}')`,
    `$r = [System.Security.Cryptography.ProtectedData]::${operation}($e, $x, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($r))',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input: entreeBase64,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error(`Chiffrement Windows (DPAPI) indisponible : ${r.stderr || r.error?.message || 'erreur inconnue'}`);
  }
  return r.stdout.trim();
}

/** Secrets chiffrés par Windows DPAPI : lisibles uniquement par le compte du service SOMIDAC, sur ce PC. */
export class CoffreDpapi implements Coffre {
  constructor(private readonly dossier: string) {}

  private fichier(nom: string) {
    return path.join(this.dossier, `${nom}.dpapi`);
  }

  lire(nom: string) {
    const f = this.fichier(nom);
    if (!fs.existsSync(f)) return undefined;
    return Buffer.from(dpapi('Unprotect', fs.readFileSync(f, 'utf8')), 'base64').toString('utf8');
  }

  ecrire(nom: string, valeur: string) {
    ecrirePrive(this.fichier(nom), dpapi('Protect', Buffer.from(valeur, 'utf8').toString('base64')));
  }
}
