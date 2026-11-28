import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ImportService } from './import.service';
import { MiseEnServiceController } from './mise-en-service.controller';
import { MiseEnServiceService } from './mise-en-service.service';

/** Mise en service chez SOMIDAC (lot 6) : liste de contrôle et import du fichier Excel de départ. */
@Module({ imports: [StockModule], providers: [MiseEnServiceService, ImportService], controllers: [MiseEnServiceController] })
export class MiseEnServiceModule {}
