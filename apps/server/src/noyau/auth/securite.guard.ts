import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CODES_ERREUR as E, Permission } from '@somidac/shared';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../base/base';
import { appareils, utilisateurs } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';
import { estLocale, RequeteSomidac } from '../commun/requete';
import { ParametresService } from '../parametres/parametres.service';
import { normaliserSerie } from '../pki/pki';
import {
  CLE_AUTORISE_AVANT_CHANGEMENT_MDP,
  CLE_AUTORISE_SI_VERROUILLEE,
  CLE_LOCAL_SEULEMENT,
  CLE_MODULE,
  CLE_PERMISSIONS,
  CLE_PUBLIC,
  CLE_SANS_APPAREIL,
} from './decorateurs';
import { PermissionsService } from './permissions.service';
import { SessionsService } from './sessions.service';

/**
 * Contrôle unique appliqué à toutes les routes, dans cet ordre :
 * 1. appareil enregistré (certificat client valide et non révoqué) - §10.1
 * 2. session utilisateur valide, non verrouillée - §10.2
 * 3. mot de passe initial changé
 * 4. module métier actif - §4 architecture modulaire
 * 5. permissions du rôle - §3
 */
@Injectable()
export class SecuriteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
    private readonly parametres: ParametresService,
  ) {}

  private meta<T>(cle: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(cle, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequeteSomidac>();

    if (this.meta<boolean>(CLE_LOCAL_SEULEMENT, ctx) && !estLocale(req)) {
      throw new ErreurMetier(E.ACCES_LOCAL_REQUIS, 'Opération possible uniquement sur le poste principal', HttpStatus.FORBIDDEN);
    }

    // 1. Appareil
    if (!this.meta<boolean>(CLE_SANS_APPAREIL, ctx)) {
      await this.verifierAppareil(req);
    }

    // 2. Session
    if (this.meta<boolean>(CLE_PUBLIC, ctx)) return true;
    const entete = req.headers.authorization ?? '';
    const jeton = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
    if (!jeton || !req.appareil) {
      throw new ErreurMetier(E.NON_CONNECTE, 'Veuillez vous connecter', HttpStatus.UNAUTHORIZED);
    }
    const etat = await this.sessions.verifier(jeton, req.appareil.id);
    if (etat.etat === 'invalide') {
      throw new ErreurMetier(E.SESSION_EXPIREE, 'Session expirée, veuillez vous reconnecter', HttpStatus.UNAUTHORIZED);
    }
    if (etat.etat === 'verrouillee' && !this.meta<boolean>(CLE_AUTORISE_SI_VERROUILLEE, ctx)) {
      throw new ErreurMetier(E.SESSION_VERROUILLEE, 'Session verrouillée après inactivité', HttpStatus.UNAUTHORIZED);
    }
    const [u] = await this.db.select().from(utilisateurs).where(eq(utilisateurs.id, etat.utilisateurId));
    if (!u || !u.actif) {
      throw new ErreurMetier(E.SESSION_EXPIREE, 'Compte désactivé', HttpStatus.UNAUTHORIZED);
    }
    const permissions = await this.permissions.permissionsUtilisateur(u.id);
    req.sessionId = etat.sessionId;
    req.utilisateur = {
      id: u.id,
      identifiant: u.identifiant,
      nomComplet: u.nomComplet,
      permissions,
      plafondRemisePct: u.plafondRemisePct,
      doitChangerMotDePasse: u.doitChangerMotDePasse,
    };

    // 3. Mot de passe initial
    if (u.doitChangerMotDePasse && !this.meta<boolean>(CLE_AUTORISE_AVANT_CHANGEMENT_MDP, ctx)) {
      throw new ErreurMetier(
        E.CHANGEMENT_MOT_DE_PASSE_REQUIS,
        'Vous devez changer votre mot de passe',
        HttpStatus.FORBIDDEN,
      );
    }

    // 4. Module
    const module = this.meta<string>(CLE_MODULE, ctx);
    if (module && !(await this.parametres.moduleActif(module))) {
      throw new ErreurMetier(E.MODULE_DESACTIVE, 'Ce module est désactivé', HttpStatus.FORBIDDEN);
    }

    // 5. Permissions
    const requises = this.meta<Permission[]>(CLE_PERMISSIONS, ctx) ?? [];
    const manquantes = requises.filter((p) => !permissions.has(p));
    if (manquantes.length) {
      throw new ErreurMetier(E.PERMISSION_REFUSEE, "Vous n'avez pas le droit d'effectuer cette action", HttpStatus.FORBIDDEN, {
        manquantes,
      });
    }
    return true;
  }

  private async verifierAppareil(req: RequeteSomidac) {
    const socket = req.socket;
    const cert = socket.authorized ? socket.getPeerCertificate() : undefined;
    if (!cert || !cert.serialNumber) {
      throw new ErreurMetier(E.APPAREIL_NON_RECONNU, 'Appareil non enregistré', HttpStatus.UNAUTHORIZED);
    }
    const [a] = await this.db
      .select({ id: appareils.id, nom: appareils.nom, statut: appareils.statut, derniereConnexion: appareils.derniereConnexion })
      .from(appareils)
      .where(eq(appareils.numeroSerieCertificat, normaliserSerie(cert.serialNumber)));
    if (!a) throw new ErreurMetier(E.APPAREIL_NON_RECONNU, 'Appareil non enregistré', HttpStatus.UNAUTHORIZED);
    if (a.statut !== 'actif') throw new ErreurMetier(E.APPAREIL_REVOQUE, 'Cet appareil a été révoqué', HttpStatus.UNAUTHORIZED);

    const maintenant = new Date();
    if (!a.derniereConnexion || maintenant.getTime() - a.derniereConnexion.getTime() > 60_000) {
      await this.db
        .update(appareils)
        .set({ derniereConnexion: maintenant })
        .where(and(eq(appareils.id, a.id), eq(appareils.statut, 'actif')));
    }
    req.appareil = { id: a.id, nom: a.nom };
  }
}
