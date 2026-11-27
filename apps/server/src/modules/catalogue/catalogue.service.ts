import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CategorieDto, MarqueDto, PERMISSIONS, ProduitDto } from '@somidac/shared';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import {
  achatLignes,
  categories,
  codesBarres,
  conditionnements,
  lots,
  marques,
  produits,
  sequencesDocuments,
  sites,
} from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';

/** Code interne des produits (P-0001) : série unique, non annuelle. */
async function codeProduitSuivant(tx: Tx): Promise<string> {
  const [ligne] = await tx
    .insert(sequencesDocuments)
    .values({ type: 'PRD', annee: 0, derniereValeur: 1 })
    .onConflictDoUpdate({
      target: [sequencesDocuments.type, sequencesDocuments.annee],
      set: { derniereValeur: sql`${sequencesDocuments.derniereValeur} + 1` },
    })
    .returning({ valeur: sequencesDocuments.derniereValeur });
  return `P-${String(ligne.valeur).padStart(4, '0')}`;
}

@Injectable()
export class CatalogueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ catégories et marques

  listerCategories() {
    return this.db.select().from(categories).orderBy(asc(categories.type), asc(categories.nom));
  }

  async enregistrerCategorie(id: string | null, dto: CategorieDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      try {
        const [c] = id
          ? await tx.update(categories).set(dto).where(eq(categories.id, id)).returning()
          : await tx.insert(categories).values(dto).returning();
        if (!c) throw new ErreurMetier('INTROUVABLE', 'Catégorie introuvable', HttpStatus.NOT_FOUND);
        await this.audit.enregistrer(tx, { action: id ? 'categorie.modifiee' : 'categorie.creee', utilisateurId: u.id, appareilId, entite: 'categorie', entiteId: c.id, apres: c });
        return c;
      } catch (e) {
        throw this.doublon(e, 'Une catégorie porte déjà ce nom');
      }
    });
  }

  listerMarques() {
    return this.db.select().from(marques).orderBy(asc(marques.nom));
  }

  async creerMarque(dto: MarqueDto, u: UtilisateurConnecte, appareilId: string) {
    const [existante] = await this.db.select().from(marques).where(sql`lower(${marques.nom}) = lower(${dto.nom})`);
    if (existante) return existante;
    return this.db.transaction(async (tx) => {
      const [m] = await tx.insert(marques).values(dto).returning();
      await this.audit.enregistrer(tx, { action: 'marque.creee', utilisateurId: u.id, appareilId, entite: 'marque', entiteId: m.id, apres: m });
      return m;
    });
  }

  // ------------------------------------------------------------------ produits

  async lister(options: { recherche?: string; categorieId?: string; inclureInactifs?: boolean; voirCouts: boolean }) {
    const conditions = [];
    if (!options.inclureInactifs) conditions.push(eq(produits.actif, true));
    if (options.categorieId) conditions.push(eq(produits.categorieId, options.categorieId));
    if (options.recherche) {
      const motif = `%${options.recherche.trim()}%`;
      const parCode = this.db.select({ id: codesBarres.produitId }).from(codesBarres).where(eq(codesBarres.code, options.recherche.trim()));
      conditions.push(or(ilike(produits.designation, motif), ilike(produits.code, motif), inArray(produits.id, parCode)));
    }
    const liste = await this.db
      .select({ p: produits, categorie: categories.nom, typeCategorie: categories.type, marque: marques.nom })
      .from(produits)
      .innerJoin(categories, eq(categories.id, produits.categorieId))
      .leftJoin(marques, eq(marques.id, produits.marqueId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(produits.designation))
      .limit(1000);
    const ids = liste.map((l) => l.p.id);
    const conds = ids.length ? await this.db.select().from(conditionnements).where(inArray(conditionnements.produitId, ids)).orderBy(asc(conditionnements.nbPieces)) : [];
    return liste.map((l) => this.vue(l.p, { categorie: l.categorie, typeCategorie: l.typeCategorie, marque: l.marque }, conds.filter((c) => c.produitId === l.p.id), [], options.voirCouts));
  }

  async detail(id: string, voirCouts: boolean) {
    const [l] = await this.db
      .select({ p: produits, categorie: categories.nom, typeCategorie: categories.type, marque: marques.nom })
      .from(produits)
      .innerJoin(categories, eq(categories.id, produits.categorieId))
      .leftJoin(marques, eq(marques.id, produits.marqueId))
      .where(eq(produits.id, id));
    if (!l) throw new ErreurMetier('INTROUVABLE', 'Produit introuvable', HttpStatus.NOT_FOUND);
    const conds = await this.db.select().from(conditionnements).where(eq(conditionnements.produitId, id)).orderBy(asc(conditionnements.nbPieces));
    const codes = await this.db.select().from(codesBarres).where(eq(codesBarres.produitId, id));
    const lotsProduit = await this.db
      .select()
      .from(lots)
      .where(and(eq(lots.produitId, id), sql`${lots.quantite} > 0`))
      .orderBy(sql`${lots.datePeremption} ASC NULLS LAST`);
    return {
      ...this.vue(l.p, { categorie: l.categorie, typeCategorie: l.typeCategorie, marque: l.marque }, conds, codes, voirCouts),
      lots: lotsProduit.map((x) => ({ id: x.id, numero: x.numero, datePeremption: x.datePeremption, quantite: x.quantite })),
    };
  }

  /** Recherche par code-barres (scan) : renvoie le produit et le conditionnement scanné. */
  async parCodeBarres(code: string, voirCouts: boolean) {
    const [c] = await this.db.select().from(codesBarres).where(eq(codesBarres.code, code.trim()));
    if (!c) throw new ErreurMetier('CODE_INCONNU', `Aucun produit pour le code-barres ${code}`, HttpStatus.NOT_FOUND);
    return { produit: await this.detail(c.produitId, voirCouts), conditionnementId: c.conditionnementId };
  }

  async creer(dto: ProduitDto, u: UtilisateurConnecte, appareilId: string) {
    this.verifierConditionnements(dto);
    if (dto.conditionnements.some((c) => c.prixVente != null) && !u.permissions.has(PERMISSIONS.PRIX_MODIFIER)) {
      throw new ErreurMetier('PERMISSION_REFUSEE', "Vous n'avez pas le droit de fixer les prix de vente : laissez-les vides", HttpStatus.FORBIDDEN);
    }
    return this.db.transaction(async (tx) => {
      const [site] = await tx.select().from(sites).limit(1);
      const code = await codeProduitSuivant(tx);
      const [p] = await tx
        .insert(produits)
        .values({
          siteId: site.id,
          code,
          designation: dto.designation,
          categorieId: dto.categorieId,
          marqueId: dto.marqueId ?? null,
          suiviLot: dto.suiviLot,
          seuilAlerte: dto.seuilAlerte,
          actif: dto.actif,
          creePar: u.id,
        })
        .returning();
      const conds = await tx
        .insert(conditionnements)
        .values(dto.conditionnements.map((c) => ({ produitId: p.id, nom: c.nom, nbPieces: c.nbPieces, prixVente: c.prixVente ?? null, actif: c.actif })))
        .returning();
      await this.enregistrerCodes(tx, p.id, dto, conds);
      await this.audit.enregistrer(tx, { action: 'produit.cree', utilisateurId: u.id, appareilId, entite: 'produit', entiteId: p.id, apres: { ...dto, code } });
      return { id: p.id, code };
    });
  }

  async modifier(id: string, dto: ProduitDto, u: UtilisateurConnecte, appareilId: string) {
    this.verifierConditionnements(dto);
    return this.db.transaction(async (tx) => {
      const [avant] = await tx.select().from(produits).where(eq(produits.id, id)).for('update');
      if (!avant) throw new ErreurMetier('INTROUVABLE', 'Produit introuvable', HttpStatus.NOT_FOUND);
      const condsAvant = await tx.select().from(conditionnements).where(eq(conditionnements.produitId, id));

      // Changer un prix de vente demande la permission « Modifier les prix de vente ».
      const prixChange = dto.conditionnements.some((c) => {
        const ancien = c.id ? condsAvant.find((x) => x.id === c.id) : undefined;
        return (ancien?.prixVente ?? null) !== (c.prixVente ?? null) && !(ancien === undefined && c.prixVente == null);
      });
      if (prixChange && !u.permissions.has(PERMISSIONS.PRIX_MODIFIER)) {
        throw new ErreurMetier('PERMISSION_REFUSEE', "Vous n'avez pas le droit de modifier les prix de vente", HttpStatus.FORBIDDEN);
      }

      await tx
        .update(produits)
        .set({
          designation: dto.designation,
          categorieId: dto.categorieId,
          marqueId: dto.marqueId ?? null,
          suiviLot: dto.suiviLot,
          seuilAlerte: dto.seuilAlerte,
          actif: dto.actif,
          modifieLe: new Date(),
        })
        .where(eq(produits.id, id));

      const utilises = new Set(
        (await tx.selectDistinct({ id: achatLignes.conditionnementId }).from(achatLignes).where(eq(achatLignes.produitId, id))).map((x) => x.id),
      );
      const conds: (typeof conditionnements.$inferSelect)[] = [];
      for (const c of dto.conditionnements) {
        const ancien = c.id ? condsAvant.find((x) => x.id === c.id) : undefined;
        if (c.id && !ancien) throw new ErreurMetier('CONDITIONNEMENT_INCONNU', 'Conditionnement inconnu');
        if (ancien && ancien.nbPieces !== c.nbPieces && utilises.has(ancien.id)) {
          throw new ErreurMetier(
            'CONDITIONNEMENT_UTILISE',
            `« ${ancien.nom} » a déjà servi à des achats : son nombre de pièces ne peut plus changer. Créez un nouveau conditionnement.`,
          );
        }
        const [r] = ancien
          ? await tx.update(conditionnements).set({ nom: c.nom, nbPieces: c.nbPieces, prixVente: c.prixVente ?? null, actif: c.actif }).where(eq(conditionnements.id, ancien.id)).returning()
          : await tx.insert(conditionnements).values({ produitId: id, nom: c.nom, nbPieces: c.nbPieces, prixVente: c.prixVente ?? null, actif: c.actif }).returning();
        conds.push(r);
      }
      // Un conditionnement retiré de la liste est désactivé (jamais supprimé : il peut figurer sur des documents).
      const gardes = new Set(conds.map((c) => c.id));
      for (const c of condsAvant.filter((x) => !gardes.has(x.id))) {
        await tx.update(conditionnements).set({ actif: false }).where(eq(conditionnements.id, c.id));
      }
      await tx.delete(codesBarres).where(eq(codesBarres.produitId, id));
      await this.enregistrerCodes(tx, id, dto, conds);

      await this.audit.enregistrer(tx, {
        action: prixChange ? 'produit.prix_modifies' : 'produit.modifie',
        utilisateurId: u.id,
        appareilId,
        entite: 'produit',
        entiteId: id,
        avant: { ...avant, conditionnements: condsAvant.map((c) => ({ nom: c.nom, nbPieces: c.nbPieces, prixVente: c.prixVente })) },
        apres: dto,
      });
      return { id };
    });
  }

  // ------------------------------------------------------------------ outils

  private verifierConditionnements(dto: ProduitDto) {
    if (dto.conditionnements[0].nbPieces !== 1) {
      throw new ErreurMetier('CONDITIONNEMENT_PIECE', 'Le premier conditionnement doit être la pièce (1 pièce)');
    }
    const noms = dto.conditionnements.map((c) => c.nom.toLowerCase());
    if (new Set(noms).size !== noms.length) throw new ErreurMetier('CONDITIONNEMENT_DOUBLON', 'Deux conditionnements portent le même nom');
    const codes = dto.codesBarres.map((c) => c.code);
    if (new Set(codes).size !== codes.length) throw new ErreurMetier('CODE_BARRE_DOUBLON', 'Le même code-barres est saisi deux fois');
    for (const c of dto.codesBarres) {
      if (c.conditionnement >= dto.conditionnements.length) throw new ErreurMetier('CODE_BARRE_INVALIDE', 'Code-barres rattaché à un conditionnement inexistant');
    }
  }

  private async enregistrerCodes(tx: Tx, produitId: string, dto: ProduitDto, conds: { id: string }[]) {
    if (!dto.codesBarres.length) return;
    const pris = await tx
      .select({ code: codesBarres.code, produit: produits.designation })
      .from(codesBarres)
      .innerJoin(produits, eq(produits.id, codesBarres.produitId))
      .where(inArray(codesBarres.code, dto.codesBarres.map((c) => c.code)));
    if (pris.length) {
      throw new ErreurMetier('CODE_BARRE_PRIS', `Le code-barres ${pris[0].code} est déjà utilisé par « ${pris[0].produit} »`, HttpStatus.CONFLICT);
    }
    await tx.insert(codesBarres).values(dto.codesBarres.map((c) => ({ code: c.code, produitId, conditionnementId: conds[c.conditionnement]?.id ?? null })));
  }

  private vue(
    p: typeof produits.$inferSelect,
    noms: { categorie: string; typeCategorie: string; marque: string | null },
    conds: (typeof conditionnements.$inferSelect)[],
    codes: (typeof codesBarres.$inferSelect)[],
    voirCouts: boolean,
  ) {
    return {
      id: p.id,
      code: p.code,
      designation: p.designation,
      categorieId: p.categorieId,
      categorie: noms.categorie,
      typeCategorie: noms.typeCategorie,
      marqueId: p.marqueId,
      marque: noms.marque,
      suiviLot: p.suiviLot,
      seuilAlerte: p.seuilAlerte,
      stock: p.stock,
      actif: p.actif,
      conditionnements: conds.map((c) => ({ id: c.id, nom: c.nom, nbPieces: c.nbPieces, prixVente: c.prixVente, actif: c.actif })),
      codesBarres: codes.map((c) => ({ code: c.code, conditionnementId: c.conditionnementId })),
      ...(voirCouts ? { cmp: Math.round(p.cmpCentimes / 100) } : {}),
    };
  }

  private doublon(e: unknown, message: string) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') return new ErreurMetier('DOUBLON', message, HttpStatus.CONFLICT);
    return e;
  }
}
