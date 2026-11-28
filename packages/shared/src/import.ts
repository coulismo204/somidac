import { z } from 'zod';

/**
 * Lot 6 - mise en service : import du fichier Excel de départ (produits, fournisseurs, clients,
 * stock d'ouverture). Chaque ligne garde son numéro de ligne Excel pour signaler les erreurs.
 */

const texte = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const montant = z.number().int('Montant en FCFA entiers').min(0).max(100_000_000_000);
const ligne = z.number().int().min(1);

export const FEUILLES_IMPORT = {
  produits: 'Produits',
  fournisseurs: 'Fournisseurs',
  clients: 'Clients',
  stock: 'Stock d’ouverture',
} as const;
export type FeuilleImport = keyof typeof FEUILLES_IMPORT;

export const produitImportSchema = z.object({
  ligne,
  designation: z.string().trim().min(2, 'Désignation manquante').max(160),
  categorie: z.string().trim().min(2, 'Catégorie manquante').max(60),
  /** Pour une catégorie qui n'existe pas encore. */
  typeCategorie: z.enum(['cosmetique', 'bazar']).nullable().optional(),
  marque: texte(60),
  suiviLot: z.boolean(),
  seuilAlerte: z.number().int().min(0).max(1_000_000).default(0),
  prixPiece: montant.nullable().optional(),
  codeBarrePiece: texte(32),
  conditionnement: texte(40),
  piecesParConditionnement: z.number().int().min(2, 'Un conditionnement contient au moins 2 pièces').max(100_000).nullable().optional(),
  prixConditionnement: montant.nullable().optional(),
  codeBarreConditionnement: texte(32),
});
export type ProduitImport = z.infer<typeof produitImportSchema>;

export const fournisseurImportSchema = z.object({
  ligne,
  nom: z.string().trim().min(2, 'Nom manquant').max(120),
  telephone: texte(60),
  adresse: texte(240),
  nif: texte(60),
});

export const clientImportSchema = z.object({
  ligne,
  raisonSociale: z.string().trim().min(2, 'Raison sociale manquante').max(160),
  type: z.enum(['supermarche', 'boutique', 'revendeur', 'particulier']),
  contact: texte(120),
  telephone: texte(60),
  adresse: texte(240),
  nif: texte(60),
  blSansPrix: z.boolean().default(false),
});

export const stockImportSchema = z.object({
  ligne,
  /** Désignation ou code interne (P-0001) du produit. */
  produit: z.string().trim().min(1, 'Produit manquant').max(160),
  quantite: z.number().int('Quantité en pièces entières').min(1, 'Quantité au moins 1').max(10_000_000),
  /** Coût d'achat d'une pièce, frais compris (FCFA). */
  coutUnitaire: z.number().min(0).max(100_000_000),
  numeroLot: texte(60),
  datePeremption: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de péremption invalide').nullable().optional(),
});

export const importSchema = z.object({
  /** Vrai : vérifie tout sans rien enregistrer. */
  verifierSeulement: z.boolean(),
  produits: z.array(produitImportSchema).max(10_000).default([]),
  fournisseurs: z.array(fournisseurImportSchema).max(5_000).default([]),
  clients: z.array(clientImportSchema).max(5_000).default([]),
  stock: z.array(stockImportSchema).max(20_000).default([]),
});
export type ImportDto = z.infer<typeof importSchema>;

export interface ErreurImport {
  feuille: FeuilleImport;
  ligne: number;
  message: string;
}

export interface ResultatImport {
  valide: boolean;
  enregistre: boolean;
  erreurs: ErreurImport[];
  avertissements: ErreurImport[];
  compte: { produits: number; categories: number; marques: number; fournisseurs: number; clients: number; lignesStock: number; piecesStock: number; valeurStock: number };
}
