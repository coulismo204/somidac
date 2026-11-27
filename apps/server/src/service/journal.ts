import { ConsoleLogger, LogLevel } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TAILLE_MAX = 5 * 1024 * 1024;

/**
 * Journal du service écrit immédiatement sur le disque (écriture synchrone).
 * Sous Windows, la sortie standard d'un service passe par un tuyau asynchrone : un message écrit
 * juste avant un arrêt brutal peut se perdre. Ce fichier, lui, garde toujours la dernière erreur.
 */
export class JournalFichier extends ConsoleLogger {
  constructor(private readonly fichier: string) {
    super('SOMIDAC', { logLevels: ['log', 'warn', 'error', 'fatal'] });
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    this.tourner();
  }

  /** Garde l'ancien journal (.1) quand il devient trop gros. */
  private tourner() {
    try {
      if (fs.statSync(this.fichier).size > TAILLE_MAX) fs.renameSync(this.fichier, `${this.fichier}.1`);
    } catch {
      /* pas encore de journal */
    }
  }

  ecrire(niveau: string, message: unknown, contexte?: string) {
    const texte = message instanceof Error ? `${message.message}\n${message.stack ?? ''}` : String(message);
    const ligne = `${new Date().toISOString()} ${niveau.padEnd(6)} ${contexte ? `[${contexte}] ` : ''}${texte}\n`;
    try {
      fs.appendFileSync(this.fichier, ligne);
    } catch {
      /* le journal ne doit jamais faire tomber le service */
    }
  }

  protected override printMessages(messages: unknown[], context = '', logLevel: LogLevel = 'log') {
    for (const m of messages) this.ecrire(logLevel.toUpperCase(), m, context);
    super.printMessages(messages, context, logLevel);
  }
}
