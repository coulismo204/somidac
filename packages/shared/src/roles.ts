import { PERMISSIONS as P, Permission, TOUTES_PERMISSIONS } from './permissions';

export type CodeRole = 'gerant' | 'caissier' | 'magasinier' | 'commercial';

export interface DefinitionRole {
  code: CodeRole;
  libelle: string;
  permissions: Permission[];
}

/** Rôles fournis à l'installation (cahier des charges §3). */
export const ROLES_PAR_DEFAUT: DefinitionRole[] = [
  { code: 'gerant', libelle: 'Gérant', permissions: TOUTES_PERMISSIONS },
  {
    code: 'caissier',
    libelle: 'Caissier / comptable',
    permissions: [
      P.TABLEAU_DE_BORD_COMPLET,
      P.COUTS_VOIR,
      P.ACHATS_SAISIR,
      P.VENTES_SAISIR,
      P.TRESORERIE_ENCAISSER,
      P.CAISSE_CLOTURER,
      P.RAPPORTS_TOUS,
    ],
  },
  {
    code: 'magasinier',
    libelle: 'Magasinier',
    permissions: [P.PRODUITS_GERER, P.ACHATS_SAISIR, P.STOCK_AJUSTER, P.RAPPORTS_STOCK],
  },
  {
    code: 'commercial',
    libelle: 'Commercial',
    permissions: [P.VENTES_SAISIR, P.REMISES_ACCORDER, P.RAPPORTS_SES_VENTES],
  },
];
