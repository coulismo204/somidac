import { Module } from '@nestjs/common';
import { CategoriesController, MarquesController, ProduitsController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

/** Module métier « Produits » (§5.2). */
@Module({ providers: [CatalogueService], controllers: [ProduitsController, CategoriesController, MarquesController], exports: [CatalogueService] })
export class CatalogueModule {}
