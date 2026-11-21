import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  CreationAppareilDto,
  creationAppareilSchema,
  EnrolementDto,
  enrolementSchema,
  PERMISSIONS,
  RenouvellementCertificatDto,
  renouvellementCertificatSchema,
} from '@somidac/shared';
import { AppareilCourant, Permissions, Public, SansAppareil, UtilisateurCourant } from '../auth/decorateurs';
import { ZodPipe } from '../commun/zod.pipe';
import type { AppareilConnecte, UtilisateurConnecte } from '../commun/requete';
import { AppareilsService } from './appareils.service';

@Controller('appareils')
export class AppareilsController {
  constructor(private readonly appareils: AppareilsService) {}

  @Get()
  @Permissions(PERMISSIONS.ADMIN_APPAREILS)
  lister() {
    return this.appareils.lister();
  }

  @Post()
  @Permissions(PERMISSIONS.ADMIN_APPAREILS)
  creer(
    @Body(new ZodPipe(creationAppareilSchema)) dto: CreationAppareilDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.appareils.creer(dto.nom, u.id, a.id);
  }

  @Post(':id/nouveau-code')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_APPAREILS)
  nouveauCode(
    @Param('id', ParseUUIDPipe) id: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.appareils.nouveauCode(id, u.id, a.id);
  }

  @Post(':id/revoquer')
  @HttpCode(200)
  @Permissions(PERMISSIONS.ADMIN_APPAREILS)
  revoquer(
    @Param('id', ParseUUIDPipe) id: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.appareils.revoquer(id, u.id, a.id);
  }

  /** Renouvellement du certificat : l'appareil s'authentifie avec son certificat actuel. */
  @Post('moi/renouveler')
  @HttpCode(200)
  @Public()
  renouveler(
    @Body(new ZodPipe(renouvellementCertificatSchema)) dto: RenouvellementCertificatDto,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.appareils.renouveler(a.id, dto.csrPem);
  }
}

/** Enregistrement d'un nouvel appareil : seule route accessible sans certificat ni session. */
@Controller('enrolement')
export class EnrolementController {
  constructor(private readonly appareils: AppareilsService) {}

  @Post()
  @HttpCode(200)
  @Public()
  @SansAppareil()
  enregistrer(@Body(new ZodPipe(enrolementSchema)) dto: EnrolementDto) {
    return this.appareils.enregistrer(dto);
  }
}
