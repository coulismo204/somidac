import { Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@somidac/shared';
import { sql, SQL } from 'drizzle-orm';
import { DB, Db } from '../../noyau/base/base';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { aujourdhui } from '../stock/stock.service';
import { RapportsService } from './rapports.service';

export type Granularite = 'jour' | 'mois' | 'annee';

export interface FiltresSynthese {
  du: string;
  au: string;
  granularite?: Granularite;
  categorieId?: string;
  produitId?: string;
  clientId?: string;
}

const n = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));
const variation = (actuel: number, avant: number) => (avant ? Math.round(((actuel - avant) * 1000) / Math.abs(avant)) / 10 : null);

/** Même période, un an plus tôt (le 29 février devient le 28). */
export function anneePrecedente(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(Date.UTC(a - 1, m - 1, j));
  if (d.getUTCMonth() !== m - 1) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Clés successives de la période selon la granularité (jours, mois ou années). */
export function clesPeriode(du: string, au: string, g: Granularite): string[] {
  const cles: string[] = [];
  const d = new Date(`${du}T00:00:00Z`);
  const fin = new Date(`${au}T00:00:00Z`);
  if (g === 'jour') {
    for (; d <= fin && cles.length < 400; d.setUTCDate(d.getUTCDate() + 1)) cles.push(d.toISOString().slice(0, 10));
  } else if (g === 'mois') {
    d.setUTCDate(1);
    for (; d <= fin && cles.length < 120; d.setUTCMonth(d.getUTCMonth() + 1)) cles.push(d.toISOString().slice(0, 7));
  } else {
    for (let a = d.getUTCFullYear(); a <= fin.getUTCFullYear(); a++) cles.push(String(a));
  }
  return cles;
}

/**
 * Synthèse des ventes du tableau de bord : indicateurs comparés à la même période de l'an
 * dernier, évolution du CA et de la marge, meilleurs produits, catégories et clients.
 * Les filtres (catégorie, produit, client) s'appliquent à tout.
 */
@Injectable()
export class SyntheseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rapports: RapportsService,
  ) {}

  private async lignes<T>(requete: SQL): Promise<T[]> {
    return (await this.db.execute(requete)).rows as T[];
  }

  /** Lignes de ventes filtrées (factures moins avoirs). */
  private ventes(du: string, au: string, f: FiltresSynthese, vendeurId?: string) {
    return sql`
      SELECT v.*, p.categorie_id FROM (${this.rapports.baseVentes(du, au, vendeurId)}) v
        JOIN produits p ON p.id = v.produit_id
       WHERE true
         ${f.categorieId ? sql`AND p.categorie_id = ${f.categorieId}` : sql``}
         ${f.produitId ? sql`AND v.produit_id = ${f.produitId}` : sql``}
         ${f.clientId ? sql`AND v.client_id = ${f.clientId}` : sql``}`;
  }

  async construire(f: FiltresSynthese, u: UtilisateurConnecte) {
    const complet = u.permissions.has(PERMISSIONS.TABLEAU_DE_BORD_COMPLET);
    const vendeurId = complet ? undefined : u.id;
    const voirCouts = u.permissions.has(PERMISSIONS.COUTS_VOIR);
    const duN1 = anneePrecedente(f.du);
    const auN1 = anneePrecedente(f.au);
    const jours = (Date.parse(f.au) - Date.parse(f.du)) / 86_400_000 + 1;
    const g: Granularite = f.granularite ?? (jours <= 62 ? 'jour' : jours <= 1100 ? 'mois' : 'annee');
    const format = g === 'jour' ? 'YYYY-MM-DD' : g === 'mois' ? 'YYYY-MM' : 'YYYY';

    const totaux = async (du: string, au: string) => {
      const [t] = await this.lignes<{ ca: string; cout: string; ventes: string; clients: string }>(sql`
        WITH v AS (${this.ventes(du, au, f, vendeurId)})
        SELECT sum(ca) AS ca, sum(cout) AS cout, count(DISTINCT facture_id) AS ventes, count(DISTINCT client_id) AS clients FROM v`);
      const ca = n(t.ca);
      const ventes = Number(t.ventes);
      return { ca, marge: ca - n(t.cout), ventes, panierMoyen: ventes ? Math.round(ca / ventes) : 0, clients: Number(t.clients) };
    };
    const [actuel, precedent] = await Promise.all([totaux(f.du, f.au), totaux(duN1, auN1)]);

    // Évolution : la même clé sert pour l'an dernier (décalée d'un an).
    const parCle = async (du: string, au: string, decalage: boolean) => {
      const rows = await this.lignes<{ cle: string; ca: string; cout: string }>(sql`
        WITH v AS (${this.ventes(du, au, f, vendeurId)})
        SELECT to_char(${decalage ? sql`v.jour + interval '1 year'` : sql`v.jour`}, ${format}) AS cle, sum(ca) AS ca, sum(cout) AS cout FROM v GROUP BY 1`);
      return new Map(rows.map((r) => [r.cle, { ca: n(r.ca), marge: n(r.ca) - n(r.cout) }]));
    };
    const [serieActuelle, serieN1] = await Promise.all([parCle(f.du, f.au, false), parCle(duN1, auN1, true)]);
    const serie = clesPeriode(f.du, f.au, g).map((cle) => {
      const a = serieActuelle.get(cle);
      const b = serieN1.get(cle);
      return { cle, ca: a?.ca ?? 0, caN1: b?.ca ?? 0, ...(voirCouts ? { marge: a?.marge ?? 0, margeN1: b?.marge ?? 0 } : {}) };
    });

    const produits = await this.lignes<{ id: string; libelle: string; code: string; pieces: string; ca: string; cout: string; ventes: string }>(sql`
      WITH v AS (${this.ventes(f.du, f.au, f, vendeurId)})
      SELECT p.id, p.designation AS libelle, p.code, sum(v.pieces) AS pieces, sum(v.ca) AS ca, sum(v.cout) AS cout, count(DISTINCT v.facture_id) AS ventes
        FROM v JOIN produits p ON p.id = v.produit_id GROUP BY 1, 2, 3 HAVING sum(v.ca) > 0 ORDER BY sum(v.ca) DESC LIMIT 50`);

    const parCategorie = async (du: string, au: string) =>
      new Map(
        (
          await this.lignes<{ id: string; ca: string; cout: string; ventes: string }>(sql`
            WITH v AS (${this.ventes(du, au, f, vendeurId)})
            SELECT v.categorie_id AS id, sum(v.ca) AS ca, sum(v.cout) AS cout, count(DISTINCT v.facture_id) AS ventes FROM v GROUP BY 1`)
        ).map((r) => [r.id, { ca: n(r.ca), marge: n(r.ca) - n(r.cout), ventes: Number(r.ventes) }]),
      );
    const [catA, catB] = await Promise.all([parCategorie(f.du, f.au), parCategorie(duN1, auN1)]);
    const nomsCategories = await this.lignes<{ id: string; nom: string; type: string }>(sql`SELECT id, nom, type FROM categories`);
    const categories = nomsCategories
      .filter((c) => catA.has(c.id) || catB.has(c.id))
      .map((c) => {
        const a = catA.get(c.id) ?? { ca: 0, marge: 0, ventes: 0 };
        const b = catB.get(c.id) ?? { ca: 0, marge: 0, ventes: 0 };
        return { id: c.id, libelle: c.nom, type: c.type, ca: a.ca, caN1: b.ca, ventes: a.ventes, ventesN1: b.ventes, ...(voirCouts ? { marge: a.marge, margeN1: b.marge } : {}) };
      })
      .sort((x, y) => y.ca - x.ca);

    const clients = await this.lignes<{ id: string; libelle: string; type: string; ca: string; cout: string; ventes: string; avoirs: string; reste: string }>(sql`
      WITH v AS (${this.ventes(f.du, f.au, f, vendeurId)})
      SELECT c.id, c.raison_sociale AS libelle, c.type, sum(v.ca) AS ca, sum(v.cout) AS cout, count(DISTINCT v.facture_id) AS ventes,
             -sum(CASE WHEN v.facture_id IS NULL THEN v.ca ELSE 0 END) AS avoirs,
             (SELECT coalesce(sum(greatest(x.total_ttc - x.montant_avoirs - x.montant_paye, 0)), 0) FROM factures x WHERE x.client_id = c.id) AS reste
        FROM v JOIN clients c ON c.id = v.client_id GROUP BY 1, 2, 3 ORDER BY sum(v.ca) DESC`);

    return {
      du: f.du,
      au: f.au,
      duN1,
      auN1,
      granularite: g,
      sesVentesSeulement: !complet,
      indicateurs: {
        ca: { valeur: actuel.ca, n1: precedent.ca, variation: variation(actuel.ca, precedent.ca) },
        ...(voirCouts ? { marge: { valeur: actuel.marge, n1: precedent.marge, variation: variation(actuel.marge, precedent.marge), taux: actuel.ca ? Math.round((actuel.marge * 1000) / actuel.ca) / 10 : null } } : {}),
        ventes: { valeur: actuel.ventes, n1: precedent.ventes, variation: variation(actuel.ventes, precedent.ventes) },
        panierMoyen: { valeur: actuel.panierMoyen, n1: precedent.panierMoyen, variation: variation(actuel.panierMoyen, precedent.panierMoyen) },
        clients: actuel.clients,
      },
      serie,
      produits: produits.map((p, i) => ({ rang: i + 1, id: p.id, libelle: p.libelle, code: p.code, pieces: n(p.pieces), ca: n(p.ca), ventes: Number(p.ventes), ...(voirCouts ? { marge: n(p.ca) - n(p.cout) } : {}) })),
      categories,
      clients: clients.map((c) => {
        const ventes = Number(c.ventes);
        const ca = n(c.ca);
        return { id: c.id, libelle: c.libelle, type: c.type, ca, ventes, panierMoyen: ventes ? Math.round(ca / ventes) : 0, avoirs: n(c.avoirs), resteDu: complet ? n(c.reste) : null, ...(voirCouts ? { marge: ca - n(c.cout) } : {}) };
      }),
      jour: aujourdhui(),
    };
  }

  /** Valeur du stock (au coût et au prix de vente), filtrée comme le reste du tableau. */
  async stock(f: Pick<FiltresSynthese, 'categorieId' | 'produitId'>, u: UtilisateurConnecte) {
    const voirCouts = u.permissions.has(PERMISSIONS.COUTS_VOIR);
    const [r] = await this.lignes<{ pieces: string; cout: string; vente: string; produits: string }>(sql`
      SELECT sum(p.stock) AS pieces, sum(p.stock * p.cmp_centimes) / 100 AS cout,
             sum(p.stock * coalesce((SELECT c.prix_vente FROM conditionnements c WHERE c.produit_id = p.id AND c.nb_pieces = 1 AND c.actif LIMIT 1), 0)) AS vente,
             count(*) FILTER (WHERE p.stock > 0) AS produits
        FROM produits p
       WHERE p.actif ${f.categorieId ? sql`AND p.categorie_id = ${f.categorieId}` : sql``} ${f.produitId ? sql`AND p.id = ${f.produitId}` : sql``}`);
    return { pieces: n(r.pieces), produits: Number(r.produits), valeurVente: n(r.vente), ...(voirCouts ? { valeurCout: n(r.cout) } : {}) };
  }
}
