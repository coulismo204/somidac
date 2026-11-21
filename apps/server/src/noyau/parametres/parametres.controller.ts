import { Body, Controller, Get, Put } from '@nestjs/common';
import { PERMISSIONS, ParametresEntrepriseDto, parametresEntrepriseSchema } from '@somidac/shared';
import { AppareilCourant, Permissions, UtilisateurCourant } from '../auth/decorateurs';
import { ZodPipe } from '../commun/zod.pipe';
import type { AppareilConnecte, UtilisateurConnecte } from '../commun/requete';
import { ParametresService } from './parametres.service';

@Controller('parametres')
export class ParametresController {
  constructor(private readonly parametres: ParametresService) {}

  @Get()
  async lire() {
    return this.parametres.versDto(await this.parametres.lire());
  }

  @Put()
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES)
  modifier(
    @Body(new ZodPipe(parametresEntrepriseSchema)) dto: ParametresEntrepriseDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.parametres.modifier(dto, u.id, a.id);
  }
}
