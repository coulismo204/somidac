import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ImportDto, importSchema, PERMISSIONS } from '@somidac/shared';
import { AppareilCourant, ModuleMetier, Permissions, UtilisateurCourant } from '../../noyau/auth/decorateurs';
import type { AppareilConnecte, UtilisateurConnecte } from '../../noyau/commun/requete';
import { ZodPipe } from '../../noyau/commun/zod.pipe';
import { ImportService } from './import.service';
import { MiseEnServiceService } from './mise-en-service.service';

/** Mise en service (lot 6) : réservée au gérant. */
@Controller('mise-en-service')
@Permissions(PERMISSIONS.ADMIN_PARAMETRES)
export class MiseEnServiceController {
  constructor(
    private readonly service: MiseEnServiceService,
    private readonly imports: ImportService,
  ) {}

  @Get()
  etat() {
    return this.service.etat();
  }

  /** Import du fichier Excel de départ ; « verifierSeulement » ne modifie rien. */
  @Post('import')
  @HttpCode(200)
  @ModuleMetier('produits')
  @Permissions(PERMISSIONS.ADMIN_PARAMETRES, PERMISSIONS.PRODUITS_GERER, PERMISSIONS.PRIX_MODIFIER)
  importer(@Body(new ZodPipe(importSchema)) dto: ImportDto, @UtilisateurCourant() u: UtilisateurConnecte, @AppareilCourant() a: AppareilConnecte) {
    return this.imports.traiter(dto, u, a.id);
  }
}
