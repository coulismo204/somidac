import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AchatDto, achatSchema, FournisseurDto, fournisseurSchema, PERMISSIONS } from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { AchatsService } from './achats.service';
import { FournisseursService } from './fournisseurs.service';

@Controller('fournisseurs')
@ModuleMetier('achats')
@Permissions(PERMISSIONS.ACHATS_SAISIR)
export class FournisseursController {
  constructor(private readonly service: FournisseursService) {}

  @Get()
  lister() {
    return this.service.lister();
  }

  @Post()
  creer(@Body(new ZodPipe(fournisseurSchema)) dto: FournisseurDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrer(null, dto, u.id, a.id);
  }

  @Put(':id')
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(fournisseurSchema)) dto: FournisseurDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.enregistrer(id, dto, u.id, a.id);
  }
}

@Controller('achats')
@ModuleMetier('achats')
@Permissions(PERMISSIONS.ACHATS_SAISIR)
export class AchatsController {
  constructor(private readonly service: AchatsService) {}

  @Get()
  lister(@Query('statut') statut?: string) {
    return this.service.lister(statut);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post()
  creer(@Body(new ZodPipe(achatSchema)) dto: AchatDto, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.creer(dto, u.id);
  }

  @Put(':id')
  modifier(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(achatSchema)) dto: AchatDto) {
    return this.service.modifier(id, dto);
  }

  @Delete(':id')
  supprimer(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.supprimer(id);
  }

  @Post(':id/valider')
  @HttpCode(200)
  valider(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.valider(id, u.id, a.id);
  }
}
