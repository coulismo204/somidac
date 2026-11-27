import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { ClientsService } from './clients.service';
import { FacturesService } from './factures.service';
import { LivraisonsService } from './livraisons.service';
import { AvoirsController, ClientsController, FacturesController, LivraisonsController, VentesController } from './ventes.controller';

/** Module métier « Ventes » (§5.5) : clients, prix particuliers, bons de livraison, factures et avoirs. */
@Module({
  imports: [StockModule],
  providers: [ClientsService, LivraisonsService, FacturesService],
  controllers: [ClientsController, LivraisonsController, FacturesController, AvoirsController, VentesController],
})
export class VentesModule {}
