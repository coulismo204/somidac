import { configServiceParDefaut, demarrerService, journalDuService } from './service';

/** Point d'entrée exécuté par le service Windows « SOMIDAC Serveur ». */
const config = configServiceParDefaut();
const journal = journalDuService(config.racine);

/** Erreur fatale : écrite de façon synchrone dans le journal AVANT l'arrêt (sinon elle se perd sous Windows). */
function fatal(contexte: string, e: unknown): never {
  journal.ecrire('FATAL', e, contexte);
  process.exit(1);
}

process.on('uncaughtException', (e) => fatal('Erreur inattendue', e));
process.on('unhandledRejection', (e) => fatal('Erreur inattendue (promesse)', e));

demarrerService(config, journal)
  .then(({ arreter }) => {
    const quitter = () => void arreter().finally(() => process.exit(0));
    // Windows envoie Ctrl+C (SIGINT) ou Ctrl+Break (SIGBREAK) à l'arrêt du service.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, quitter);
  })
  .catch((e) => fatal('Échec du démarrage du service SOMIDAC', e));
