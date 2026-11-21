import { DynamicModule, Global, Module } from '@nestjs/common';
import { CONFIGURATION, Configuration } from './config/configuration';
import { NoyauModule } from './noyau/noyau.module';
import { Pki, PKI } from './noyau/pki/pki';

@Global()
@Module({})
class ConfigurationModule {
  static avec(config: Configuration, pki: Pki): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [
        { provide: CONFIGURATION, useValue: config },
        { provide: PKI, useValue: pki },
      ],
      exports: [CONFIGURATION, PKI],
    };
  }
}

/**
 * Application : le noyau + les modules métier.
 * Chaque module métier (produits, stock, achats, ventes, trésorerie, rapports) sera ajouté
 * dans `imports` au fil des lots, sans modifier le noyau.
 */
@Module({})
export class AppModule {
  static avec(config: Configuration, pki: Pki): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigurationModule.avec(config, pki), NoyauModule],
    };
  }
}
