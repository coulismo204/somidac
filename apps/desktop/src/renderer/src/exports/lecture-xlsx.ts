/**
 * Lecture d'un classeur Excel (.xlsx) sans dépendance : archive zip (fichiers stockés ou
 * compressés, décompressés par le navigateur), chaînes partagées, feuilles. Les valeurs sont
 * rendues telles quelles : texte, nombre (les dates Excel sont des nombres de jours) ou booléen.
 */

export type Valeur = string | number | boolean | null;

export interface FeuilleLue {
  nom: string;
  /** Lignes non vides, avec leur numéro de ligne Excel (1 = première ligne). */
  lignes: { numero: number; cellules: Valeur[] }[];
}

const decodeur = new TextDecoder('utf-8');

async function decompresser(donnees: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([donnees as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

async function lireZip(tampon: ArrayBuffer): Promise<Map<string, string>> {
  const v = new DataView(tampon);
  const octets = new Uint8Array(tampon);
  let fin = -1;
  for (let i = tampon.byteLength - 22; i >= Math.max(0, tampon.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('Ce fichier n’est pas un classeur Excel (.xlsx).');
  const nombre = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const fichiers = new Map<string, string>();
  for (let n = 0; n < nombre; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Classeur Excel endommagé.');
    const methode = v.getUint16(p + 10, true);
    const taille = v.getUint32(p + 20, true);
    const lgNom = v.getUint16(p + 28, true);
    const lgExtra = v.getUint16(p + 30, true);
    const lgCommentaire = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nom = decodeur.decode(octets.subarray(p + 46, p + 46 + lgNom));
    p += 46 + lgNom + lgExtra + lgCommentaire;
    if (!/\.(xml|rels)$/.test(nom)) continue;
    const debut = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const brut = octets.subarray(debut, debut + taille);
    if (methode !== 0 && methode !== 8) throw new Error('Compression du classeur non prise en charge.');
    fichiers.set(nom, decodeur.decode(methode === 0 ? brut : await decompresser(brut)));
  }
  return fichiers;
}

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texteXml = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITES[e] ?? m),
  );
const attribut = (balise: string, nom: string) => balise.match(new RegExp(`\\b${nom}="([^"]*)"`))?.[1];
/** Concatène les <t> d'un élément (texte riche compris). */
const textes = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texteXml(m[1])).join('');

function colonne(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function lireClasseur(tampon: ArrayBuffer): Promise<FeuilleLue[]> {
  const f = await lireZip(tampon);
  const partagees = [...(f.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textes(m[1]));
  const liens = new Map([...(f.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attribut(m[0], 'Id')!, attribut(m[0], 'Target')!]));
  const feuilles: FeuilleLue[] = [];
  for (const m of (f.get('xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*>/g)) {
    const nom = texteXml(attribut(m[0], 'name') ?? '');
    const cible = liens.get(attribut(m[0], 'r:id') ?? '');
    if (!cible) continue;
    const chemin = cible.startsWith('/') ? cible.slice(1) : `xl/${cible}`;
    const xml = f.get(chemin);
    if (!xml) continue;
    const lignes: FeuilleLue['lignes'] = [];
    let numeroPrecedent = 0;
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const numero = Number(attribut(r[1], 'r') ?? numeroPrecedent + 1);
      numeroPrecedent = numero;
      const cellules: Valeur[] = [];
      let i = -1;
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attribut(c[1], 'r');
        i = ref ? colonne(ref) : i + 1;
        const type = attribut(c[1], 't');
        const contenu = c[2] ?? '';
        const v = contenu.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let valeur: Valeur = null;
        if (type === 's') valeur = v === undefined ? null : (partagees[Number(v)] ?? null);
        else if (type === 'inlineStr') valeur = textes(contenu);
        else if (type === 'str') valeur = v === undefined ? null : texteXml(v);
        else if (type === 'b') valeur = v === '1';
        else if (type === 'e') valeur = null;
        else if (v !== undefined) valeur = Number(v);
        cellules[i] = typeof valeur === 'string' ? valeur.trim() || null : valeur;
      }
      for (let k = 0; k < cellules.length; k++) if (cellules[k] === undefined) cellules[k] = null;
      if (cellules.some((x) => x !== null)) lignes.push({ numero, cellules });
    }
    feuilles.push({ nom, lignes });
  }
  return feuilles;
}

/** Date Excel (nombre de jours depuis le 30/12/1899), JJ/MM/AAAA ou AAAA-MM-JJ vers AAAA-MM-JJ. */
export function versDateIso(v: Valeur): string | null | undefined {
  if (v === null || v === '') return null;
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}
