import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  CreationUtilisateurDto,
  creationUtilisateurSchema,
  ModificationRoleDto,
  modificationRoleSchema,
  ModificationUtilisateurDto,
  modificationUtilisateurSchema,
  PERMISSIONS,
  ReinitialisationMotDePasseDto,
  reinitialisationMotDePasseSchema,
} from '@somidac/shared';
import { AppareilCourant, Permissions, UtilisateurCourant } from '../auth/decorateurs';
import { ZodPipe } from '../commun/zod.pipe';
import type { AppareilConnecte, UtilisateurConnecte } from '../commun/requete';
import { UtilisateursService } from './utilisateurs.service';

@Controller('utilisateurs')
@Permissions(PERMISSIONS.ADMIN_UTILISATEURS)
export class UtilisateursController {
  constructor(private readonly service: UtilisateursService) {}

  @Get()
  lister() {
    return this.service.lister();
  }

  @Post()
  creer(
    @Body(new ZodPipe(creationUtilisateurSchema)) dto: CreationUtilisateurDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.creerDepuisAdmin(dto, u.id, a.id);
  }

  @Patch(':id')
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(modificationUtilisateurSchema)) dto: ModificationUtilisateurDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.modifier(id, dto, u.id, a.id);
  }

  @Post(':id/reinitialiser-mot-de-passe')
  @HttpCode(200)
  reinitialiser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reinitialisationMotDePasseSchema)) dto: ReinitialisationMotDePasseDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.reinitialiserMotDePasse(id, dto.motDePasseInitial, u.id, a.id);
  }
}

@Controller('roles')
@Permissions(PERMISSIONS.ADMIN_UTILISATEURS)
export class RolesController {
  constructor(private readonly service: UtilisateursService) {}

  @Get()
  lister() {
    return this.service.listerRoles();
  }

  @Put(':id/permissions')
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(modificationRoleSchema)) dto: ModificationRoleDto,
    @UtilisateurCourant() u: UtilisateurConnecte,
    @AppareilCourant() a: AppareilConnecte,
  ) {
    return this.service.modifierPermissionsRole(id, dto.permissions, u.id, a.id);
  }
}
