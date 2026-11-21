import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, DbOuTx } from '../base/base';
import { rolePermissions, utilisateurRoles } from '../base/schema';

@Injectable()
export class PermissionsService {
  constructor(@Inject(DB) private readonly db: DbOuTx) {}

  async permissionsUtilisateur(utilisateurId: string, tx: DbOuTx = this.db): Promise<Set<string>> {
    const lignes = await tx
      .selectDistinct({ permission: rolePermissions.permission })
      .from(utilisateurRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, utilisateurRoles.roleId))
      .where(eq(utilisateurRoles.utilisateurId, utilisateurId));
    return new Set(lignes.map((l) => l.permission));
  }
}
