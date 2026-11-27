import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { FournisseurDto } from '@somidac/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db } from '../../noyau/base/base';
import { achats, fournisseurs } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';

@Injectable()
export class FournisseursService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Fournisseurs avec le reste dû sur leurs achats validés. */
  async lister() {
    const liste = await this.db.select().from(fournisseurs).orderBy(asc(fournisseurs.nom));
    const dus = await this.db
      .select({ id: achats.fournisseurId, du: sql<number>`coalesce(sum(${achats.total} - ${achats.montantPaye}), 0)::bigint` })
      .from(achats)
      .where(eq(achats.statut, 'valide'))
      .groupBy(achats.fournisseurId);
    return liste.map((f) => ({ ...f, resteDu: Number(dus.find((d) => d.id === f.id)?.du ?? 0) }));
  }

  async enregistrer(id: string | null, dto: FournisseurDto, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [doublon] = await tx.select({ id: fournisseurs.id }).from(fournisseurs).where(sql`lower(${fournisseurs.nom}) = lower(${dto.nom})`);
      if (doublon && doublon.id !== id) throw new ErreurMetier('DOUBLON', 'Un fournisseur porte déjà ce nom', HttpStatus.CONFLICT);
      const [f] = id
        ? await tx.update(fournisseurs).set(dto).where(eq(fournisseurs.id, id)).returning()
        : await tx.insert(fournisseurs).values(dto).returning();
      if (!f) throw new ErreurMetier('INTROUVABLE', 'Fournisseur introuvable', HttpStatus.NOT_FOUND);
      await this.audit.enregistrer(tx, { action: id ? 'fournisseur.modifie' : 'fournisseur.cree', utilisateurId, appareilId, entite: 'fournisseur', entiteId: f.id, apres: f });
      return f;
    });
  }
}
