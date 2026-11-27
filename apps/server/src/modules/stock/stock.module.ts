import { Module } from '@nestjs/common';
import { InventairesController, StockController } from './stock.controller';
import { InventairesService } from './inventaires.service';
import { StockService } from './stock.service';

/** Module métier « Stock » (§5.4) : StockService est le seul à modifier les quantités. */
@Module({ providers: [StockService, InventairesService], controllers: [StockController, InventairesController], exports: [StockService] })
export class StockModule {}
