import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CategorieDepenseDto, DepenseDto } from '@somidac/shared';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db } from '../../noyau/base/base';
import { categoriesDepenses, comptesTresorerie, depenses, piecesJointes, utilisateurs } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { SequencesService } from '../../noyau/sequences/sequences.service';
import { lendemain, TresorerieService } from './tresorerie.service';

@Injectable()
export class DepensesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tresorerie: TresorerieService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditService,
  ) {}

  listerCategories() {
    return this.db.select().from(categoriesDepenses).orderBy(asc(categoriesDepenses.nom));
  }

  async enregistrerCategorie(id: string | null, dto: CategorieDepenseDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [doublon] = await tx.select({ id: categoriesDepenses.id }).from(categoriesDepenses).where(sql`lower(${categoriesDepenses.nom}) = lower(${dto.nom})`);
      if (doublon && doublon.id !== id) throw new ErreurMetier('DOUBLON', 'Une catégorie porte déjà ce nom', HttpStatus.CONFLICT);
      const [c] = id
        ? await tx.update(categoriesDepenses).set(dto).where(eq(categoriesDepenses.id, id)).returning()
        : await tx.insert(categoriesDepenses).values(dto).returning();
      if (!c) throw new ErreurMetier('INTROUVABLE', 'Catégorie introuvable', HttpStatus.NOT_FOUND);
      await this.audit.enregistrer(tx, { action: id ? 'categorie_depense.modifiee' : 'categorie_depense.creee', utilisateurId: u.id, appareilId, entite: 'categorie_depense', entiteId: c.id, apres: c });
      return c;
    });
  }

  /** Dépense (§5.6) : numéro DEP (R6), l'argent sort du compte choisi. */
  async creer(dto: DepenseDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [cat] = await tx.select().from(categoriesDepenses).where(eq(categoriesDepenses.id, dto.categorieId));
      if (!cat || !cat.actif) throw new ErreurMetier('CATEGORIE_INCONNUE', 'Catégorie de dépense inconnue ou désactivée');
      const numero = await this.sequences.suivant(tx, 'DEP', new Date(`${dto.date}T12:00:00`));
      const [d] = await tx.insert(depenses).values({ ...dto, numero, creePar: u.id }).returning();
      await this.tresorerie.operation(tx, {
        compteId: dto.compteId,
        montant: -dto.montant,
        type: 'depense',
        document: { type: 'depense', id: d.id },
        libelle: `Dépense ${numero} - ${cat.nom} : ${dto.libelle}`,
        utilisateurId: u.id,
      });
      await this.audit.enregistrer(tx, { action: 'depense.creee', utilisateurId: u.id, appareilId, entite: 'depense', entiteId: d.id, details: { numero, categorie: cat.nom, montant: dto.montant, libelle: dto.libelle } });
      return { id: d.id, numero };
    });
  }

  async annuler(id: string, motif: string, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(depenses).where(eq(depenses.id, id)).for('update');
      if (!d) throw new ErreurMetier('INTROUVABLE', 'Dépense introuvable', HttpStatus.NOT_FOUND);
      if (d.statut === 'annule') throw new ErreurMetier('DEJA_ANNULE', 'Cette dépense est déjà annulée', HttpStatus.CONFLICT);
      await this.tresorerie.operation(tx, {
        compteId: d.compteId,
        montant: d.montant,
        type: 'annulation',
        document: { type: 'depense', id },
        libelle: `Annulation de la dépense ${d.numero} : ${motif}`,
        utilisateurId: u.id,
        correction: true,
      });
      await tx.update(depenses).set({ statut: 'annule', motifAnnulation: motif, annulePar: u.id, annuleLe: new Date() }).where(eq(depenses.id, id));
      await this.audit.enregistrer(tx, { action: 'depense.annulee', utilisateurId: u.id, appareilId, entite: 'depense', entiteId: id, details: { numero: d.numero, montant: d.montant, motif } });
      return { id, statut: 'annule' };
    });
  }

  async lister(o: { du?: string; au?: string; categorieId?: string }) {
    const conditions = [];
    if (o.du) conditions.push(gte(depenses.date, o.du));
    if (o.au) conditions.push(lt(depenses.date, lendemain(o.au)));
    if (o.categorieId) conditions.push(eq(depenses.categorieId, o.categorieId));
    return this.db
      .select({
        id: depenses.id,
        numero: depenses.numero,
        date: depenses.date,
        montant: depenses.montant,
        libelle: depenses.libelle,
        beneficiaire: depenses.beneficiaire,
        statut: depenses.statut,
        motifAnnulation: depenses.motifAnnulation,
        categorieId: depenses.categorieId,
        categorie: categoriesDepenses.nom,
        compte: comptesTresorerie.nom,
        par: utilisateurs.nomComplet,
        justificatifs: sql<number>`(SELECT count(*)::int FROM ${piecesJointes} WHERE ${piecesJointes.documentType} = 'depense' AND ${piecesJointes.documentId} = ${depenses.id})`,
      })
      .from(depenses)
      .innerJoin(categoriesDepenses, eq(categoriesDepenses.id, depenses.categorieId))
      .innerJoin(comptesTresorerie, eq(comptesTresorerie.id, depenses.compteId))
      .leftJoin(utilisateurs, eq(utilisateurs.id, depenses.creePar))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(depenses.date), desc(depenses.numero))
      .limit(1_000);
  }
}
