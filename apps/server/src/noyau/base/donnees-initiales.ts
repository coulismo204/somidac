import { Inject, Injectable } from '@nestjs/common';
import { MODULES_ACTIFS_PAR_DEFAUT, ROLES_PAR_DEFAUT, TOUTES_PERMISSIONS } from '@somidac/shared';
import { eq } from 'drizzle-orm';
import { DB, Db } from './base';
import { categories, parametres, rolePermissions, roles, sites } from './schema';

/**
 * Données indispensables, créées une seule fois : site, paramètres, rôles par défaut.
 * Ne modifie jamais ce que le gérant a déjà changé.
 */
@Injectable()
export class InitialiserDonnees {
  constructor(@Inject(DB) private readonly db: Db) {}

  async executer() {
    await this.db.transaction(async (tx) => {
      const [site] = await tx.select().from(sites).limit(1);
      if (!site) await tx.insert(sites).values({ nom: 'Siège' });

      await tx
        .insert(parametres)
        .values({ id: 1, modulesActifs: MODULES_ACTIFS_PAR_DEFAUT })
        .onConflictDoNothing();

      for (const def of ROLES_PAR_DEFAUT) {
        const [existant] = await tx.select().from(roles).where(eq(roles.code, def.code));
        if (existant) continue;
        const [role] = await tx
          .insert(roles)
          .values({ code: def.code, libelle: def.libelle, systeme: true })
          .returning();
        await tx
          .insert(rolePermissions)
          .values(def.permissions.map((permission) => ({ roleId: role.id, permission })));
      }

      // Le gérant reçoit toujours toutes les permissions, y compris celles ajoutées par une mise à jour.
      const [gerant] = await tx.select().from(roles).where(eq(roles.code, 'gerant'));
      if (gerant) {
        await tx
          .insert(rolePermissions)
          .values(TOUTES_PERMISSIONS.map((permission) => ({ roleId: gerant.id, permission })))
          .onConflictDoNothing();
      }

      // Catégories de départ (modifiables par le gérant).
      const [uneCategorie] = await tx.select({ id: categories.id }).from(categories).limit(1);
      if (!uneCategorie) {
        await tx.insert(categories).values([
          { nom: 'Soins du corps', type: 'cosmetique' },
          { nom: 'Soins du visage', type: 'cosmetique' },
          { nom: 'Cheveux', type: 'cosmetique' },
          { nom: 'Parfums', type: 'cosmetique' },
          { nom: 'Hygiène', type: 'cosmetique' },
          { nom: 'Maquillage', type: 'cosmetique' },
          { nom: 'Ménage et entretien', type: 'bazar' },
          { nom: 'Cuisine', type: 'bazar' },
          { nom: 'Divers', type: 'bazar' },
        ]);
      }
    });
  }
}
