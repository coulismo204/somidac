/** Types de documents numérotés (règle R6) : série annuelle, continue, sans trou. */
export const TYPES_DOCUMENTS = {
  INV: 'Inventaire',
  ACH: 'Achat',
  BL: 'Bon de livraison',
  FAC: 'Facture',
  AV: 'Avoir',
  PAI: 'Paiement',
  DEP: 'Dépense',
} as const;

export type TypeDocument = keyof typeof TYPES_DOCUMENTS;

/** Formate un numéro : FAC-2026-00001 */
export function formaterNumero(type: TypeDocument, annee: number, valeur: number): string {
  return `${type}-${annee}-${String(valeur).padStart(5, '0')}`;
}
