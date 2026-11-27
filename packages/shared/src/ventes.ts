import { z } from 'zod';

/**
 * Lot 3 - clients, prix particuliers, bons de livraison, factures et avoirs (cahier des charges §5.5).
 * Les calculs de montants sont ici pour que le serveur (qui fait foi) et les écrans (aperçu pendant
 * la saisie) donnent exactement les mêmes chiffres (règles R3, R8, R9).
 */

const texteOptionnel = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const montantFcfa = z.number().int('Montant en FCFA entiers').min(0).max(100_000_000_000);
const dateIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const pourcentage = z.number().min(0, 'Remise entre 0 et 100 %').max(100, 'Remise entre 0 et 100 %');

export const TYPES_CLIENTS = {
  supermarche: 'Supermarché',
  boutique: 'Boutique',
  revendeur: 'Revendeur',
  particulier: 'Particulier',
} as const;
export type TypeClient = keyof typeof TYPES_CLIENTS;

export const clientSchema = z.object({
  raisonSociale: z.string().trim().min(2, 'Raison sociale trop courte').max(160),
  type: z.enum(['supermarche', 'boutique', 'revendeur', 'particulier']),
  contact: texteOptionnel(120),
  telephone: texteOptionnel(60),
  email: z.string().trim().email('E-mail invalide').max(160).optional().nullable().or(z.literal('')).transform((v) => v || null),
  adresse: texteOptionnel(240),
  nif: texteOptionnel(60),
  /** Comptant par défaut ; le crédit n'est possible que si le module « Crédit client » est actif. */
  conditionPaiement: z.enum(['comptant', 'credit']).default('comptant'),
  delaiPaiementJours: z.number().int().min(0).max(180).default(0),
  /** Bon de livraison imprimé sans les prix (§8). */
  blSansPrix: z.boolean().default(false),
  notes: texteOptionnel(500),
  actif: z.boolean().default(true),
});
export type ClientDto = z.infer<typeof clientSchema>;

/** Prix particuliers d'un client : la liste envoyée remplace la précédente. */
export const prixClientSchema = z.object({
  prix: z.array(z.object({ conditionnementId: z.string().uuid(), prix: montantFcfa })).max(5_000),
});
export type PrixClientDto = z.infer<typeof prixClientSchema>;

export const ligneLivraisonSchema = z.object({
  produitId: z.string().uuid(),
  conditionnementId: z.string().uuid(),
  quantite: z.number().int().min(1, 'Quantité au moins 1').max(100_000),
  remisePct: pourcentage.default(0),
});
export type LigneLivraisonDto = z.infer<typeof ligneLivraisonSchema>;

export const livraisonSchema = z.object({
  clientId: z.string().uuid('Choisissez un client'),
  date: dateIso,
  /** Numéro de commande du client (Bon Prix), rappelé sur le bon et la facture. */
  referenceClient: texteOptionnel(60),
  notes: texteOptionnel(500),
  remiseGlobalePct: pourcentage.default(0),
  lignes: z.array(ligneLivraisonSchema).max(300),
});
export type LivraisonDto = z.infer<typeof livraisonSchema>;

/** Réception chez le client : quantités réellement acceptées, les refus reviennent en stock. */
export const receptionSchema = z.object({
  lignes: z
    .array(z.object({ ligneId: z.string().uuid(), quantiteAcceptee: z.number().int().min(0).max(100_000), motifRefus: texteOptionnel(200) }))
    .min(1)
    .max(300),
});
export type ReceptionDto = z.infer<typeof receptionSchema>;

export const avoirSchema = z.object({
  motif: z.string().trim().min(3, 'Indiquez le motif du retour').max(300),
  lignes: z
    .array(
      z.object({
        factureLigneId: z.string().uuid(),
        quantite: z.number().int().min(1).max(100_000),
        /** La marchandise revient en stock, ou part en casse selon son état. */
        destination: z.enum(['stock', 'casse']),
      }),
    )
    .min(1, 'Choisissez au moins une ligne à retourner')
    .max(300),
});
export type AvoirDto = z.infer<typeof avoirSchema>;

// ------------------------------------------------------------------ calculs (R3, R8, R9)

/** Points de base : 10 000 = 100 %. */
export const BP = 10_000;

export function pctVersBp(pct: number): number {
  return Math.round(pct * 100);
}

/** Montant net d'une ligne, arrondi au franc (R8) : quantité × prix, moins la remise arrondie au franc. */
export function montantLigne(quantite: number, prixUnitaire: number, remiseBp = 0): number {
  const brut = quantite * prixUnitaire;
  return brut - Math.round((brut * remiseBp) / BP);
}

/** Remise effective d'une ligne quand s'ajoute la remise sur le total (pour le contrôle du plafond, R3). */
export function remiseCumuleeBp(remiseLigneBp: number, remiseGlobaleBp: number): number {
  return BP - Math.round(((BP - remiseLigneBp) * (BP - remiseGlobaleBp)) / BP);
}

export interface Totaux {
  totalLignes: number;
  remiseGlobale: number;
  totalHT: number;
  tva: number;
  totalTTC: number;
}

/** Totaux d'un document : lignes additionnées, remise sur le total, TVA si activée (R8, R9). */
export function calculerTotaux(montantsLignes: number[], remiseGlobaleBp: number, tauxTvaBp: number): Totaux {
  const totalLignes = montantsLignes.reduce((t, m) => t + m, 0);
  const remiseGlobale = Math.round((totalLignes * remiseGlobaleBp) / BP);
  const totalHT = totalLignes - remiseGlobale;
  const tva = Math.round((totalHT * tauxTvaBp) / BP);
  return { totalLignes, remiseGlobale, totalHT, tva, totalTTC: totalHT + tva };
}

/**
 * Part d'un montant pour une fraction, calculée en cumulé : la somme des parts successives
 * (avoirs partiels) retombe exactement sur le montant total quand tout est rendu.
 */
export function partCumulee(montant: number, base: number, dejaPris: number, ajout: number): number {
  if (base <= 0) return 0;
  return Math.round((montant * (dejaPris + ajout)) / base) - Math.round((montant * dejaPris) / base);
}

// ------------------------------------------------------------------ montant en lettres (facture, §8)

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function moinsDeCent(n: number, final: boolean): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    if (d === 7 && u === 1) return 'soixante et onze';
    return `${DIZAINES[d]}-${UNITES[10 + u]}`;
  }
  if (u === 0) return d === 8 && final ? 'quatre-vingts' : DIZAINES[d];
  if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

/** `final` : faux devant « mille », qui empêche « cents » et « quatre-vingts » de prendre un s. */
function moinsDeMille(n: number, final: boolean): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const mots: string[] = [];
  if (c > 0) mots.push(c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && final ? 's' : ''}`);
  if (r > 0) mots.push(moinsDeCent(r, final));
  return mots.join(' ');
}

/** 125 000 → « cent vingt-cinq mille » (orthographe traditionnelle). */
export function nombreEnLettres(valeur: number): string {
  const n = Math.round(Math.abs(valeur));
  if (n === 0) return 'zéro';
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const milliers = Math.floor((n % 1e6) / 1e3);
  const reste = n % 1e3;
  const mots: string[] = [];
  if (milliards) mots.push(`${nombreEnLettres(milliards)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions) mots.push(`${moinsDeMille(millions, true)} million${millions > 1 ? 's' : ''}`);
  if (milliers) mots.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`);
  if (reste) mots.push(moinsDeMille(reste, true));
  return (valeur < 0 ? 'moins ' : '') + mots.join(' ');
}

/** « Cent vingt-cinq mille francs CFA » */
export function montantEnLettres(montant: number, devise = 'FCFA'): string {
  const texte = `${nombreEnLettres(montant)} ${devise === 'FCFA' ? 'francs CFA' : devise}`;
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
