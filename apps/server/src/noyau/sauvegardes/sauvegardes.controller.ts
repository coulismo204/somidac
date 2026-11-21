import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ChoixSauvegardeDto,
  choixSauvegardeSchema,
  MotDePasseRestaurationDto,
  motDePasseRestaurationSchema,
  PERMISSIONS,
  ReglagesSauvegardeDto,
  reglagesSauvegardeSchema,
  RestaurationDto,
  restaurationSchema,
} from '@somidac/shared';
import { AppareilCourant, Permissions, UtilisateurCourant } from '../auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../commun/requete';
import { ZodPipe } from '../commun/zod.pipe';
import { SauvegardesService } from './sauvegardes.service';

@Controller('sauvegardes')
@Permissions(PERMISSIONS.ADMIN_SAUVEGARDES)
export class SauvegardesController {
  constructor(private readonly service: SauvegardesService) {}

  @Get()
  etat() {
    return this.service.etat();
  }

  @Get('fichiers')
  fichiers() {
    return this.service.listerFichiers();
  }

  @Put('mot-de-passe')
  motDePasse(
    @Body(new ZodPipe(motDePasseRestaurationSchema)) dto: MotDePasseRestaurationDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.definirMotDePasse(dto.motDePasse, dto.ancienMotDePasse, u.id, a.id);
  }

  @Put('reglages')
  reglages(
    @Body(new ZodPipe(reglagesSauvegardeSchema)) dto: ReglagesSauvegardeDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.modifierReglages(dto.heure, dto.dossiers, u.id, a.id);
  }

  @Post()
  sauvegarder(@UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.service.sauvegarder('manuelle', u.id, a.id);
  }

  @Post('verifier')
  @HttpCode(200)
  verifier(@Body(new ZodPipe(choixSauvegardeSchema)) dto: ChoixSauvegardeDto) {
    return this.service.verifier(dto.nom, dto.dossier, dto.motDePasse);
  }

  @Post('restaurer')
  @HttpCode(200)
  restaurer(
    @Body(new ZodPipe(restaurationSchema)) dto: RestaurationDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.restaurer(dto.nom, dto.dossier, dto.motDePasse, u.id, a.id);
  }
}
