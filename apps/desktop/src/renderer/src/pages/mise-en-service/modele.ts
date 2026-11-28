import type { ErreurImport, FeuilleImport, ImportDto } from '@somidac/shared';
import { FeuilleLue, Valeur, versDateIso } from '../../exports/lecture-xlsx';
import { ColonneExport, creerClasseur } from '../../exports/xlsx';

/**
 * Modèle Excel de départ (lot 6) : une feuille par type de données. La même définition sert à
 * fabriquer le modèle et à relire le fichier rempli ; les en-têtes sont reconnus même si la casse,
 * les accents ou l'astérisque changent.
 */

type Conversion = 'texte' | 'code' | 'entier' | 'montant' | 'decimal' | 'ouinon' | 'date' | 'typeCategorie' | 'typeClient';

interface Colonne {
  titre: string;
  champ: string;
  conversion: Conversion;
  obligatoire?: boolean;
  largeur?: number;
}

interface DefinitionFeuille {
  cle: FeuilleImport;
  nom: string;
  consigne: string;
  colonnes: Colonne[];
  exemples: (string | number | null)[][];
}

export const DEFINITIONS: DefinitionFeuille[] = [
  {
    cle: 'produits',
    nom: 'Produits',
    consigne: 'Une ligne par produit. Le code interne (P-0001…) est attribué automatiquement. Prix hors taxe en FCFA.',
    colonnes: [
      { titre: 'Désignation', champ: 'designation', conversion: 'texte', obligatoire: true, largeur: 34 },
      { titre: 'Catégorie', champ: 'categorie', conversion: 'texte', obligatoire: true, largeur: 22 },
      { titre: 'Type de catégorie (cosmétique ou bazar)', champ: 'typeCategorie', conversion: 'typeCategorie', largeur: 18 },
      { titre: 'Marque', champ: 'marque', conversion: 'texte', largeur: 16 },
      { titre: 'Suivi par lot (oui ou non)', champ: 'suiviLot', conversion: 'ouinon', largeur: 14 },
      { titre: 'Seuil d’alerte (pièces)', champ: 'seuilAlerte', conversion: 'entier', largeur: 12 },
      { titre: 'Prix de vente de la pièce', champ: 'prixPiece', conversion: 'montant', largeur: 14 },
      { titre: 'Code-barres de la pièce', champ: 'codeBarrePiece', conversion: 'code', largeur: 18 },
      { titre: 'Conditionnement (ex. Carton de 24)', champ: 'conditionnement', conversion: 'texte', largeur: 18 },
      { titre: 'Pièces par conditionnement', champ: 'piecesParConditionnement', conversion: 'entier', largeur: 12 },
      { titre: 'Prix de vente du conditionnement', champ: 'prixConditionnement', conversion: 'montant', largeur: 14 },
      { titre: 'Code-barres du conditionnement', champ: 'codeBarreConditionnement', conversion: 'code', largeur: 18 },
    ],
    exemples: [
      ['Savon karité 200 g', 'Soins du corps', 'cosmétique', 'Karité Plus', 'oui', 24, 350, '6001234567890', 'Carton de 24', 24, 7800, '6001234567891'],
      ['Seau 10 L', 'Ménage et entretien', 'bazar', null, 'non', 5, 2000, null, null, null, null, null],
    ],
  },
  {
    cle: 'fournisseurs',
    nom: 'Fournisseurs',
    consigne: 'Les grossistes chez qui SOMIDAC achète.',
    colonnes: [
      { titre: 'Nom', champ: 'nom', conversion: 'texte', obligatoire: true, largeur: 30 },
      { titre: 'Téléphone', champ: 'telephone', conversion: 'code', largeur: 18 },
      { titre: 'Adresse', champ: 'adresse', conversion: 'texte', largeur: 30 },
      { titre: 'NIF', champ: 'nif', conversion: 'code', largeur: 16 },
    ],
    exemples: [['Grossiste du Port', '+221 33 000 00 00', 'Zone portuaire', null]],
  },
  {
    cle: 'clients',
    nom: 'Clients',
    consigne: 'Type : supermarché, boutique, revendeur ou particulier.',
    colonnes: [
      { titre: 'Raison sociale', champ: 'raisonSociale', conversion: 'texte', obligatoire: true, largeur: 30 },
      { titre: 'Type', champ: 'type', conversion: 'typeClient', largeur: 14 },
      { titre: 'Personne à contacter', champ: 'contact', conversion: 'texte', largeur: 20 },
      { titre: 'Téléphone', champ: 'telephone', conversion: 'code', largeur: 18 },
      { titre: 'Adresse', champ: 'adresse', conversion: 'texte', largeur: 30 },
      { titre: 'NIF', champ: 'nif', conversion: 'code', largeur: 16 },
      { titre: 'Bon de livraison sans prix (oui ou non)', champ: 'blSansPrix', conversion: 'ouinon', largeur: 14 },
    ],
    exemples: [['Supermarché Bon Prix', 'supermarché', null, '+221 33 222 22 22', null, null, 'non']],
  },
  {
    cle: 'stock',
    nom: 'Stock d’ouverture',
    consigne: 'Le stock compté le jour du démarrage, en pièces. Coût d’achat d’une pièce, frais compris. Lot et péremption obligatoires pour les produits suivis par lot.',
    colonnes: [
      { titre: 'Produit (désignation ou code)', champ: 'produit', conversion: 'texte', obligatoire: true, largeur: 34 },
      { titre: 'Quantité (pièces)', champ: 'quantite', conversion: 'entier', obligatoire: true, largeur: 12 },
      { titre: 'Coût d’une pièce', champ: 'coutUnitaire', conversion: 'decimal', obligatoire: true, largeur: 14 },
      { titre: 'Numéro de lot', champ: 'numeroLot', conversion: 'code', largeur: 14 },
      { titre: 'Date de péremption (JJ/MM/AAAA)', champ: 'datePeremption', conversion: 'date', largeur: 16 },
    ],
    exemples: [
      ['Savon karité 200 g', 48, 210, 'L2611', '31/01/2028'],
      ['Seau 10 L', 10, 1500, null, null],
    ],
  },
];

const TYPE_COLONNE: Record<Conversion, ColonneExport['type']> = {
  texte: 'texte',
  code: 'texte',
  entier: 'nombre',
  montant: 'montant',
  decimal: 'nombre',
  ouinon: 'texte',
  date: 'texte',
  typeCategorie: 'texte',
  typeClient: 'texte',
};

/** Le modèle à remplir : une feuille de mode d'emploi, puis une feuille par type, avec des exemples. */
export function creerModele(): Uint8Array {
  return creerClasseur([
    {
      titre: 'Fichier de départ SOMIDAC',
      nomFeuille: 'Mode d’emploi',
      sousTitre: 'Remplissez les feuilles suivantes, enregistrez, puis importez le fichier dans SOMIDAC (Administration > Mise en service).',
      colonnes: [
        { titre: 'Feuille', type: 'texte', largeur: 22 },
        { titre: 'Ce qu’elle contient', type: 'texte', largeur: 100 },
      ],
      lignes: [
        ...DEFINITIONS.map((d) => [d.nom, d.consigne]),
        ['Conseils', 'Remplacez les lignes d’exemple par vos données. Les colonnes marquées * sont obligatoires. Ne renommez pas les feuilles ni les en-têtes.'],
        ['', 'L’import vérifie tout avant d’enregistrer : rien n’est enregistré tant qu’il reste une erreur.'],
      ],
    },
    ...DEFINITIONS.map((d) => ({
      titre: d.nom,
      nomFeuille: d.nom,
      sousTitre: d.consigne,
      colonnes: d.colonnes.map((c) => ({ titre: `${c.titre}${c.obligatoire ? ' *' : ''}`, type: TYPE_COLONNE[c.conversion], largeur: c.largeur })),
      lignes: d.exemples,
    })),
  ]);
}

// ------------------------------------------------------------------ relecture du fichier rempli

const normaliser = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\*|\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const OUI = new Set(['oui', 'o', 'yes', 'y', 'vrai', 'true', 'x', '1']);
const NON = new Set(['non', 'n', 'no', 'faux', 'false', '0']);
const TYPES_CLIENTS: Record<string, string> = { supermarche: 'supermarche', 'super marche': 'supermarche', boutique: 'boutique', revendeur: 'revendeur', particulier: 'particulier' };

function convertir(v: Valeur, c: Colonne): { valeur?: unknown; erreur?: string } {
  if (v === null || v === '') return { valeur: c.conversion === 'ouinon' ? undefined : null };
  const texte = typeof v === 'string' ? v.trim() : String(v);
  const nombre = typeof v === 'number' ? v : Number(texte.replace(/[\s  ]/g, '').replace(',', '.'));
  switch (c.conversion) {
    case 'texte':
      return { valeur: texte };
    case 'code':
      // Un code-barres tapé dans Excel devient souvent un nombre : on le remet en texte sans exposant.
      return { valeur: typeof v === 'number' ? String(Math.round(v)) : texte };
    case 'entier':
      return Number.isInteger(nombre) && nombre >= 0 ? { valeur: nombre } : { erreur: `${c.titre} : « ${texte} » n’est pas un nombre entier` };
    case 'montant':
      return Number.isFinite(nombre) && nombre >= 0 ? { valeur: Math.round(nombre) } : { erreur: `${c.titre} : « ${texte} » n’est pas un montant` };
    case 'decimal':
      return Number.isFinite(nombre) && nombre >= 0 ? { valeur: nombre } : { erreur: `${c.titre} : « ${texte} » n’est pas un nombre` };
    case 'ouinon': {
      if (typeof v === 'boolean') return { valeur: v };
      const t = normaliser(texte);
      return OUI.has(t) ? { valeur: true } : NON.has(t) ? { valeur: false } : { erreur: `${c.titre} : écrivez oui ou non` };
    }
    case 'date': {
      const d = versDateIso(v);
      return d === undefined ? { erreur: `${c.titre} : « ${texte} » n’est pas une date (JJ/MM/AAAA)` } : { valeur: d };
    }
    case 'typeCategorie': {
      const t = normaliser(texte);
      return t.startsWith('cosm') ? { valeur: 'cosmetique' } : t === 'bazar' ? { valeur: 'bazar' } : { erreur: 'Type de catégorie : écrivez cosmétique ou bazar' };
    }
    case 'typeClient': {
      const t = TYPES_CLIENTS[normaliser(texte)];
      return t ? { valeur: t } : { erreur: 'Type : supermarché, boutique, revendeur ou particulier' };
    }
  }
}

export interface Lecture {
  dto: Omit<ImportDto, 'verifierSeulement'>;
  erreurs: ErreurImport[];
  feuillesTrouvees: string[];
}

/**
 * Transforme le classeur rempli en données d'import. `typesCategories` (nom → type) sert à décider
 * du suivi par lot quand la case est vide : oui pour les cosmétiques (§5.2).
 */
export function lireFichierDepart(feuilles: FeuilleLue[], typesCategories: Map<string, string>): Lecture {
  const erreurs: ErreurImport[] = [];
  const dto: Lecture['dto'] = { produits: [], fournisseurs: [], clients: [], stock: [] };
  const trouvees: string[] = [];
  for (const def of DEFINITIONS) {
    const feuille = feuilles.find((f) => normaliser(f.nom) === normaliser(def.nom));
    if (!feuille) continue;
    trouvees.push(def.nom);
    // L'en-tête est la première ligne (parmi les 10 premières) qui contient le titre de la première colonne.
    const titre1 = normaliser(def.colonnes[0].titre);
    const indexEntete = feuille.lignes.slice(0, 10).findIndex((l) => l.cellules.some((c) => typeof c === 'string' && normaliser(c) === titre1));
    if (indexEntete < 0) {
      erreurs.push({ feuille: def.cle, ligne: 1, message: `En-tête « ${def.colonnes[0].titre} » introuvable : ne modifiez pas les titres des colonnes` });
      continue;
    }
    const entete = feuille.lignes[indexEntete].cellules.map((c) => (typeof c === 'string' ? normaliser(c) : ''));
    const positions = def.colonnes.map((c) => entete.indexOf(normaliser(c.titre)));
    for (const l of feuille.lignes.slice(indexEntete + 1)) {
      const objet: Record<string, unknown> = { ligne: l.numero };
      let ok = true;
      for (const [i, c] of def.colonnes.entries()) {
        const r = convertir(positions[i] >= 0 ? (l.cellules[positions[i]] ?? null) : null, c);
        if (r.erreur) {
          erreurs.push({ feuille: def.cle, ligne: l.numero, message: r.erreur });
          ok = false;
        } else if (c.obligatoire && (r.valeur === null || r.valeur === undefined || r.valeur === '')) {
          erreurs.push({ feuille: def.cle, ligne: l.numero, message: `${c.titre} : obligatoire` });
          ok = false;
        } else if (r.valeur !== undefined && r.valeur !== null) {
          objet[c.champ] = r.valeur;
        }
      }
      if (!ok) continue;
      if (def.cle === 'produits') {
        if (objet.suiviLot === undefined) {
          const type = (objet.typeCategorie as string | undefined) ?? typesCategories.get(normaliser(String(objet.categorie)));
          objet.suiviLot = type === 'cosmetique';
        }
        objet.seuilAlerte ??= 0;
        dto.produits.push(objet as unknown as ImportDto['produits'][number]);
      } else if (def.cle === 'clients') {
        objet.type ??= 'boutique';
        objet.blSansPrix ??= false;
        dto.clients.push(objet as unknown as ImportDto['clients'][number]);
      } else if (def.cle === 'fournisseurs') {
        dto.fournisseurs.push(objet as unknown as ImportDto['fournisseurs'][number]);
      } else {
        dto.stock.push(objet as unknown as ImportDto['stock'][number]);
      }
    }
  }
  return { dto, erreurs, feuillesTrouvees: trouvees };
}

export const normaliserNom = normaliser;
