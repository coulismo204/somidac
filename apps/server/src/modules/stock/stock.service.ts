import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AjustementDto } from '@somidac/shared';
import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, DbOuTx } from '../../noyau/base/base';
import { categories, lots, marques, mouvementsStock, produits } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import { ParametresService } from '../../noyau/parametres/parametres.service';

export type TypeMouvement = (typeof mouvementsStock.$inferInsert)['type'];

export interface DocumentOrigine {
  type: string;
  id: string;
}

/** Date du jour (AAAA-MM-JJ, heure locale du serveur). */
export function aujourdhui(maintenant = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${maintenant.getFullYear()}-${p(maintenant.getMonth() + 1)}-${p(maintenant.getDate())}`;
}

/** Règle R1 : nouveau coût moyen pondéré, en centimes. */
export function nouveauCmp(stock: number, cmpCentimes: number, quantite: number, coutCentimes: number): number {
  if (stock <= 0) return coutCentimes;
  return Math.round((stock * cmpCentimes + quantite * coutCentimes) / (stock + quantite));
}

/**
 * Service central du stock (§5.4) : toute entrée ou sortie passe par lui, dans la transaction du
 * document qui la provoque (achat, vente, inventaire…). Le produit est verrouillé pendant l'opération :
 * deux postes ne peuvent pas sortir la même dernière pièce (R4).
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly parametres: ParametresService,
  ) {}

  private async verrouillerProduit(tx: DbOuTx, produitId: string) {
    const [p] = await tx.select().from(produits).where(eq(produits.id, produitId)).for('update');
    if (!p) throw new ErreurMetier('PRODUIT_INTROUVABLE', 'Produit introuvable', HttpStatus.NOT_FOUND);
    return p;
  }

  /**
   * Entrée en stock : alimente (ou crée) le lot, recalcule le coût moyen (R1) si un coût est fourni.
   * Renvoie le lot alimenté.
   */
  async entree(
    tx: DbOuTx,
    e: {
      produitId: string;
      quantite: number;
      /** Coût d'une pièce ; absent = au coût moyen actuel (pièces retrouvées), sans changer le CMP. */
      coutCentimes?: number;
      numeroLot?: string | null;
      datePeremption?: string | null;
      type: TypeMouvement;
      document?: DocumentOrigine;
      motif?: string;
      utilisateurId: string | null;
    },
  ): Promise<string> {
    if (!Number.isInteger(e.quantite) || e.quantite <= 0) throw new ErreurMetier('QUANTITE_INVALIDE', 'Quantité invalide');
    const p = await this.verrouillerProduit(tx, e.produitId);
    if (p.suiviLot && (!e.numeroLot || !e.datePeremption)) {
      throw new ErreurMetier('LOT_REQUIS', `« ${p.designation} » est suivi par lot : numéro de lot et date de péremption obligatoires`);
    }
    const numero = p.suiviLot ? e.numeroLot!.trim() : '';
    const peremption = p.suiviLot ? e.datePeremption! : null;

    const [existant] = await tx
      .select()
      .from(lots)
      .where(
        and(
          eq(lots.produitId, p.id),
          eq(lots.numero, numero),
          peremption ? eq(lots.datePeremption, peremption) : isNull(lots.datePeremption),
        ),
      )
      .for('update');
    let lotId: string;
    if (existant) {
      await tx.update(lots).set({ quantite: existant.quantite + e.quantite }).where(eq(lots.id, existant.id));
      lotId = existant.id;
    } else {
      const [l] = await tx.insert(lots).values({ produitId: p.id, numero, datePeremption: peremption, quantite: e.quantite }).returning();
      lotId = l.id;
    }

    const cout = e.coutCentimes ?? p.cmpCentimes;
    const cmp = e.coutCentimes === undefined ? p.cmpCentimes : nouveauCmp(p.stock, p.cmpCentimes, e.quantite, e.coutCentimes);
    await tx
      .update(produits)
      .set({ stock: p.stock + e.quantite, cmpCentimes: cmp, modifieLe: new Date() })
      .where(eq(produits.id, p.id));
    await tx.insert(mouvementsStock).values({
      type: e.type,
      produitId: p.id,
      lotId,
      quantite: e.quantite,
      coutCentimes: cout,
      documentType: e.document?.type,
      documentId: e.document?.id,
      motif: e.motif,
      utilisateurId: e.utilisateurId,
    });
    return lotId;
  }

  /**
   * Sortie de stock (R4, R5). Sans lot imposé : le lot qui périme en premier sort d'abord.
   * Pour une vente, les lots périmés sont exclus. Renvoie le détail par lot.
   */
  async sortie(
    tx: DbOuTx,
    s: {
      produitId: string;
      quantite: number;
      lotId?: string | null;
      type: TypeMouvement;
      document?: DocumentOrigine;
      motif?: string;
      utilisateurId: string | null;
    },
  ): Promise<{ lotId: string; quantite: number; coutCentimes: number }[]> {
    if (!Number.isInteger(s.quantite) || s.quantite <= 0) throw new ErreurMetier('QUANTITE_INVALIDE', 'Quantité invalide');
    const p = await this.verrouillerProduit(tx, s.produitId);
    const jour = aujourdhui();

    let candidats = await tx
      .select()
      .from(lots)
      .where(and(eq(lots.produitId, p.id), gt(lots.quantite, 0), s.lotId ? eq(lots.id, s.lotId) : sql`true`))
      .orderBy(sql`${lots.datePeremption} ASC NULLS LAST`, asc(lots.creeLe))
      .for('update');
    if (s.type === 'vente') {
      candidats = candidats.filter((l) => !l.datePeremption || l.datePeremption >= jour);
    }
    const disponible = candidats.reduce((t, l) => t + l.quantite, 0);
    if (disponible < s.quantite) {
      throw new ErreurMetier(
        'STOCK_INSUFFISANT',
        `Stock insuffisant pour « ${p.designation} » : ${disponible} pièce(s) disponible(s), ${s.quantite} demandée(s)`,
        HttpStatus.CONFLICT,
        { disponible },
      );
    }

    const detail: { lotId: string; quantite: number; coutCentimes: number }[] = [];
    let reste = s.quantite;
    for (const l of candidats) {
      if (reste === 0) break;
      const q = Math.min(reste, l.quantite);
      await tx.update(lots).set({ quantite: l.quantite - q }).where(eq(lots.id, l.id));
      await tx.insert(mouvementsStock).values({
        type: s.type,
        produitId: p.id,
        lotId: l.id,
        quantite: -q,
        coutCentimes: p.cmpCentimes,
        documentType: s.document?.type,
        documentId: s.document?.id,
        motif: s.motif,
        utilisateurId: s.utilisateurId,
      });
      detail.push({ lotId: l.id, quantite: q, coutCentimes: p.cmpCentimes });
      reste -= q;
    }
    await tx
      .update(produits)
      .set({ stock: p.stock - s.quantite, modifieLe: new Date() })
      .where(eq(produits.id, p.id));
    return detail;
  }

  /** Ajustement manuel : pièces retrouvées, casse, périmés (§5.4). Tracé dans le journal d'audit. */
  async ajuster(dto: AjustementDto, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(produits).where(eq(produits.id, dto.produitId));
      if (!p) throw new ErreurMetier('PRODUIT_INTROUVABLE', 'Produit introuvable', HttpStatus.NOT_FOUND);
      if (dto.quantite > 0 && dto.type !== 'ajustement') {
        throw new ErreurMetier('QUANTITE_INVALIDE', 'Une casse ou une péremption est une sortie (quantité négative)');
      }
      if (dto.quantite < 0 && p.suiviLot && !dto.lotId) {
        throw new ErreurMetier('LOT_REQUIS', 'Choisissez le lot concerné');
      }
      if (dto.quantite > 0) {
        let numeroLot = dto.numeroLot;
        let datePeremption = dto.datePeremption;
        if (dto.lotId) {
          const [l] = await tx.select().from(lots).where(and(eq(lots.id, dto.lotId), eq(lots.produitId, p.id)));
          if (!l) throw new ErreurMetier('LOT_INTROUVABLE', 'Lot introuvable');
          numeroLot = l.numero || null;
          datePeremption = l.datePeremption;
        }
        await this.entree(tx, {
          produitId: p.id,
          quantite: dto.quantite,
          numeroLot,
          datePeremption,
          type: 'ajustement',
          motif: dto.motif,
          utilisateurId,
        });
      } else {
        await this.sortie(tx, {
          produitId: p.id,
          quantite: -dto.quantite,
          lotId: dto.lotId,
          type: dto.type,
          motif: dto.motif,
          utilisateurId,
        });
      }
      await this.audit.enregistrer(tx, {
        action: `stock.${dto.type}`,
        utilisateurId,
        appareilId,
        entite: 'produit',
        entiteId: p.id,
        details: { produit: p.designation, quantite: dto.quantite, lotId: dto.lotId ?? null, motif: dto.motif },
      });
      const [apres] = await tx.select({ stock: produits.stock }).from(produits).where(eq(produits.id, p.id));
      return { produitId: p.id, stock: apres.stock };
    });
  }

  // ------------------------------------------------------------------ consultation

  /** État du stock : par produit, avec ses lots. Les coûts ne sont donnés qu'avec la permission couts.voir. */
  async etat(options: { recherche?: string; alertes?: boolean; voirCouts: boolean }) {
    const p = await this.parametres.lire();
    const limitePeremption = aujourdhui(new Date(Date.now() + p.delaiAlertePeremptionJours * 24 * 3600_000));
    const jour = aujourdhui();
    const filtre = options.recherche
      ? sql`(${produits.designation} ILIKE ${'%' + options.recherche + '%'} OR ${produits.code} ILIKE ${'%' + options.recherche + '%'})`
      : sql`true`;
    const liste = await this.db
      .select({
        id: produits.id,
        code: produits.code,
        designation: produits.designation,
        categorie: categories.nom,
        marque: marques.nom,
        suiviLot: produits.suiviLot,
        stock: produits.stock,
        seuilAlerte: produits.seuilAlerte,
        cmpCentimes: produits.cmpCentimes,
      })
      .from(produits)
      .innerJoin(categories, eq(categories.id, produits.categorieId))
      .leftJoin(marques, eq(marques.id, produits.marqueId))
      .where(and(eq(produits.actif, true), filtre))
      .orderBy(asc(produits.designation));
    const tousLots = await this.db.select().from(lots).where(gt(lots.quantite, 0)).orderBy(sql`${lots.datePeremption} ASC NULLS LAST`);

    const resultat = liste.map((pr) => {
      const lotsProduit = tousLots
        .filter((l) => l.produitId === pr.id)
        .map((l) => ({
          id: l.id,
          numero: l.numero,
          datePeremption: l.datePeremption,
          quantite: l.quantite,
          perime: !!l.datePeremption && l.datePeremption < jour,
          bientotPerime: !!l.datePeremption && l.datePeremption >= jour && l.datePeremption <= limitePeremption,
        }));
      const stockBas = pr.seuilAlerte > 0 && pr.stock <= pr.seuilAlerte;
      return {
        id: pr.id,
        code: pr.code,
        designation: pr.designation,
        categorie: pr.categorie,
        marque: pr.marque,
        suiviLot: pr.suiviLot,
        stock: pr.stock,
        seuilAlerte: pr.seuilAlerte,
        stockBas,
        lots: lotsProduit,
        ...(options.voirCouts
          ? { cmp: Math.round(pr.cmpCentimes / 100), valeur: Math.round((pr.stock * pr.cmpCentimes) / 100) }
          : {}),
      };
    });
    const filtres = options.alertes
      ? resultat.filter((r) => r.stockBas || r.lots.some((l) => l.perime || l.bientotPerime))
      : resultat;
    return {
      produits: filtres,
      resume: {
        nbProduits: resultat.length,
        stockBas: resultat.filter((r) => r.stockBas).length,
        lotsBientotPerimes: resultat.reduce((t, r) => t + r.lots.filter((l) => l.bientotPerime).length, 0),
        lotsPerimes: resultat.reduce((t, r) => t + r.lots.filter((l) => l.perime).length, 0),
        ...(options.voirCouts ? { valeurTotale: resultat.reduce((t, r) => t + (r.valeur ?? 0), 0) } : {}),
      },
    };
  }

  async mouvements(produitId: string, voirCouts: boolean, limite = 100) {
    const lignes = await this.db
      .select({
        id: mouvementsStock.id,
        date: mouvementsStock.date,
        type: mouvementsStock.type,
        quantite: mouvementsStock.quantite,
        coutCentimes: mouvementsStock.coutCentimes,
        motif: mouvementsStock.motif,
        documentType: mouvementsStock.documentType,
        documentId: mouvementsStock.documentId,
        lotNumero: lots.numero,
        lotPeremption: lots.datePeremption,
        utilisateurId: mouvementsStock.utilisateurId,
      })
      .from(mouvementsStock)
      .leftJoin(lots, eq(lots.id, mouvementsStock.lotId))
      .where(eq(mouvementsStock.produitId, produitId))
      .orderBy(desc(mouvementsStock.date))
      .limit(Math.min(limite, 500));
    return lignes.map(({ coutCentimes, ...l }) => (voirCouts ? { ...l, cout: Math.round(coutCentimes / 100) } : l));
  }

  /** Lots périmés ou à écouler bientôt, pour le tableau de bord. */
  async lotsAEcouler() {
    const p = await this.parametres.lire();
    const limite = aujourdhui(new Date(Date.now() + p.delaiAlertePeremptionJours * 24 * 3600_000));
    return this.db
      .select({ lotId: lots.id, produit: produits.designation, numero: lots.numero, datePeremption: lots.datePeremption, quantite: lots.quantite })
      .from(lots)
      .innerJoin(produits, eq(produits.id, lots.produitId))
      .where(and(gt(lots.quantite, 0), lte(lots.datePeremption, limite)))
      .orderBy(asc(lots.datePeremption));
  }
}
