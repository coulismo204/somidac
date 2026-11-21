import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { creerApplication } from './application';
import { chargerConfiguration } from './config/configuration';

/**
 * Démarrage en développement. Les réglages viennent de apps/server/.env (copie de .env.example) ;
 * les variables déjà définies dans l'environnement restent prioritaires.
 * En production, c'est le service Windows (service/demarrage.ts) qui démarre le serveur.
 */
function chargerFichierEnv() {
  for (const fichier of [path.resolve(__dirname, '..', '.env'), path.resolve(process.cwd(), '.env')]) {
    if (fs.existsSync(fichier)) {
      process.loadEnvFile(fichier);
      return;
    }
  }
}

async function demarrer() {
  chargerFichierEnv();
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
