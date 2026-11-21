/**
 * Modules métier (cahier des charges §4, architecture modulaire).
 * Chaque module peut être activé/désactivé dans les paramètres ; le noyau est toujours actif.
 */
export const MODULES = [
  { code: 'noyau', libelle: 'Noyau', dependances: [], obligatoire: true },
  { code: 'produits', libelle: 'Produits', dependances: ['noyau'], obligatoire: false },
  { code: 'stock', libelle: 'Stock', dependances: ['produits'], obligatoire: false },
  { code: 'tresorerie', libelle: 'Trésorerie', dependances: ['noyau'], obligatoire: false },
  { code: 'achats', libelle: 'Achats', dependances: ['produits', 'stock', 'tresorerie'], obligatoire: false },
  { code: 'ventes', libelle: 'Ventes', dependances: ['produits', 'stock', 'tresorerie'], obligatoire: false },
  { code: 'credit_client', libelle: 'Crédit client', dependances: ['ventes'], obligatoire: false },
  { code: 'rapports', libelle: 'Rapports', dependances: ['noyau'], obligatoire: false },
] as const;

export type CodeModule = (typeof MODULES)[number]['code'];

/** Modules actifs par défaut en V1 (le crédit client est prévu mais désactivé). */
export const MODULES_ACTIFS_PAR_DEFAUT: CodeModule[] = [
  'noyau',
  'produits',
  'stock',
  'tresorerie',
  'achats',
  'ventes',
  'rapports',
];
