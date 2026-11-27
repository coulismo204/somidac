/**
 * Catalogue des permissions (cahier des charges §3).
 * Les droits sont stockés en base par rôle : le gérant peut les ajuster sans modifier le code.
 */
export const PERMISSIONS = {
  TABLEAU_DE_BORD_COMPLET: 'tableau_de_bord.complet',
  PRODUITS_GERER: 'produits.gerer',
  PRIX_MODIFIER: 'prix.modifier',
  COUTS_VOIR: 'couts.voir',
  ACHATS_SAISIR: 'achats.saisir',
  STOCK_AJUSTER: 'stock.ajuster',
  INVENTAIRE_VALIDER: 'inventaire.valider',
  VENTES_SAISIR: 'ventes.saisir',
  REMISES_ACCORDER: 'remises.accorder',
  DOCUMENTS_ANNULER: 'documents.annuler',
  TRESORERIE_ENCAISSER: 'tresorerie.encaisser',
  CAISSE_CLOTURER: 'caisse.cloturer',
  RAPPORTS_TOUS: 'rapports.tous',
  RAPPORTS_STOCK: 'rapports.stock',
  RAPPORTS_SES_VENTES: 'rapports.ses_ventes',
  ADMIN_UTILISATEURS: 'admin.utilisateurs',
  ADMIN_PARAMETRES: 'admin.parametres',
  ADMIN_SAUVEGARDES: 'admin.sauvegardes',
  ADMIN_APPAREILS: 'admin.appareils',
  AUDIT_VOIR: 'audit.voir',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const TOUTES_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const LIBELLES_PERMISSIONS: Record<Permission, string> = {
  'tableau_de_bord.complet': 'Voir le tableau de bord complet (bénéfice, trésorerie)',
  'produits.gerer': 'Créer et modifier les produits',
  'prix.modifier': 'Modifier les prix de vente',
  'couts.voir': "Voir les prix d'achat et les marges",
  'achats.saisir': 'Enregistrer un achat / une réception',
  'stock.ajuster': 'Faire un inventaire, un ajustement de stock',
  'inventaire.valider': 'Valider un inventaire (applique les écarts au stock)',
  'ventes.saisir': 'Créer un bon de livraison / une facture',
  'remises.accorder': 'Accorder une remise',
  'documents.annuler': 'Annuler une facture, faire un avoir',
  'tresorerie.encaisser': 'Encaisser un paiement, saisir une dépense',
  'caisse.cloturer': 'Clôturer la caisse',
  'rapports.tous': 'Voir tous les rapports',
  'rapports.stock': 'Voir les rapports de stock',
  'rapports.ses_ventes': 'Voir les rapports de ses propres ventes',
  'admin.utilisateurs': 'Gérer les utilisateurs et les rôles',
  'admin.parametres': "Gérer les paramètres de l'entreprise",
  'admin.sauvegardes': 'Gérer les sauvegardes',
  'admin.appareils': 'Enregistrer et révoquer les appareils',
  'audit.voir': "Consulter le journal d'audit",
};
