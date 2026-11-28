import { z } from 'zod';

/**
 * Lot 4 - trésorerie (cahier des charges §5.6, §10.3) : comptes, encaissements, paiements
 * fournisseurs, dépenses, transferts et clôture de caisse.
 */

const texteOptionnel = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const montantPositif = z.number().int('Montant en FCFA entiers').min(1, 'Montant au moins 1 FCFA').max(100_000_000_000);
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

export const TYPES_COMPTES = {
  caisse: 'Caisse espèces',
  mobile_money: 'Mobile Money',
  banque: 'Banque',
} as const;
export type TypeCompte = keyof typeof TYPES_COMPTES;

export const compteSchema = z.object({
  nom: z.string().trim().min(2).max(80),
  type: z.enum(['caisse', 'mobile_money', 'banque']),
  /** Numéro de compte bancaire ou numéro Mobile Money. */
  reference: texteOptionnel(80),
  /** Solde au démarrage ; modifiable tant que le compte n'a servi à aucune opération. */
  soldeInitial: z.number().int().min(0).max(100_000_000_000).default(0),
  actif: z.boolean().default(true),
});
export type CompteDto = z.infer<typeof compteSchema>;

const messageAffectation = 'Choisissez au moins un document à régler';

/** Encaissement d'un client (R10) : réparti sur une ou plusieurs factures. */
export const encaissementSchema = z.object({
  clientId: z.string().uuid('Choisissez un client'),
  compteId: z.string().uuid('Choisissez le compte qui reçoit l’argent'),
  /** N° de transaction Mobile Money, de chèque ou de virement. */
  reference: texteOptionnel(80),
  notes: texteOptionnel(300),
  affectations: z.array(z.object({ factureId: z.string().uuid(), montant: montantPositif })).min(1, messageAffectation).max(200),
});
export type EncaissementDto = z.infer<typeof encaissementSchema>;

/** Paiement d'un fournisseur : réparti sur un ou plusieurs achats. */
export const paiementFournisseurSchema = z.object({
  fournisseurId: z.string().uuid('Choisissez un fournisseur'),
  compteId: z.string().uuid('Choisissez le compte qui paie'),
  reference: texteOptionnel(80),
  notes: texteOptionnel(300),
  affectations: z.array(z.object({ achatId: z.string().uuid(), montant: montantPositif })).min(1, messageAffectation).max(200),
});
export type PaiementFournisseurDto = z.infer<typeof paiementFournisseurSchema>;

export const annulationSchema = z.object({ motif: z.string().trim().min(3, 'Indiquez le motif de l’annulation').max(300) });
export type AnnulationDto = z.infer<typeof annulationSchema>;

export const categorieDepenseSchema = z.object({ nom: z.string().trim().min(2).max(60), actif: z.boolean().default(true) });
export type CategorieDepenseDto = z.infer<typeof categorieDepenseSchema>;

export const depenseSchema = z.object({
  date: dateIso,
  categorieId: z.string().uuid('Choisissez une catégorie'),
  compteId: z.string().uuid('Choisissez le compte utilisé'),
  montant: montantPositif,
  libelle: z.string().trim().min(2, 'Décrivez la dépense').max(160),
  beneficiaire: texteOptionnel(120),
});
export type DepenseDto = z.infer<typeof depenseSchema>;

export const transfertSchema = z
  .object({
    compteSourceId: z.string().uuid(),
    compteDestinationId: z.string().uuid(),
    montant: montantPositif,
    libelle: texteOptionnel(160),
  })
  .refine((t) => t.compteSourceId !== t.compteDestinationId, 'Choisissez deux comptes différents');
export type TransfertDto = z.infer<typeof transfertSchema>;

/** Clôture de caisse (§10.3) : le caissier saisit ce qu'il a compté, sans voir le solde attendu. */
export const clotureSchema = z.object({
  compteId: z.string().uuid(),
  montantCompte: z.number().int().min(0).max(100_000_000_000),
  justification: texteOptionnel(300),
});
export type ClotureDto = z.infer<typeof clotureSchema>;

export const decisionClotureSchema = z.object({
  decision: z.enum(['valider', 'refuser']),
  commentaire: texteOptionnel(300),
});
export type DecisionClotureDto = z.infer<typeof decisionClotureSchema>;

/** Photo d'un justificatif (dépense, facture du grossiste) : image réduite par l'écran avant l'envoi. */
export const TYPES_PIECES_JOINTES = ['depense', 'achat'] as const;
export const pieceJointeSchema = z.object({
  documentType: z.enum(TYPES_PIECES_JOINTES),
  documentId: z.string().uuid(),
  nom: z.string().trim().min(1).max(120),
  typeMime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Contenu en base 64 (au plus 2 Mo d'image). */
  contenu: z.string().min(10).max(2_800_000).regex(/^[A-Za-z0-9+/=]+$/, 'Contenu invalide'),
});
export type PieceJointeDto = z.infer<typeof pieceJointeSchema>;

/** Libellés des opérations du journal de trésorerie. */
export const TYPES_OPERATIONS_TRESORERIE = {
  ouverture: 'Solde d’ouverture',
  encaissement: 'Encaissement client',
  paiement_fournisseur: 'Paiement fournisseur',
  depense: 'Dépense',
  transfert: 'Transfert',
  ecart_cloture: 'Écart de clôture',
  annulation: 'Annulation',
} as const;
export type TypeOperationTresorerie = keyof typeof TYPES_OPERATIONS_TRESORERIE;
