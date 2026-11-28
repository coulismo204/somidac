import { Module } from '@nestjs/common';
import { SauvegardesModule } from '../../noyau/sauvegardes/sauvegardes.module';
import { CloturesService } from './clotures.service';
import { DepensesService } from './depenses.service';
import { PaiementsService } from './paiements.service';
import { PiecesJointesService } from './pieces-jointes.service';
import {
  CategoriesDepensesController,
  CloturesController,
  DepensesController,
  PaiementsController,
  PiecesJointesController,
  TresorerieController,
} from './tresorerie.controller';
import { TresorerieService } from './tresorerie.service';

/**
 * Module métier « Trésorerie » (§5.6) : comptes, encaissements, paiements fournisseurs, dépenses,
 * transferts, clôture de caisse. TresorerieService est le seul à modifier les soldes.
 */
@Module({
  imports: [SauvegardesModule],
  providers: [TresorerieService, PaiementsService, DepensesService, CloturesService, PiecesJointesService],
  controllers: [TresorerieController, PaiementsController, DepensesController, CategoriesDepensesController, CloturesController, PiecesJointesController],
  exports: [TresorerieService, PaiementsService],
})
export class TresorerieModule {}
