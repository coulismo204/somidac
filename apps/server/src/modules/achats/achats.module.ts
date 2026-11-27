import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { AchatsController, FournisseursController } from './achats.controller';
import { AchatsService } from './achats.service';
import { FournisseursService } from './fournisseurs.service';

/** Module métier « Achats » (§5.3). */
@Module({ imports: [StockModule], providers: [AchatsService, FournisseursService], controllers: [AchatsController, FournisseursController] })
export class AchatsModule {}
