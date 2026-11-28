import { z } from 'zod';

/** Lot 2 - produits, fournisseurs, achats, stock (cahier des charges §5.2 à §5.4). */

const texteOptionnel = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const montantFcfa = z.number().int('Montant en FCFA entiers').min(0).max(100_000_000_000);
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

export const categorieSchema = z.object({
  nom: z.string().trim().min(2).max(60),
  type: z.enum(['cosmetique', 'bazar']),
  actif: z.boolean().default(true),
});
export type CategorieDto = z.infer<typeof categorieSchema>;

export const marqueSchema = z.object({ nom: z.string().trim().min(1).max(60) });
export type MarqueDto = z.infer<typeof marqueSchema>;

export const conditionnementSchema = z.object({
  /** Absent : nouveau conditionnement. */
  id: z.string().uuid().optional(),
  nom: z.string().trim().min(1).max(40),
  nbPieces: z.number().int().min(1).max(100_000),
  prixVente: montantFcfa.nullable().optional(),
  actif: z.boolean().default(true),
});
export type ConditionnementDto = z.infer<typeof conditionnementSchema>;

export const codeBarreSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z-]{4,32}$/, 'Code-barres invalide'),
  /** Index du conditionnement dans la liste envoyée (0 = la pièce). */
  conditionnement: z.number().int().min(0).default(0),
});

export const produitSchema = z.object({
  designation: z.string().trim().min(2).max(160),
  categorieId: z.string().uuid('Choisissez une catégorie'),
  marqueId: z.string().uuid().nullable().optional(),
  suiviLot: z.boolean(),
  seuilAlerte: z.number().int().min(0).max(1_000_000).default(0),
  actif: z.boolean().default(true),
  /** Le premier conditionnement est toujours la pièce (1 pièce). */
  conditionnements: z.array(conditionnementSchema).min(1).max(10),
  codesBarres: z.array(codeBarreSchema).max(20).default([]),
});
export type ProduitDto = z.infer<typeof produitSchema>;

export const fournisseurSchema = z.object({
  nom: z.string().trim().min(2).max(120),
  telephone: texteOptionnel(60),
  adresse: texteOptionnel(240),
  nif: texteOptionnel(60),
  notes: texteOptionnel(500),
  actif: z.boolean().default(true),
});
export type FournisseurDto = z.infer<typeof fournisseurSchema>;

export const ligneAchatSchema = z.object({
  produitId: z.string().uuid(),
  conditionnementId: z.string().uuid(),
  quantite: z.number().int().min(1, 'Quantité au moins 1').max(1_000_000),
  prixUnitaire: montantFcfa,
  numeroLot: texteOptionnel(60),
  datePeremption: dateIso.nullable().optional(),
});
export type LigneAchatDto = z.infer<typeof ligneAchatSchema>;

export const achatSchema = z.object({
  fournisseurId: z.string().uuid('Choisissez un fournisseur'),
  date: dateIso,
  referenceFournisseur: texteOptionnel(60),
  notes: texteOptionnel(500),
  montantPaye: montantFcfa.default(0),
  /** Compte qui paie le montant réglé à l'achat (caisse par défaut). */
  comptePaiementId: z.string().uuid().nullable().optional(),
  lignes: z.array(ligneAchatSchema).max(300),
  frais: z.array(z.object({ libelle: z.string().trim().min(1).max(80), montant: montantFcfa })).max(20).default([]),
});
export type AchatDto = z.infer<typeof achatSchema>;

export const ajustementSchema = z.object({
  produitId: z.string().uuid(),
  /** Lot concerné ; obligatoire pour une sortie d'un produit suivi par lot. */
  lotId: z.string().uuid().nullable().optional(),
  type: z.enum(['ajustement', 'casse', 'peremption']),
  /** Positive : pièces retrouvées ; négative : pièces sorties. */
  quantite: z.number().int().refine((q) => q !== 0, 'Quantité non nulle').refine((q) => Math.abs(q) <= 1_000_000),
  motif: z.string().trim().min(3, 'Indiquez le motif').max(300),
  /** Pour une entrée d'un produit suivi par lot. */
  numeroLot: texteOptionnel(60),
  datePeremption: dateIso.nullable().optional(),
});
export type AjustementDto = z.infer<typeof ajustementSchema>;

export const ouvertureInventaireSchema = z.object({
  libelle: z.string().trim().min(3).max(120),
});

export const comptageInventaireSchema = z.object({
  comptages: z.array(z.object({ ligneId: z.string().uuid(), quantiteComptee: z.number().int().min(0).nullable() })).max(10_000),
});
export type ComptageInventaireDto = z.infer<typeof comptageInventaireSchema>;
