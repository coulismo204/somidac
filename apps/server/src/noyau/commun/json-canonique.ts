/** Sérialisation JSON stable (clés triées) : la même donnée produit toujours la même empreinte. */
export function jsonCanonique(valeur: unknown): string {
  return JSON.stringify(trier(valeur));
}

function trier(valeur: unknown): unknown {
  if (valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();
  if (Array.isArray(valeur)) return valeur.map(trier);
  if (valeur && typeof valeur === 'object') {
    return Object.keys(valeur as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, cle) => {
        acc[cle] = trier((valeur as Record<string, unknown>)[cle]);
        return acc;
      }, {});
  }
  return valeur;
}
