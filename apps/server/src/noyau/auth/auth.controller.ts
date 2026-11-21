import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ChangementMotDePasseDto,
  changementMotDePasseSchema,
  ConnexionDto,
  connexionSchema,
  DeverrouillageDto,
  deverrouillageSchema,
} from '@somidac/shared';
import { ZodPipe } from '../commun/zod.pipe';
import type { AppareilConnecte, UtilisateurConnecte } from '../commun/requete';
import { AuthService } from './auth.service';
import {
  AppareilCourant,
  AutoriseAvantChangementMotDePasse,
  AutoriseSiVerrouillee,
  Public,
  SessionCourante,
  UtilisateurCourant,
} from './decorateurs';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Connexion : toujours depuis un appareil enregistré (certificat vérifié par la garde). */
  @Post('connexion')
  @HttpCode(200)
  @Public()
  connecter(@Body(new ZodPipe(connexionSchema)) dto: ConnexionDto, @AppareilCourant() a: AppareilConnecte) {
    return this.auth.connecter(dto, a.id);
  }

  @Post('deverrouiller')
  @HttpCode(200)
  @AutoriseSiVerrouillee()
  @AutoriseAvantChangementMotDePasse()
  deverrouiller(
    @Body(new ZodPipe(deverrouillageSchema)) dto: DeverrouillageDto,
    @SessionCourante() sessionId: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.auth.deverrouiller(sessionId, u.id, a.id, dto.motDePasse);
  }

  @Post('verrouiller')
  @HttpCode(200)
  @AutoriseSiVerrouillee()
  @AutoriseAvantChangementMotDePasse()
  verrouiller(
    @SessionCourante() sessionId: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.auth.verrouiller(sessionId, u.id, a.id);
  }

  @Post('deconnexion')
  @HttpCode(200)
  @AutoriseSiVerrouillee()
  @AutoriseAvantChangementMotDePasse()
  deconnecter(
    @SessionCourante() sessionId: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.auth.deconnecter(sessionId, u.id, a.id);
  }

  @Post('mot-de-passe')
  @HttpCode(200)
  @AutoriseAvantChangementMotDePasse()
  changerMotDePasse(
    @Body(new ZodPipe(changementMotDePasseSchema)) dto: ChangementMotDePasseDto,
    @SessionCourante() sessionId: string,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.auth.changerMotDePasse(sessionId, u.id, a.id, dto.ancienMotDePasse, dto.nouveauMotDePasse);
  }

  @Get('moi')
  @AutoriseAvantChangementMotDePasse()
  moi(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.auth.profil(u.id);
  }
}
