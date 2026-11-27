import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CategorieDto, categorieSchema, MarqueDto, marqueSchema, PERMISSIONS, ProduitDto, produitSchema } from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { CatalogueService } from './catalogue.service';

const voirCouts = (u: UtilisateurConnecte) => u.permissions.has(PERMISSIONS.COUTS_VOIR);

@Controller('produits')
@ModuleMetier('produits')
export class ProduitsController {
  constructor(private readonly service: CatalogueService) {}

  @Get()
  lister(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Query('recherche') recherche?: string,
    @Query('categorieId') categorieId?: string,
    @Query('inactifs') inactifs?: string,
  ) {
    return this.service.lister({ recherche, categorieId, inclureInactifs: inactifs === '1', voirCouts: voirCouts(u) });
  }

  @Get('code-barres/:code')
  parCodeBarres(@Param('code') code: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.parCodeBarres(code, voirCouts(u));
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.detail(id, voirCouts(u));
  }

  @Post()
  @Permissions(PERMISSIONS.PRODUITS_GERER)
  creer(@Body(new ZodPipe(produitSchema)) dto: ProduitDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.creer(dto, u, a.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.PRODUITS_GERER)
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(produitSchema)) dto: ProduitDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.modifier(id, dto, u, a.id);
  }
}

@Controller('categories')
@ModuleMetier('produits')
export class CategoriesController {
  constructor(private readonly service: CatalogueService) {}

  @Get()
  lister() {
    return this.service.listerCategories();
  }

  @Post()
  @Permissions(PERMISSIONS.PRODUITS_GERER)
  creer(@Body(new ZodPipe(categorieSchema)) dto: CategorieDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrerCategorie(null, dto, u, a.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.PRODUITS_GERER)
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(categorieSchema)) dto: CategorieDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.enregistrerCategorie(id, dto, u, a.id);
  }
}

@Controller('marques')
@ModuleMetier('produits')
export class MarquesController {
  constructor(private readonly service: CatalogueService) {}

  @Get()
  lister() {
    return this.service.listerMarques();
  }

  @Post()
  @Permissions(PERMISSIONS.PRODUITS_GERER)
  creer(@Body(new ZodPipe(marqueSchema)) dto: MarqueDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.creerMarque(dto, u, a.id);
  }
}
