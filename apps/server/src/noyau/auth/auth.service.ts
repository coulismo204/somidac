import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  CODES_ERREUR as E,
  ConnexionDto,
  DUREE_BLOCAGE_COMPTE_MIN,
  ECHECS_CONNEXION_MAX,
} from '@somidac/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Db } from '../base/base';
import { appareils, utilisateurs } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';
import { hacherMotDePasse, obtenirHashFactice, verifierMotDePasse } from './mots-de-passe';
import { PermissionsService } from './permissions.service';
import { SessionsService } from './sessions.service';

type Utilisateur = typeof utilisateurs.$inferSelect;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Vérifie identifiant et mot de passe, avec blocage après 5 échecs (§10.2).
   * Utilisé pour la connexion et pour le réenregistrement du poste principal.
   */
  async verifierIdentifiants(identifiantSaisi: string, motDePasse: string, appareilId: string | null): Promise<Utilisateur> {
    const identifiant = identifiantSaisi.trim().toLowerCase();
    const [u] = await this.db.select().from(utilisateurs).where(eq(utilisateurs.identifiant, identifiant));

    if (u?.bloqueJusquA && u.bloqueJusquA > new Date()) {
      await this.audit.enregistrer(this.db, {
        action: 'connexion.refusee_compte_bloque',
        utilisateurId: u.id,
        appareilId,
      });
      throw this.erreurBloque(u.bloqueJusquA);
    }

    // Même temps de réponse que l'identifiant existe ou non.
    const valide = await verifierMotDePasse(u?.hashMotDePasse ?? (await obtenirHashFactice()), motDePasse);
    if (!u || !valide || !u.actif) {
      if (u) await this.enregistrerEchec(u, appareilId, 'connexion.echec');
      else
        await this.audit.enregistrer(this.db, {
          action: 'connexion.echec_identifiant_inconnu',
          appareilId,
          details: { identifiant },
        });
      throw new ErreurMetier(E.IDENTIFIANTS_INCORRECTS, 'Identifiant ou mot de passe incorrect', HttpStatus.UNAUTHORIZED);
    }
    return u;
  }

  async connecter(dto: ConnexionDto, appareilId: string) {
    const u = await this.verifierIdentifiants(dto.identifiant, dto.motDePasse, appareilId);
    const maintenant = new Date();

    return this.db.transaction(async (tx) => {
      await tx
        .update(utilisateurs)
        .set({ echecsConnexion: 0, bloqueJusquA: null, derniereConnexion: maintenant })
        .where(eq(utilisateurs.id, u.id));
      await tx.update(appareils).set({ dernierUtilisateurId: u.id }).where(eq(appareils.id, appareilId));
      const { jeton } = await this.sessions.ouvrir(tx, u.id, appareilId);
      await this.audit.enregistrer(tx, { action: 'connexion.reussie', utilisateurId: u.id, appareilId });
      return { jeton, utilisateur: await this.profil(u.id, tx) };
    });
  }

  async deverrouiller(sessionId: string, utilisateurId: string, appareilId: string, motDePasse: string) {
    const [u] = await this.db.select().from(utilisateurs).where(eq(utilisateurs.id, utilisateurId));
    if (u.bloqueJusquA && u.bloqueJusquA > new Date()) throw this.erreurBloque(u.bloqueJusquA);
    if (!(await verifierMotDePasse(u.hashMotDePasse, motDePasse))) {
      await this.enregistrerEchec(u, appareilId, 'deverrouillage.echec');
      throw new ErreurMetier(E.IDENTIFIANTS_INCORRECTS, 'Mot de passe incorrect', HttpStatus.UNAUTHORIZED);
    }
    await this.db.transaction(async (tx) => {
      await tx.update(utilisateurs).set({ echecsConnexion: 0 }).where(eq(utilisateurs.id, u.id));
      await this.sessions.deverrouiller(tx, sessionId);
      await this.audit.enregistrer(tx, { action: 'session.deverrouillee', utilisateurId: u.id, appareilId });
    });
    return { ok: true };
  }

  /** Verrouillage demandé par l'utilisateur ou après inactivité : appliqué côté serveur. */
  async verrouiller(sessionId: string, utilisateurId: string, appareilId: string) {
    await this.db.transaction(async (tx) => {
      await this.sessions.verrouiller(tx, sessionId);
      await this.audit.enregistrer(tx, { action: 'session.verrouillee', utilisateurId, appareilId });
    });
    return { ok: true };
  }

  async deconnecter(sessionId: string, utilisateurId: string, appareilId: string) {
    await this.db.transaction(async (tx) => {
      await this.sessions.fermer(tx, sessionId);
      await this.audit.enregistrer(tx, { action: 'deconnexion', utilisateurId, appareilId });
    });
    return { ok: true };
  }

  async changerMotDePasse(
    sessionId: string,
    utilisateurId: string,
    appareilId: string,
    ancien: string,
    nouveau: string,
  ) {
    const [u] = await this.db.select().from(utilisateurs).where(eq(utilisateurs.id, utilisateurId));
    if (!(await verifierMotDePasse(u.hashMotDePasse, ancien))) {
      await this.enregistrerEchec(u, appareilId, 'mot_de_passe.echec_changement');
      throw new ErreurMetier(E.IDENTIFIANTS_INCORRECTS, 'Ancien mot de passe incorrect', HttpStatus.BAD_REQUEST);
    }
    if (ancien === nouveau) {
      throw new ErreurMetier('MOT_DE_PASSE_IDENTIQUE', "Le nouveau mot de passe doit être différent de l'ancien");
    }
    const hash = await hacherMotDePasse(nouveau);
    await this.db.transaction(async (tx) => {
      await tx
        .update(utilisateurs)
        .set({ hashMotDePasse: hash, doitChangerMotDePasse: false, echecsConnexion: 0, modifieLe: new Date() })
        .where(eq(utilisateurs.id, u.id));
      // Les autres sessions de cet utilisateur sont fermées.
      await this.sessions.fermerPourUtilisateur(tx, u.id, sessionId);
      await this.audit.enregistrer(tx, { action: 'mot_de_passe.change', utilisateurId: u.id, appareilId });
    });
    return { ok: true };
  }

  async profil(utilisateurId: string, tx: Db | Parameters<Parameters<Db['transaction']>[0]>[0] = this.db) {
    const [u] = await tx.select().from(utilisateurs).where(eq(utilisateurs.id, utilisateurId));
    const permissions = await this.permissions.permissionsUtilisateur(u.id, tx);
    return {
      id: u.id,
      identifiant: u.identifiant,
      nomComplet: u.nomComplet,
      doitChangerMotDePasse: u.doitChangerMotDePasse,
      plafondRemisePct: u.plafondRemisePct,
      permissions: [...permissions].sort(),
    };
  }

  private async enregistrerEchec(u: Utilisateur, appareilId: string | null, action: string) {
    const echecs = u.echecsConnexion + 1;
    const bloque = echecs >= ECHECS_CONNEXION_MAX;
    await this.db.transaction(async (tx) => {
      await tx
        .update(utilisateurs)
        .set({
          echecsConnexion: bloque ? 0 : echecs,
          bloqueJusquA: bloque ? new Date(Date.now() + DUREE_BLOCAGE_COMPTE_MIN * 60_000) : u.bloqueJusquA,
        })
        .where(eq(utilisateurs.id, u.id));
      await this.audit.enregistrer(tx, {
        action: bloque ? 'compte.bloque' : action,
        utilisateurId: u.id,
        appareilId,
        details: { echecs },
      });
    });
  }

  private erreurBloque(jusqua: Date) {
    const minutes = Math.ceil((jusqua.getTime() - Date.now()) / 60_000);
    return new ErreurMetier(
      E.COMPTE_BLOQUE,
      `Compte bloqué après ${ECHECS_CONNEXION_MAX} essais. Réessayez dans ${minutes} min.`,
      HttpStatus.UNAUTHORIZED,
      { bloqueJusquA: jusqua.toISOString() },
    );
  }
}
