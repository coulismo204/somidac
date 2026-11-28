import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AchatDto } from '@somidac/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { achatFrais, achatLignes, achats, comptesTresorerie, conditionnements, fournisseurs, produits } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import { SequencesService } from '../../noyau/sequences/sequences.service';
import { StockService } from '../stock/stock.service';
import { PaiementsService } from '../tresorerie/paiements.service';

/**
 * Règle R1 : les frais d'approche sont répartis sur les lignes au prorata de leur montant ;
 * la dernière ligne reçoit le reste, pour que la somme des parts égale exactement les frais.
 */
export function repartirFrais(montants: number[], frais: number): number[] {
  const total = montants.reduce((t, m) => t + m, 0);
  if (frais === 0 || total === 0) return montants.map(() => 0);
  const parts = montants.map((m) => Math.round((frais * m) / total));
  const ecart = frais - parts.reduce((t, p) => t + p, 0);
  parts[parts.length - 1] += ecart;
  return parts;
}

@Injectable()
export class AchatsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly stock: StockService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditService,
    private readonly paiements: PaiementsService,
  ) {}

  async lister(statut?: string) {
    return this.db
      .select({
        id: achats.id,
        numero: achats.numero,
        date: achats.date,
        statut: achats.statut,
        fournisseurId: achats.fournisseurId,
        fournisseur: fournisseurs.nom,
        referenceFournisseur: achats.referenceFournisseur,
        total: achats.total,
        montantPaye: achats.montantPaye,
        creeLe: achats.creeLe,
      })
      .from(achats)
      .innerJoin(fournisseurs, eq(fournisseurs.id, achats.fournisseurId))
      .where(statut ? eq(achats.statut, statut as 'brouillon' | 'valide' | 'annule') : undefined)
      .orderBy(desc(achats.date), desc(achats.creeLe))
      .limit(500);
  }

  async detail(id: string) {
    const [a] = await this.db
      .select({ achat: achats, fournisseur: fournisseurs.nom })
      .from(achats)
      .innerJoin(fournisseurs, eq(fournisseurs.id, achats.fournisseurId))
      .where(eq(achats.id, id));
    if (!a) throw new ErreurMetier('INTROUVABLE', 'Achat introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({ l: achatLignes, produit: produits.designation, codeProduit: produits.code, suiviLot: produits.suiviLot, conditionnement: conditionnements.nom, nbPieces: conditionnements.nbPieces })
      .from(achatLignes)
      .innerJoin(produits, eq(produits.id, achatLignes.produitId))
      .innerJoin(conditionnements, eq(conditionnements.id, achatLignes.conditionnementId))
      .where(eq(achatLignes.achatId, id))
      .orderBy(asc(achatLignes.ordre));
    const frais = await this.db.select().from(achatFrais).where(eq(achatFrais.achatId, id));
    return {
      ...a.achat,
      fournisseur: a.fournisseur,
      lignes: lignes.map((x) => ({
        ...x.l,
        produit: x.produit,
        codeProduit: x.codeProduit,
        suiviLot: x.suiviLot,
        conditionnement: x.conditionnement,
        nbPieces: x.nbPieces,
        coutPiece: x.l.coutPieceCentimes == null ? null : Math.round(x.l.coutPieceCentimes / 100),
      })),
      frais,
    };
  }

  async creer(dto: AchatDto, utilisateurId: string) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.insert(achats).values({ fournisseurId: dto.fournisseurId, date: dto.date, creePar: utilisateurId }).returning();
      await this.ecrireContenu(tx, a.id, dto);
      return { id: a.id };
    });
  }

  async modifier(id: string, dto: AchatDto) {
    return this.db.transaction(async (tx) => {
      await this.brouillon(tx, id);
      await this.ecrireContenu(tx, id, dto);
      return { id };
    });
  }

  /** Un brouillon n'a jamais touché au stock ni consommé de numéro : il peut être supprimé. */
  async supprimer(id: string) {
    return this.db.transaction(async (tx) => {
      await this.brouillon(tx, id);
      await tx.delete(achats).where(eq(achats.id, id));
      return { ok: true };
    });
  }

  /** Validation (§5.3) : numéro ACH, frais répartis, entrée en stock lot par lot, CMP recalculé (R1). */
  async valider(id: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const a = await this.brouillon(tx, id);
      const lignes = await tx.select().from(achatLignes).where(eq(achatLignes.achatId, id)).orderBy(asc(achatLignes.ordre));
      if (!lignes.length) throw new ErreurMetier('ACHAT_VIDE', "L'achat ne contient aucune ligne");
      const frais = await tx.select().from(achatFrais).where(eq(achatFrais.achatId, id));
      const conds = await tx.select().from(conditionnements).where(inArray(conditionnements.id, lignes.map((l) => l.conditionnementId)));
      const prods = await tx.select().from(produits).where(inArray(produits.id, lignes.map((l) => l.produitId)));

      const montants = lignes.map((l) => l.quantite * l.prixUnitaire);
      const totalFrais = frais.reduce((t, f) => t + f.montant, 0);
      const parts = repartirFrais(montants, totalFrais);
      const totalMarchandises = montants.reduce((t, m) => t + m, 0);
      const total = totalMarchandises + totalFrais;
      if (a.montantPaye > total) throw new ErreurMetier('PAIEMENT_SUPERIEUR', 'Le montant payé dépasse le total de l’achat');

      const numero = await this.sequences.suivant(tx, 'ACH', new Date(`${a.date}T12:00:00`));
      for (const [i, l] of lignes.entries()) {
        const c = conds.find((x) => x.id === l.conditionnementId)!;
        const p = prods.find((x) => x.id === l.produitId)!;
        if (c.produitId !== p.id) throw new ErreurMetier('CONDITIONNEMENT_INVALIDE', `Conditionnement incohérent pour « ${p.designation} »`);
        if (p.suiviLot && (!l.numeroLot || !l.datePeremption)) {
          throw new ErreurMetier('LOT_REQUIS', `« ${p.designation} » : numéro de lot et date de péremption obligatoires`);
        }
        const pieces = l.quantite * c.nbPieces;
        const coutPieceCentimes = Math.round(((montants[i] + parts[i]) * 100) / pieces);
        const lotId = await this.stock.entree(tx, {
          produitId: p.id,
          quantite: pieces,
          coutCentimes: coutPieceCentimes,
          numeroLot: l.numeroLot,
          datePeremption: l.datePeremption,
          type: 'achat',
          document: { type: 'achat', id },
          utilisateurId,
        });
        await tx
          .update(achatLignes)
          .set({ quantitePieces: pieces, montant: montants[i], partFrais: parts[i], coutPieceCentimes, lotId })
          .where(eq(achatLignes.id, l.id));
      }
      // Le montant réglé au grossiste devient un vrai paiement (PAI), qui sort du compte choisi (lot 4).
      await tx
        .update(achats)
        .set({ numero, statut: 'valide', totalMarchandises, totalFrais, total, montantPaye: 0, validePar: utilisateurId, valideLe: new Date() })
        .where(eq(achats.id, id));
      if (a.montantPaye > 0) {
        const compteId = a.comptePaiementId ?? (await this.caisseParDefaut(tx));
        await this.paiements.payerFournisseurDans(
          tx,
          { fournisseurId: a.fournisseurId, compteId, reference: a.referenceFournisseur, notes: `Réglé à l’achat ${numero}`, affectations: [{ achatId: id, montant: a.montantPaye }] },
          utilisateurId,
          appareilId,
        );
      }
      await this.audit.enregistrer(tx, {
        action: 'achat.valide',
        utilisateurId,
        appareilId,
        entite: 'achat',
        entiteId: id,
        details: { numero, total, totalFrais, lignes: lignes.length },
      });
      return { id, numero, total };
    });
  }

  // ------------------------------------------------------------------ outils

  private async caisseParDefaut(tx: Tx): Promise<string> {
    const [c] = await tx
      .select({ id: comptesTresorerie.id })
      .from(comptesTresorerie)
      .where(and(eq(comptesTresorerie.type, 'caisse'), eq(comptesTresorerie.actif, true)))
      .orderBy(asc(comptesTresorerie.creeLe))
      .limit(1);
    if (!c) throw new ErreurMetier('COMPTE_REQUIS', 'Choisissez le compte qui paie le grossiste');
    return c.id;
  }

  private async brouillon(tx: Tx, id: string) {
    const [a] = await tx.select().from(achats).where(eq(achats.id, id)).for('update');
    if (!a) throw new ErreurMetier('INTROUVABLE', 'Achat introuvable', HttpStatus.NOT_FOUND);
    if (a.statut !== 'brouillon') {
      throw new ErreurMetier('ACHAT_VALIDE', 'Un achat validé ne peut plus être modifié (règle R7)', HttpStatus.CONFLICT);
    }
    return a;
  }

  private async ecrireContenu(tx: Tx, id: string, dto: AchatDto) {
    const [f] = await tx.select({ id: fournisseurs.id }).from(fournisseurs).where(and(eq(fournisseurs.id, dto.fournisseurId), eq(fournisseurs.actif, true)));
    if (!f) throw new ErreurMetier('FOURNISSEUR_INCONNU', 'Fournisseur inconnu ou désactivé');
    const montants = dto.lignes.map((l) => l.quantite * l.prixUnitaire);
    const totalFrais = dto.frais.reduce((t, x) => t + x.montant, 0);
    const totalMarchandises = montants.reduce((t, m) => t + m, 0);
    await tx
      .update(achats)
      .set({
        fournisseurId: dto.fournisseurId,
        date: dto.date,
        referenceFournisseur: dto.referenceFournisseur ?? null,
        notes: dto.notes ?? null,
        montantPaye: dto.montantPaye,
        comptePaiementId: dto.comptePaiementId ?? null,
        totalMarchandises,
        totalFrais,
        total: totalMarchandises + totalFrais,
      })
      .where(eq(achats.id, id));
    await tx.delete(achatLignes).where(eq(achatLignes.achatId, id));
    await tx.delete(achatFrais).where(eq(achatFrais.achatId, id));
    if (dto.lignes.length) {
      await tx.insert(achatLignes).values(
        dto.lignes.map((l, i) => ({
          achatId: id,
          ordre: i,
          produitId: l.produitId,
          conditionnementId: l.conditionnementId,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          numeroLot: l.numeroLot ?? null,
          datePeremption: l.datePeremption ?? null,
        })),
      );
    }
    if (dto.frais.length) await tx.insert(achatFrais).values(dto.frais.map((x) => ({ achatId: id, libelle: x.libelle, montant: x.montant })));
  }
}
