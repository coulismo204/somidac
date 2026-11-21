import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { CodeModule, Permission } from '@somidac/shared';
import type { RequeteSomidac } from '../commun/requete';

export const CLE_PUBLIC = 'somidac:public';
export const CLE_SANS_APPAREIL = 'somidac:sans-appareil';
export const CLE_LOCAL_SEULEMENT = 'somidac:local-seulement';
export const CLE_PERMISSIONS = 'somidac:permissions';
export const CLE_MODULE = 'somidac:module';
export const CLE_AUTORISE_SI_VERROUILLEE = 'somidac:autorise-si-verrouillee';
export const CLE_AUTORISE_AVANT_CHANGEMENT_MDP = 'somidac:autorise-avant-changement-mdp';

/** Route accessible sans être connecté (mais toujours depuis un appareil enregistré). */
export const Public = () => SetMetadata(CLE_PUBLIC, true);
/** Route accessible sans certificat d'appareil (enregistrement, santé). */
export const SansAppareil = () => SetMetadata(CLE_SANS_APPAREIL, true);
/** Route accessible uniquement depuis le poste principal lui-même. */
export const LocalSeulement = () => SetMetadata(CLE_LOCAL_SEULEMENT, true);
/** L'utilisateur doit avoir toutes ces permissions. */
export const Permissions = (...permissions: Permission[]) => SetMetadata(CLE_PERMISSIONS, permissions);
/** La route appartient à un module métier : refusée si le module est désactivé. */
export const ModuleMetier = (code: CodeModule) => SetMetadata(CLE_MODULE, code);
export const AutoriseSiVerrouillee = () => SetMetadata(CLE_AUTORISE_SI_VERROUILLEE, true);
export const AutoriseAvantChangementMotDePasse = () => SetMetadata(CLE_AUTORISE_AVANT_CHANGEMENT_MDP, true);

export const UtilisateurCourant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequeteSomidac>().utilisateur,
);
export const AppareilCourant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequeteSomidac>().appareil,
);
export const SessionCourante = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequeteSomidac>().sessionId,
);
