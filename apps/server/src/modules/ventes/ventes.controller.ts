import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  AvoirDto,
  avoirSchema,
  ClientDto,
  clientSchema,
  LivraisonDto,
  livraisonSchema,
  PERMISSIONS,
  PrixClientDto,
  prixClientSchema,
  ReceptionDto,
  receptionSchema,
} from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { ClientsService } from './clients.service';
import { FacturesService } from './factures.service';
import { LivraisonsService } from './livraisons.service';

const voirCouts = (u: UtilisateurConnecte) => u.permissions.has(PERMISSIONS.COUTS_VOIR);

@Controller('clients')
@ModuleMetier('ventes')
@Permissions(PERMISSIONS.VENTES_SAISIR)
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  lister(@Query('recherche') recherche?: string, @Query('inactifs') inactifs?: string) {
    return this.service.lister({ recherche, inclureInactifs: inactifs === '1' });
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }

  @Post()
  creer(@Body(new ZodPipe(clientSchema)) dto: ClientDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.enregistrer(null, dto, u, a.id);
  }

  @Put(':id')
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(clientSchema)) dto: ClientDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.enregistrer(id, dto, u, a.id);
  }

  /** Prix particuliers (R3) : réservé à qui peut modifier les prix de vente. */
  @Put(':id/prix')
  @Permissions(PERMISSIONS.VENTES_SAISIR, PERMISSIONS.PRIX_MODIFIER)
  definirPrix(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(prixClientSchema)) dto: PrixClientDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.definirPrix(id, dto, u, a.id);
  }
}

@Controller('livraisons')
@ModuleMetier('ventes')
@Permissions(PERMISSIONS.VENTES_SAISIR)
export class LivraisonsController {
  constructor(private readonly service: LivraisonsService) {}

  @Get()
  lister(@Query('statut') statut?: string) {
    return this.service.lister(statut);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.detail(id, voirCouts(u));
  }

  @Post()
  creer(@Body(new ZodPipe(livraisonSchema)) dto: LivraisonDto, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.creer(dto, u);
  }

  @Put(':id')
  modifier(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(livraisonSchema)) dto: LivraisonDto, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.modifier(id, dto, u);
  }

  @Delete(':id')
  supprimer(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.supprimer(id);
  }

  @Post(':id/valider')
  @HttpCode(200)
  valider(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.valider(id, u, a.id);
  }

  @Post(':id/reception')
  @HttpCode(200)
  receptionner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(receptionSchema)) dto: ReceptionDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.receptionner(id, dto, u, a.id);
  }

  @Post(':id/facturer')
  @HttpCode(200)
  facturer(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.facturer(id, u, a.id);
  }
}

@Controller('factures')
@ModuleMetier('ventes')
@Permissions(PERMISSIONS.VENTES_SAISIR)
export class FacturesController {
  constructor(private readonly service: FacturesService) {}

  @Get()
  lister(@Query('clientId') clientId?: string, @Query('nonSoldees') nonSoldees?: string) {
    return this.service.lister({ clientId, nonSoldees: nonSoldees === '1' });
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @UtilisateurCourant() u: UtilisateurConnecte) {
    return this.service.detail(id, voirCouts(u));
  }

  /** Avoir (retour après facture) : double validation par le gérant, §10.3. */
  @Post(':id/avoirs')
  @Permissions(PERMISSIONS.VENTES_SAISIR, PERMISSIONS.DOCUMENTS_ANNULER)
  creerAvoir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(avoirSchema)) dto: AvoirDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.creerAvoir(id, dto, u, a.id);
  }
}

@Controller('avoirs')
@ModuleMetier('ventes')
@Permissions(PERMISSIONS.VENTES_SAISIR)
export class AvoirsController {
  constructor(private readonly service: FacturesService) {}

  @Get()
  lister() {
    return this.service.listerAvoirs();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detailAvoir(id);
  }
}

@Controller('ventes')
@ModuleMetier('ventes')
export class VentesController {
  constructor(private readonly service: FacturesService) {}

  /** Indicateurs du tableau de bord : chiffre d'affaires, livraisons, factures à encaisser. */
  @Get('resume')
  @Permissions(PERMISSIONS.TABLEAU_DE_BORD_COMPLET)
  resume() {
    return this.service.resume();
  }
}
