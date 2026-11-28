import { Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@somidac/shared';
import { sql } from 'drizzle-orm';
import { DB, Db } from '../../noyau/base/base';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { ParametresService } from '../../noyau/parametres/parametres.service';
import { aujourdhui } from '../stock/stock.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { RapportsService } from './rapports.service';

const nombre = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));

/**
 * Tableau de bord (§5.1) : chiffres du jour et du mois, soldes, 5 produits les plus vendus, alertes.
 * Chaque bloc n'apparaît que si son module est actif et que l'utilisateur a le droit de le voir.
 */
@Injectable()
export class TableauDeBordService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly parametres: ParametresService,
    private readonly rapports: RapportsService,
    private readonly tresorerie: TresorerieService,
  ) {}

  private async lignes<T>(requete: ReturnType<typeof sql>): Promise<T[]> {
    return (await this.db.execute(requete)).rows as T[];
  }

  async construire(u: UtilisateurConnecte) {
    const p = await this.parametres.lire();
    const actif = (m: string) => p.modulesActifs.includes(m);
    const peut = (x: string) => u.permissions.has(x);
    const complet = peut(PERMISSIONS.TABLEAU_DE_BORD_COMPLET);
    const jour = aujourdhui();
    const debutMois = `${jour.slice(0, 8)}01`;
    const resultat: Record<string, unknown> = { jour };

    // Ventes : complètes pour le gérant et le caissier, « ses ventes » pour le commercial.
    if (actif('ventes') && (complet || peut(PERMISSIONS.RAPPORTS_SES_VENTES))) {
      const portee = complet ? { ...u, permissions: new Set([...u.permissions, PERMISSIONS.RAPPORTS_TOUS]) } : u;
      const [duJour, duMois, produits] = await Promise.all([
        this.rapports.ventes(jour, jour, 'jour', portee),
        this.rapports.ventes(debutMois, jour, 'jour', portee),
        this.rapports.ventes(debutMois, jour, 'produit', portee),
      ]);
      const filtre = complet ? sql`` : sql`AND cree_par = ${u.id}`;
      const [liv] = await this.lignes<{ jour: string; mois: string }>(sql`
        SELECT count(*) FILTER (WHERE date = ${jour}) AS jour, count(*) AS mois FROM bons_livraison
         WHERE statut <> 'brouillon' AND date >= ${debutMois} AND date <= ${jour} ${filtre}`);
      const ventes: Record<string, unknown> = {
        sesVentesSeulement: !complet,
        caJour: duJour.totaux.ca,
        caMois: duMois.totaux.ca,
        margeMois: duMois.totaux.marge ?? null,
        tauxMargeMois: duMois.totaux.tauxMarge ?? null,
        livraisonsJour: Number(liv.jour),
        livraisonsMois: Number(liv.mois),
        top: produits.lignes.filter((l) => l.ca > 0).slice(0, 5).map((l) => ({ libelle: l.libelle, code: l.detail, pieces: l.pieces, ca: l.ca })),
      };
      if (complet) {
        const [retard] = await this.lignes<{ nombre: string; montant: string }>(sql`
          SELECT count(*) AS nombre, coalesce(sum(total_ttc - montant_avoirs - montant_paye), 0) AS montant FROM factures
           WHERE echeance < ${jour} AND total_ttc - montant_avoirs - montant_paye > 0`);
        const [du] = await this.lignes<{ nombre: string; montant: string }>(sql`
          SELECT count(*) AS nombre, coalesce(sum(total_ttc - montant_avoirs - montant_paye), 0) AS montant FROM factures
           WHERE total_ttc - montant_avoirs - montant_paye > 0`);
        const [aFacturer] = await this.lignes<{ n: string }>(sql`SELECT count(*) AS n FROM bons_livraison WHERE statut IN ('livre', 'receptionne')`);
        Object.assign(ventes, {
          facturesEnRetard: { nombre: Number(retard.nombre), montant: nombre(retard.montant) },
          aEncaisser: { nombre: Number(du.nombre), montant: nombre(du.montant) },
          bonsAFacturer: Number(aFacturer.n),
        });
      }
      resultat.ventes = ventes;
    }

    // Stock : alertes pour tous ceux qui voient le stock.
    if (actif('stock')) {
      const voirCouts = peut(PERMISSIONS.COUTS_VOIR);
      const bas = await this.lignes<{ id: string; designation: string; code: string; stock: number; seuil: number }>(sql`
        SELECT id, designation, code, stock, seuil_alerte AS seuil FROM produits
         WHERE actif AND seuil_alerte > 0 AND stock <= seuil_alerte ORDER BY stock::numeric / seuil_alerte, designation`);
      const limite = aujourdhui(new Date(Date.now() + p.delaiAlertePeremptionJours * 24 * 3600_000));
      const lots = await this.lignes<{ produit: string; numero: string; peremption: string; quantite: number }>(sql`
        SELECT p.designation AS produit, l.numero, l.date_peremption::text AS peremption, l.quantite FROM lots l JOIN produits p ON p.id = l.produit_id
         WHERE l.quantite > 0 AND l.date_peremption <= ${limite} ORDER BY l.date_peremption`);
      const [valeur] = voirCouts ? await this.lignes<{ v: string }>(sql`SELECT coalesce(sum(stock * cmp_centimes), 0) / 100 AS v FROM produits WHERE actif`) : [undefined];
      resultat.stock = {
        delaiPeremptionJours: p.delaiAlertePeremptionJours,
        stockBas: bas.slice(0, 8),
        nbStockBas: bas.length,
        lots: lots.slice(0, 8).map((l) => ({ ...l, perime: l.peremption < jour })),
        nbLotsAEcouler: lots.filter((l) => l.peremption >= jour).length,
        nbLotsPerimes: lots.filter((l) => l.peremption < jour).length,
        ...(valeur ? { valeur: nombre(valeur.v) } : {}),
      };
    }

    if (actif('tresorerie') && complet) resultat.tresorerie = await this.tresorerie.resume(u);
    if (peut(PERMISSIONS.AUDIT_VOIR)) resultat.alertes = await this.rapports.alertesFraude();
    return resultat;
  }
}
