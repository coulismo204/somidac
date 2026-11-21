import { configServiceParDefaut, demarrerService } from './service';

/** Point d'entrée exécuté par le service Windows « SOMIDAC Serveur ». */
demarrerService(configServiceParDefaut())
  .then(({ arreter }) => {
    const quitter = () => void arreter().finally(() => process.exit(0));
    // Windows envoie Ctrl+C (SIGINT) ou Ctrl+Break (SIGBREAK) à l'arrêt du service.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(signal, quitter);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Échec du démarrage du service SOMIDAC :', e);
    process.exit(1);
  });
