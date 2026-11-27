import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  AjustementDto,
  ajustementSchema,
  ComptageInventaireDto,
  comptageInventaireSchema,
  ouvertureInventaireSchema,
  PERMISSIONS,
} from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { InventairesService } from './inventaires.service';
import { aujourdhui, StockService } from './stock.service';
import { typeMouvement } from '../../noyau/base/schema';

const TYPES_MOUVEMENT: string[] = typeMouvement.enumValues;

@Controller('stock')
@ModuleMetier('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  etat(@UtilisateurCourant() u: UtilisateurConnecte, @Query('recherche') recherche?: string, @Query('alertes') alertes?: string) {
    return this.stock.etat({ recherche, alertes: alertes === '1', voirCouts: u.permissions.has(PERMISSIONS.COUTS_VOIR) });
  }

  /** Entrées (sens=entree) ou sorties (sens=sortie) sur une période ; par défaut le mois en cours. */
  @Get('mouvements')
  journal(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Query('sens') sens?: string,
    @Query('du') du?: string,
    @Query('au') au?: string,
    @Query('recherche') recherche?: string,
    @Query('type') type?: string,
  ) {
    const jour = /^\d{4}-\d{2}-\d{2}$/;
    const aujourdhuiIso = aujourdhui();
    return this.stock.journal({
      sens: sens === 'sortie' ? 'sortie' : 'entree',
      du: du && jour.test(du) ? du : `${aujourdhuiIso.slice(0, 8)}01`,
      au: au && jour.test(au) ? au : aujourdhuiIso,
      recherche,
      type: type && TYPES_MOUVEMENT.includes(type) ? type : undefined,
      voirCouts: u.permissions.has(PERMISSIONS.COUTS_VOIR),
    });
  }

  @Get('a-ecouler')
  aEcouler() {
    return this.stock.lotsAEcouler();
  }

  @Get('produits/:id/mouvements')
  mouvements(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.stock.mouvements(id, u.permissions.has(PERMISSIONS.COUTS_VOIR));
  }

  @Post('ajustements')
  @Permissions(PERMISSIONS.STOCK_AJUSTER)
  ajuster(@Body(new ZodPipe(ajustementSchema)) dto: AjustementDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.stock.ajuster(dto, u.id, a.id);
  }
}

@Controller('inventaires')
@ModuleMetier('stock')
@Permissions(PERMISSIONS.STOCK_AJUSTER)
export class InventairesController {
  constructor(private readonly inventaires: InventairesService) {}

  @Get()
  lister() {
    return this.inventaires.lister();
  }

  @Post()
  ouvrir(@Body(new ZodPipe(ouvertureInventaireSchema)) dto: { libelle: string }, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.inventaires.ouvrir(dto.libelle, u.id, a.id);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventaires.detail(id);
  }

  @Put(':id/comptages')
  saisir(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(comptageInventaireSchema)) dto: ComptageInventaireDto) {
    return this.inventaires.saisir(id, dto);
  }

  @Post(':id/valider')
  @HttpCode(200)
  @Permissions(PERMISSIONS.STOCK_AJUSTER, PERMISSIONS.INVENTAIRE_VALIDER)
  valider(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.inventaires.valider(id, u.id, a.id);
  }

  @Post(':id/annuler')
  @HttpCode(200)
  @Permissions(PERMISSIONS.STOCK_AJUSTER, PERMISSIONS.INVENTAIRE_VALIDER)
  annuler(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.inventaires.annuler(id, u.id, a.id);
  }
}
