import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  CreationUtilisateurDto,
  ModificationUtilisateurDto,
  PERMISSIONS,
  TOUTES_PERMISSIONS,
} from '@somidac/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { hacherMotDePasse } from '../auth/mots-de-passe';
import { SessionsService } from '../auth/sessions.service';
import { DB, Db, DbOuTx } from '../base/base';
import { rolePermissions, roles, sites, utilisateurRoles, utilisateurs } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';

type Utilisateur = typeof utilisateurs.$inferSelect;

function vue(u: Utilisateur, codesRoles: string[]) {
  return {
    id: u.id,
    identifiant: u.identifiant,
    nomComplet: u.nomComplet,
    actif: u.actif,
    roles: codesRoles,
    plafondRemisePct: u.plafondRemisePct,
    doitChangerMotDePasse: u.doitChangerMotDePasse,
    bloqueJusquA: u.bloqueJusquA,
    derniereConnexion: u.derniereConnexion,
    creeLe: u.creeLe,
  };
}

@Injectable()
export class UtilisateursService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async lister() {
    const liste = await this.db.select().from(utilisateurs).orderBy(asc(utilisateurs.nomComplet));
    const liens = await this.db
      .select({ utilisateurId: utilisateurRoles.utilisateurId, code: roles.code })
      .from(utilisateurRoles)
      .innerJoin(roles, eq(roles.id, utilisateurRoles.roleId));
    return liste.map((u) =>
      vue(
        u,
        liens.filter((l) => l.utilisateurId === u.id).map((l) => l.code),
      ),
    );
  }

  /** Création d'un compte (aussi utilisée pour le gérant lors de l'initialisation). */
  async creer(
    tx: DbOuTx,
    dto: CreationUtilisateurDto,
    auteur: { utilisateurId: string | null; appareilId: string | null },
    doitChangerMotDePasse = true,
  ) {
    const [existant] = await tx.select({ id: utilisateurs.id }).from(utilisateurs).where(eq(utilisateurs.identifiant, dto.identifiant));
    if (existant) throw new ErreurMetier('IDENTIFIANT_PRIS', 'Cet identifiant est déjà utilisé', HttpStatus.CONFLICT);
    const idsRoles = await this.idsRoles(tx, dto.roles);
    const [site] = await tx.select().from(sites).limit(1);
    const [u] = await tx
      .insert(utilisateurs)
      .values({
        siteId: site.id,
        identifiant: dto.identifiant,
        nomComplet: dto.nomComplet,
        hashMotDePasse: await hacherMotDePasse(dto.motDePasseInitial),
        doitChangerMotDePasse,
        plafondRemisePct: dto.plafondRemisePct,
        creePar: auteur.utilisateurId,
      })
      .returning();
    await tx.insert(utilisateurRoles).values(idsRoles.map((roleId) => ({ utilisateurId: u.id, roleId })));
    const resultat = vue(u, dto.roles);
    await this.audit.enregistrer(tx, {
      action: 'utilisateur.cree',
      utilisateurId: auteur.utilisateurId,
      appareilId: auteur.appareilId,
      entite: 'utilisateur',
      entiteId: u.id,
      apres: resultat,
    });
    return resultat;
  }

  async creerDepuisAdmin(dto: CreationUtilisateurDto, auteurId: string, appareilId: string) {
    return this.db.transaction((tx) => this.creer(tx, dto, { utilisateurId: auteurId, appareilId }));
  }

  async modifier(id: string, dto: ModificationUtilisateurDto, auteurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [u] = await tx.select().from(utilisateurs).where(eq(utilisateurs.id, id)).for('update');
      if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable', HttpStatus.NOT_FOUND);
      const rolesAvant = await this.codesRoles(tx, id);
      if (id === auteurId && dto.actif === false) {
        throw new ErreurMetier('AUTO_DESACTIVATION', 'Vous ne pouvez pas désactiver votre propre compte');
      }

      const [maj] = await tx
        .update(utilisateurs)
        .set({
          nomComplet: dto.nomComplet ?? u.nomComplet,
          plafondRemisePct: dto.plafondRemisePct ?? u.plafondRemisePct,
          actif: dto.actif ?? u.actif,
          modifieLe: new Date(),
        })
        .where(eq(utilisateurs.id, id))
        .returning();
      if (dto.roles) {
        const idsRoles = await this.idsRoles(tx, dto.roles);
        await tx.delete(utilisateurRoles).where(eq(utilisateurRoles.utilisateurId, id));
        await tx.insert(utilisateurRoles).values(idsRoles.map((roleId) => ({ utilisateurId: id, roleId })));
      }
      await this.verifierAdministrateurRestant(tx);
      if (dto.actif === false) await this.sessions.fermerPourUtilisateur(tx, id);

      const rolesApres = dto.roles ?? rolesAvant;
      const resultat = vue(maj, rolesApres);
      await this.audit.enregistrer(tx, {
        action: dto.actif === false && u.actif ? 'utilisateur.desactive' : 'utilisateur.modifie',
        utilisateurId: auteurId,
        appareilId,
        entite: 'utilisateur',
        entiteId: id,
        avant: vue(u, rolesAvant),
        apres: resultat,
      });
      return resultat;
    });
  }

  async reinitialiserMotDePasse(id: string, motDePasse: string, auteurId: string, appareilId: string) {
    const hash = await hacherMotDePasse(motDePasse);
    return this.db.transaction(async (tx) => {
      const [u] = await tx
        .update(utilisateurs)
        .set({ hashMotDePasse: hash, doitChangerMotDePasse: true, echecsConnexion: 0, bloqueJusquA: null, modifieLe: new Date() })
        .where(eq(utilisateurs.id, id))
        .returning({ id: utilisateurs.id });
      if (!u) throw new ErreurMetier('INTROUVABLE', 'Utilisateur introuvable', HttpStatus.NOT_FOUND);
      await this.sessions.fermerPourUtilisateur(tx, id);
      await this.audit.enregistrer(tx, {
        action: 'utilisateur.mot_de_passe_reinitialise',
        utilisateurId: auteurId,
        appareilId,
        entite: 'utilisateur',
        entiteId: id,
      });
      return { ok: true };
    });
  }

  async listerRoles() {
    const liste = await this.db.select().from(roles).orderBy(asc(roles.libelle));
    const perms = await this.db.select().from(rolePermissions);
    return liste.map((r) => ({
      id: r.id,
      code: r.code,
      libelle: r.libelle,
      systeme: r.systeme,
      permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission).sort(),
    }));
  }

  async modifierPermissionsRole(roleId: string, permissions: string[], auteurId: string, appareilId: string) {
    const valides = new Set<string>(TOUTES_PERMISSIONS);
    const demandees = [...new Set(permissions)].filter((p) => valides.has(p));
    return this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(roles).where(eq(roles.id, roleId));
      if (!r) throw new ErreurMetier('INTROUVABLE', 'Rôle introuvable', HttpStatus.NOT_FOUND);
      const avant = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((p) => p.permission);
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (demandees.length) await tx.insert(rolePermissions).values(demandees.map((permission) => ({ roleId, permission })));
      await this.verifierAdministrateurRestant(tx);
      await this.audit.enregistrer(tx, {
        action: 'role.permissions_modifiees',
        utilisateurId: auteurId,
        appareilId,
        entite: 'role',
        entiteId: roleId,
        avant: { permissions: avant.sort() },
        apres: { permissions: demandees.sort() },
      });
      return { id: r.id, code: r.code, permissions: demandees.sort() };
    });
  }

  /** Garde-fou : il doit toujours rester un compte actif capable de gérer les utilisateurs. */
  private async verifierAdministrateurRestant(tx: DbOuTx) {
    const [{ total }] = await tx
      .select({ total: sql<number>`count(distinct ${utilisateurs.id})::int` })
      .from(utilisateurs)
      .innerJoin(utilisateurRoles, eq(utilisateurRoles.utilisateurId, utilisateurs.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, utilisateurRoles.roleId))
      .where(and(eq(utilisateurs.actif, true), eq(rolePermissions.permission, PERMISSIONS.ADMIN_UTILISATEURS)));
    if (total < 1) {
      throw new ErreurMetier(
        'DERNIER_ADMINISTRATEUR',
        'Il doit rester au moins un compte actif autorisé à gérer les utilisateurs',
      );
    }
  }

  private async idsRoles(tx: DbOuTx, codes: string[]): Promise<string[]> {
    const lignes = await tx.select({ id: roles.id, code: roles.code }).from(roles).where(inArray(roles.code, codes));
    const inconnus = codes.filter((c) => !lignes.some((l) => l.code === c));
    if (inconnus.length) throw new ErreurMetier('ROLE_INCONNU', `Rôle inconnu : ${inconnus.join(', ')}`);
    return lignes.map((l) => l.id);
  }

  private async codesRoles(tx: DbOuTx, utilisateurId: string): Promise<string[]> {
    const lignes = await tx
      .select({ code: roles.code })
      .from(utilisateurRoles)
      .innerJoin(roles, eq(roles.id, utilisateurRoles.roleId))
      .where(eq(utilisateurRoles.utilisateurId, utilisateurId));
    return lignes.map((l) => l.code);
  }
}
