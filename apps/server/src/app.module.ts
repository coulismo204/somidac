import { DynamicModule, Global, Module } from '@nestjs/common';
import { CONFIGURATION, Configuration } from './config/configuration';
import { AchatsModule } from './modules/achats/achats.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { StockModule } from './modules/stock/stock.module';
import { TresorerieModule } from './modules/tresorerie/tresorerie.module';
import { VentesModule } from './modules/ventes/ventes.module';
import { NoyauModule } from './noyau/noyau.module';
import { Coffre, COFFRE } from './noyau/pki/coffre';
import { Pki, PKI } from './noyau/pki/pki';

@Global()
@Module({})
class ConfigurationModule {
  static avec(config: Configuration, pki: Pki, coffre: Coffre): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [
        { provide: CONFIGURATION, useValue: config },
        { provide: PKI, useValue: pki },
        { provide: COFFRE, useValue: coffre },
      ],
      exports: [CONFIGURATION, PKI, COFFRE],
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
  static avec(config: Configuration, pki: Pki, coffre: Coffre): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigurationModule.avec(config, pki, coffre), NoyauModule, CatalogueModule, StockModule, AchatsModule, VentesModule, TresorerieModule],
    };
  }
}
