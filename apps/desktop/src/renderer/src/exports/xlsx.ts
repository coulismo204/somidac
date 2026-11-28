/**
 * Fichier Excel (.xlsx) minimal, sans dépendance : une feuille, un titre, des en-têtes en gras,
 * les montants au format « 125 000 » et une ligne de totaux. Le format .xlsx est une archive zip
 * de fichiers XML ; l'archive est écrite sans compression (méthode « stockée »).
 */

export type TypeColonne = 'texte' | 'nombre' | 'montant' | 'pct' | 'date';

export interface ColonneExport {
  titre: string;
  type: TypeColonne;
  largeur?: number;
}

export type Cellule = string | number | null | undefined;

export interface FeuilleExport {
  titre: string;
  sousTitre?: string;
  colonnes: ColonneExport[];
  lignes: Cellule[][];
  totaux?: Cellule[];
}

const encodeur = new TextEncoder();

const echapper = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function lettre(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Styles (cellXfs) : 0 normal, 1 en-tête, 2 nombre, 3 nombre gras, 4 titre, 5 pourcentage, 6 texte gras, 7 sous-titre. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0&quot; %&quot;"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF0B3D91"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B3D91"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF6EED9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="3" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellule(ref: string, valeur: Cellule, type: TypeColonne | 'titre', gras = false): string {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  const numerique = typeof valeur === 'number' && Number.isFinite(valeur) && type !== 'texte' && type !== 'date';
  if (numerique) {
    const style = type === 'pct' ? 5 : gras ? 3 : 2;
    return `<c r="${ref}" s="${style}"><v>${valeur}</v></c>`;
  }
  const style = type === 'titre' ? 4 : gras ? 6 : 0;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${echapper(String(valeur))}</t></is></c>`;
}

function feuille(f: FeuilleExport): string {
  const lignes: string[] = [];
  let r = 1;
  lignes.push(`<row r="${r}">${cellule(`A${r}`, f.titre, 'titre')}</row>`);
  r++;
  if (f.sousTitre) {
    lignes.push(`<row r="${r}">${cellule(`A${r}`, f.sousTitre, 'texte')}</row>`);
    r++;
  }
  r++;
  const entete = r;
  lignes.push(`<row r="${r}">${f.colonnes.map((c, i) => `<c r="${lettre(i)}${r}" t="inlineStr" s="1"><is><t>${echapper(c.titre)}</t></is></c>`).join('')}</row>`);
  r++;
  for (const l of f.lignes) {
    lignes.push(`<row r="${r}">${f.colonnes.map((c, i) => cellule(`${lettre(i)}${r}`, l[i], c.type)).join('')}</row>`);
    r++;
  }
  if (f.totaux) {
    lignes.push(`<row r="${r}">${f.colonnes.map((c, i) => cellule(`${lettre(i)}${r}`, f.totaux![i], c.type, true)).join('')}</row>`);
  }
  const largeurs = f.colonnes
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largeur ?? (c.type === 'texte' ? 32 : 16)}" customWidth="1"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${entete}" topLeftCell="A${entete + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${largeurs}</cols>
<sheetData>${lignes.join('')}</sheetData>
</worksheet>`;
}

// ------------------------------------------------------------------ archive zip (méthode stockée)

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = TABLE_CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(fichiers: { nom: string; contenu: string }[]): Uint8Array {
  const morceaux: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = encodeur.encode(f.nom);
    const data = encodeur.encode(f.contenu);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint16(8, 0, true); // stocké
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true); // 01/01/1980
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);
    morceaux.push(new Uint8Array(local.buffer), nom, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nom.length, true);
    c.setUint32(42, decalage, true);
    central.push(new Uint8Array(c.buffer), nom);
    decalage += 30 + nom.length + data.length;
  }
  const tailleCentral = central.reduce((t, m) => t + m.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, decalage, true);
  const tout = [...morceaux, ...central, new Uint8Array(fin.buffer)];
  const res = new Uint8Array(tout.reduce((t, m) => t + m.length, 0));
  let p = 0;
  for (const m of tout) {
    res.set(m, p);
    p += m.length;
  }
  return res;
}

const nomFeuille = (t: string) => echapper(t.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));

/** Classeur d'une seule feuille (exports de rapports). */
export function creerXlsx(f: FeuilleExport): Uint8Array {
  return creerClasseur([f]);
}

/** Classeur de plusieurs feuilles (modèle d'import). */
export function creerClasseur(feuilles: (FeuilleExport & { nomFeuille?: string })[]): Uint8Array {
  const n = feuilles.length;
  const idx = feuilles.map((_, i) => i + 1);
  return zip([
    {
      nom: '[Content_Types].xml',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nom: '_rels/.rels',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nom: 'xl/workbook.xml',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${feuilles.map((f, i) => `<sheet name="${nomFeuille(f.nomFeuille ?? f.titre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      nom: 'xl/_rels/workbook.xml.rels',
      contenu: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nom: 'xl/styles.xml', contenu: STYLES },
    ...feuilles.map((f, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, contenu: feuille(f) })),
  ]);
}
