import 'reflect-metadata';
import { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Configuration } from './config/configuration';
import { Coffre, CoffreFichier } from './noyau/pki/coffre';
import { NomsServeur, Pki } from './noyau/pki/pki';

/** Crée l'application HTTPS avec authentification mutuelle des appareils (TLS mutuel, §10.1). */
export async function creerApplication(
  config: Configuration,
  options: { nomsServeur?: NomsServeur; journaux?: boolean; coffre?: Coffre } = {},
): Promise<{ app: INestApplication; pki: Pki }> {
  const coffre = options.coffre ?? new CoffreFichier(config.dataDir);
  const pki = await Pki.charger(config.dataDir, options.nomsServeur, coffre);
  const app = await NestFactory.create(AppModule.avec(config, pki, coffre), {
    logger: options.journaux === false ? false : ['log', 'warn', 'error'],
    httpsOptions: {
      key: pki.serveurClePem,
      cert: pki.serveurCertificatPem,
      ca: [pki.caPem],
      // Le certificat de l'appareil est demandé à chaque connexion ; la garde décide ensuite
      // (seul l'enregistrement d'un nouvel appareil est accessible sans certificat).
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    } as NestApplicationOptions['httpsOptions'],
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  // Pas d'en-tête révélant la technologie utilisée.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  return { app, pki };
}
