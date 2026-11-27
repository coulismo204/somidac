import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ComptageInventaireDto } from '@somidac/shared';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { inventaireLignes, inventaires, lots, produits } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import { StockService } from './stock.service';

/**
 * Inventaire (§5.4) : liste à compter (quantités théoriques figées à l'ouverture), saisie des
 * quantités comptées, calcul des écarts, validation par le gérant, puis ajustements automatiques.
 */
@Injectable()
export class InventairesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  lister() {
    return this.db.select().from(inventaires).orderBy(desc(inventaires.creeLe)).limit(50);
  }

  async ouvrir(libelle: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [enCours] = await tx.select({ id: inventaires.id }).from(inventaires).where(eq(inventaires.statut, 'en_cours'));
      if (enCours) throw new ErreurMetier('INVENTAIRE_EN_COURS', 'Un inventaire est déjà en cours : terminez-le ou annulez-le', HttpStatus.CONFLICT);
      const [inv] = await tx.insert(inventaires).values({ libelle, creePar: utilisateurId }).returning();
      const aCompter = await tx
        .select({ lotId: lots.id, produitId: lots.produitId, quantite: lots.quantite })
        .from(lots)
        .innerJoin(produits, eq(produits.id, lots.produitId))
        .where(and(gt(lots.quantite, 0), eq(produits.actif, true)));
      if (aCompter.length) {
        await tx.insert(inventaireLignes).values(
          aCompter.map((l) => ({ inventaireId: inv.id, produitId: l.produitId, lotId: l.lotId, quantiteTheorique: l.quantite })),
        );
      }
      await this.audit.enregistrer(tx, { action: 'inventaire.ouvert', utilisateurId, appareilId, entite: 'inventaire', entiteId: inv.id, details: { libelle, lignes: aCompter.length } });
      return { id: inv.id };
    });
  }

  async detail(id: string) {
    const [inv] = await this.db.select().from(inventaires).where(eq(inventaires.id, id));
    if (!inv) throw new ErreurMetier('INTROUVABLE', 'Inventaire introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({
        id: inventaireLignes.id,
        produitId: inventaireLignes.produitId,
        produit: produits.designation,
        codeProduit: produits.code,
        lotNumero: lots.numero,
        datePeremption: lots.datePeremption,
        quantiteTheorique: inventaireLignes.quantiteTheorique,
        quantiteComptee: inventaireLignes.quantiteComptee,
      })
      .from(inventaireLignes)
      .innerJoin(produits, eq(produits.id, inventaireLignes.produitId))
      .innerJoin(lots, eq(lots.id, inventaireLignes.lotId))
      .where(eq(inventaireLignes.inventaireId, id))
      .orderBy(asc(produits.designation), asc(lots.datePeremption));
    return {
      ...inv,
      lignes: lignes.map((l) => ({ ...l, ecart: l.quantiteComptee == null ? null : l.quantiteComptee - l.quantiteTheorique })),
    };
  }

  async saisir(id: string, dto: ComptageInventaireDto) {
    return this.db.transaction(async (tx) => {
      await this.enCours(tx, id);
      for (const c of dto.comptages) {
        await tx
          .update(inventaireLignes)
          .set({ quantiteComptee: c.quantiteComptee })
          .where(and(eq(inventaireLignes.id, c.ligneId), eq(inventaireLignes.inventaireId, id)));
      }
      return { ok: true };
    });
  }

  /** Validation par le gérant : chaque écart devient un mouvement « inventaire » ; les lignes non comptées sont inchangées. */
  async valider(id: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      await this.enCours(tx, id);
      const lignes = await tx.select().from(inventaireLignes).where(eq(inventaireLignes.inventaireId, id));
      const ecarts: { produitId: string; lotId: string; ecart: number }[] = [];
      for (const l of lignes) {
        if (l.quantiteComptee == null) continue;
        const ecart = l.quantiteComptee - l.quantiteTheorique;
        if (ecart === 0) continue;
        const [lot] = await tx.select().from(lots).where(eq(lots.id, l.lotId));
        if (ecart > 0) {
          await this.stock.entree(tx, {
            produitId: l.produitId,
            quantite: ecart,
            numeroLot: lot.numero || null,
            datePeremption: lot.datePeremption,
            type: 'inventaire',
            document: { type: 'inventaire', id },
            motif: 'Écart d’inventaire',
            utilisateurId,
          });
        } else {
          // Le stock a pu bouger depuis l'ouverture : on ne retire jamais plus que ce qui reste dans le lot.
          const aRetirer = Math.min(-ecart, lot.quantite);
          if (aRetirer > 0) {
            await this.stock.sortie(tx, {
              produitId: l.produitId,
              lotId: l.lotId,
              quantite: aRetirer,
              type: 'inventaire',
              document: { type: 'inventaire', id },
              motif: 'Écart d’inventaire',
              utilisateurId,
            });
          }
        }
        ecarts.push({ produitId: l.produitId, lotId: l.lotId, ecart });
      }
      await tx.update(inventaires).set({ statut: 'valide', validePar: utilisateurId, valideLe: new Date() }).where(eq(inventaires.id, id));
      await this.audit.enregistrer(tx, { action: 'inventaire.valide', utilisateurId, appareilId, entite: 'inventaire', entiteId: id, details: { ecarts } });
      return { id, nbEcarts: ecarts.length };
    });
  }

  async annuler(id: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      await this.enCours(tx, id);
      await tx.update(inventaires).set({ statut: 'annule' }).where(eq(inventaires.id, id));
      await this.audit.enregistrer(tx, { action: 'inventaire.annule', utilisateurId, appareilId, entite: 'inventaire', entiteId: id });
      return { ok: true };
    });
  }

  private async enCours(tx: Tx, id: string) {
    const [inv] = await tx.select().from(inventaires).where(eq(inventaires.id, id)).for('update');
    if (!inv) throw new ErreurMetier('INTROUVABLE', 'Inventaire introuvable', HttpStatus.NOT_FOUND);
    if (inv.statut !== 'en_cours') throw new ErreurMetier('INVENTAIRE_CLOS', 'Cet inventaire est clos', HttpStatus.CONFLICT);
    return inv;
  }
}
