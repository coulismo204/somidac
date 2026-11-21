import { Logger } from '@nestjs/common';
import { creerApplication } from './application';
import { chargerConfiguration } from './config/configuration';

async function demarrer() {
  const config = chargerConfiguration();
  const { app } = await creerApplication(config);
  await app.listen(config.port, config.hoteEcoute);
  new Logger('SOMIDAC').log(`Serveur SOMIDAC démarré sur https://${config.hoteEcoute}:${config.port}/api/v1`);
}

demarrer().catch((erreur) => {
  // eslint-disable-next-line no-console
  console.error('Échec du démarrage du serveur SOMIDAC :', erreur);
  process.exit(1);
});
