const dateHeure = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export function formaterDateHeure(valeur?: string | Date | null): string {
  if (!valeur) return '—';
  return dateHeure.format(new Date(valeur));
}

export function formaterDate(valeur?: string | Date | null): string {
  if (!valeur) return '—';
  return date.format(new Date(valeur));
}

export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('');
}

/** « il y a 5 min », « dans 12 min » */
export function relatif(valeur?: string | Date | null): string {
  if (!valeur) return '—';
  const ecart = (new Date(valeur).getTime() - Date.now()) / 60_000;
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (Math.abs(ecart) < 60) return rtf.format(Math.round(ecart), 'minute');
  if (Math.abs(ecart) < 60 * 24) return rtf.format(Math.round(ecart / 60), 'hour');
  return rtf.format(Math.round(ecart / 1440), 'day');
}
