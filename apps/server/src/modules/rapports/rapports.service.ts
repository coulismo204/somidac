import { Inject, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@somidac/shared';
import { and, desc, gte, sql, SQL } from 'drizzle-orm';
import { DB, Db } from '../../noyau/base/base';
import { journalAudit, utilisateurs } from '../../noyau/base/schema';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { ParametresService } from '../../noyau/parametres/parametres.service';
import { aujourdhui } from '../stock/stock.service';
import { lendemain, TresorerieService } from '../tresorerie/tresorerie.service';

export type GroupeVentes = 'jour' | 'mois' | 'client' | 'produit' | 'categorie' | 'vendeur';

const nombre = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));

/** Actions qui méritent l'attention du gérant (§10.3 « récapitulatif quotidien des actions sensibles »). */
export const ACTIONS_SENSIBLES: Record<string, string> = {
  'avoir.emis': 'Avoir émis',
  'paiement.annule': 'Paiement annulé',
  'depense.annulee': 'Dépense annulée',
  'inventaire.valide': 'Inventaire validé',
  'inventaire.annule': 'Inventaire annulé',
  'stock.ajustement': 'Ajustement de stock',
  'stock.casse': 'Casse',
  'stock.peremption': 'Sortie pour péremption',
  'produit.prix_modifies': 'Prix de vente modifié',
  'client.prix_modifies': 'Prix d’un client modifié',
  'caisse.cloture_saisie': 'Clôture de caisse',
  'caisse.cloture_refusee': 'Clôture de caisse refusée',
  'connexion.echec': 'Échec de connexion',
  'connexion.echec_identifiant_inconnu': 'Connexion avec un identifiant inconnu',
  'connexion.refusee_compte_bloque': 'Connexion refusée (compte bloqué)',
  'appareil.revoque': 'Appareil révoqué',
  'sauvegarde.restauree': 'Sauvegarde restaurée',
  'role.permissions_modifiees': 'Droits d’un rôle modifiés',
  'utilisateur.mot_de_passe_reinitialise': 'Mot de passe réinitialisé',
  'parametres.modifier': 'Paramètres modifiés',
};

/** Heure locale « HH:MM » d'un horodatage. */
const heureLocale = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Rapports (§5.7) et tableau de bord (§5.1). Les ventes sont comptées sur les factures, moins les
 * avoirs, à leur date ; la remise sur le total est répartie au prorata des lignes. Le coût est le
 * coût moyen au moment de la livraison (R2).
 */
@Injectable()
export class RapportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly parametres: ParametresService,
  ) {}

  private async lignes<T>(requete: SQL): Promise<T[]> {
    return (await this.db.execute(requete)).rows as T[];
  }

  /** Lignes de ventes de la période (factures moins avoirs), base de tous les rapports de ventes. */
  baseVentes(du: string, au: string, vendeurId?: string) {
    const filtreVendeur = vendeurId ? sql`AND bl.cree_par = ${vendeurId}` : sql``;
    return sql`
      SELECT f.date AS jour, f.client_id, fl.produit_id, bl.cree_par AS vendeur_id, f.id AS facture_id,
             fl.quantite_pieces::numeric AS pieces,
             fl.montant::numeric * f.total_ht / NULLIF(f.total_lignes, 0) AS ca,
             fl.quantite_pieces::numeric * fl.cout_piece_centimes / 100.0 AS cout
        FROM facture_lignes fl
        JOIN factures f ON f.id = fl.facture_id
        JOIN bons_livraison bl ON bl.id = f.bl_id
       WHERE f.date >= ${du} AND f.date <= ${au} ${filtreVendeur}
      UNION ALL
      SELECT a.date, a.client_id, fl.produit_id, bl.cree_par, NULL,
             -(al.quantite::numeric * fl.quantite_pieces / fl.quantite),
             -(al.montant::numeric * a.total_ht / NULLIF((SELECT sum(x.montant) FROM avoir_lignes x WHERE x.avoir_id = a.id), 0)),
             -(al.quantite::numeric * fl.quantite_pieces / fl.quantite * fl.cout_piece_centimes / 100.0)
        FROM avoir_lignes al
        JOIN avoirs a ON a.id = al.avoir_id
        JOIN facture_lignes fl ON fl.id = al.facture_ligne_id
        JOIN factures f ON f.id = fl.facture_id
        JOIN bons_livraison bl ON bl.id = f.bl_id
       WHERE a.date >= ${du} AND a.date <= ${au} ${filtreVendeur}`;
  }

  /** Le commercial ne voit que ses ventes ; les coûts et marges seulement avec « voir les coûts ». */
  private portee(u: UtilisateurConnecte) {
    const tout = u.permissions.has(PERMISSIONS.RAPPORTS_TOUS);
    return { vendeurId: tout ? undefined : u.id, voirCouts: u.permissions.has(PERMISSIONS.COUTS_VOIR) };
  }

  async ventes(du: string, au: string, groupe: GroupeVentes, u: UtilisateurConnecte) {
    const { vendeurId, voirCouts } = this.portee(u);
    const cles: Record<GroupeVentes, { cle: SQL; libelle: SQL; detail: SQL; jointure: SQL; ordre: SQL }> = {
      jour: { cle: sql`v.jour::text`, libelle: sql`to_char(v.jour, 'DD/MM/YYYY')`, detail: sql`NULL`, jointure: sql``, ordre: sql`1` },
      mois: { cle: sql`to_char(v.jour, 'YYYY-MM')`, libelle: sql`to_char(v.jour, 'MM/YYYY')`, detail: sql`NULL`, jointure: sql``, ordre: sql`1` },
      client: { cle: sql`c.id::text`, libelle: sql`c.raison_sociale`, detail: sql`c.code`, jointure: sql`JOIN clients c ON c.id = v.client_id`, ordre: sql`ca DESC` },
      produit: { cle: sql`p.id::text`, libelle: sql`p.designation`, detail: sql`p.code`, jointure: sql`JOIN produits p ON p.id = v.produit_id`, ordre: sql`ca DESC` },
      categorie: {
        cle: sql`k.id::text`,
        libelle: sql`k.nom`,
        detail: sql`CASE k.type WHEN 'cosmetique' THEN 'Cosmétique' ELSE 'Bazar' END`,
        jointure: sql`JOIN produits p ON p.id = v.produit_id JOIN categories k ON k.id = p.categorie_id`,
        ordre: sql`ca DESC`,
      },
      vendeur: { cle: sql`coalesce(us.id::text, '-')`, libelle: sql`coalesce(us.nom_complet, '-')`, detail: sql`us.identifiant`, jointure: sql`LEFT JOIN utilisateurs us ON us.id = v.vendeur_id`, ordre: sql`ca DESC` },
    };
    const g = cles[groupe];
    const lignes = await this.lignes<{ cle: string; libelle: string; detail: string | null; pieces: string; ca: string; cout: string; factures: string }>(sql`
      WITH v AS (${this.baseVentes(du, au, vendeurId)})
      SELECT ${g.cle} AS cle, ${g.libelle} AS libelle, ${g.detail} AS detail,
             sum(v.pieces) AS pieces, sum(v.ca) AS ca, sum(v.cout) AS cout, count(DISTINCT v.facture_id) AS factures
        FROM v ${g.jointure}
       GROUP BY 1, 2, 3
       ORDER BY ${g.ordre}`);
    const res = lignes.map((l) => {
      const ca = nombre(l.ca);
      const cout = nombre(l.cout);
      return {
        cle: l.cle,
        libelle: l.libelle,
        detail: l.detail,
        pieces: nombre(l.pieces),
        factures: Number(l.factures),
        ca,
        ...(voirCouts ? { cout, marge: ca - cout, tauxMarge: ca ? Math.round(((ca - cout) * 1000) / ca) / 10 : null } : {}),
      };
    });
    const [t] = await this.lignes<{ pieces: string; ca: string; cout: string; factures: string }>(sql`
      WITH v AS (${this.baseVentes(du, au, vendeurId)})
      SELECT sum(pieces) AS pieces, sum(ca) AS ca, sum(cout) AS cout, count(DISTINCT facture_id) AS factures FROM v`);
    const ca = nombre(t.ca);
    const cout = nombre(t.cout);
    return {
      du,
      au,
      groupe,
      sesVentesSeulement: !!vendeurId,
      lignes: res,
      totaux: { pieces: nombre(t.pieces), factures: Number(t.factures), ca, ...(voirCouts ? { cout, marge: ca - cout, tauxMarge: ca ? Math.round(((ca - cout) * 1000) / ca) / 10 : null } : {}) },
    };
  }

  /** Stock valorisé, rotation (ventes des N derniers jours) et lots à écouler (§5.7). */
  async stock(jours: number, u: UtilisateurConnecte) {
    const voirCouts = u.permissions.has(PERMISSIONS.COUTS_VOIR);
    const p = await this.parametres.lire();
    const depuis = new Date(Date.now() - jours * 24 * 3600_000);
    const lignes = await this.lignes<{ id: string; code: string; designation: string; categorie: string; stock: number; seuil: number; cmp: string; ventes: string; derniere: Date | null }>(sql`
      SELECT p.id, p.code, p.designation, k.nom AS categorie, p.stock, p.seuil_alerte AS seuil, p.cmp_centimes AS cmp,
             coalesce((SELECT -sum(m.quantite) FROM mouvements_stock m WHERE m.produit_id = p.id AND m.type = 'vente' AND m.date >= ${depuis}), 0) AS ventes,
             (SELECT max(m.date) FROM mouvements_stock m WHERE m.produit_id = p.id AND m.type = 'vente') AS derniere
        FROM produits p JOIN categories k ON k.id = p.categorie_id
       WHERE p.actif
       ORDER BY p.designation`);
    const produits = lignes.map((l) => {
      const ventes = nombre(l.ventes);
      const parJour = ventes / jours;
      const couverture = l.stock > 0 ? (parJour > 0 ? Math.round(l.stock / parJour) : null) : 0;
      return {
        id: l.id,
        code: l.code,
        designation: l.designation,
        categorie: l.categorie,
        stock: l.stock,
        seuil: l.seuil,
        ventes,
        derniereVente: l.derniere,
        /** Nombre de jours de vente que représente le stock (null : aucune vente sur la période). */
        couverture,
        rotationLente: l.stock > 0 && (couverture === null || couverture > jours * 2),
        ...(voirCouts ? { cmp: Math.round(Number(l.cmp) / 100), valeur: Math.round((l.stock * Number(l.cmp)) / 100) } : {}),
      };
    });
    const limite = aujourdhui(new Date(Date.now() + p.delaiAlertePeremptionJours * 24 * 3600_000));
    const lots = await this.lignes<{ produit: string; code: string; numero: string; peremption: string; quantite: number; cmp: string }>(sql`
      SELECT p.designation AS produit, p.code, l.numero, l.date_peremption::text AS peremption, l.quantite, p.cmp_centimes AS cmp
        FROM lots l JOIN produits p ON p.id = l.produit_id
       WHERE l.quantite > 0 AND l.date_peremption <= ${limite}
       ORDER BY l.date_peremption`);
    const jour = aujourdhui();
    return {
      jours,
      produits,
      lots: lots.map((l) => ({
        produit: l.produit,
        code: l.code,
        numero: l.numero,
        datePeremption: l.peremption,
        quantite: l.quantite,
        perime: l.peremption < jour,
        ...(voirCouts ? { valeur: Math.round((l.quantite * Number(l.cmp)) / 100) } : {}),
      })),
      totaux: {
        produits: produits.length,
        pieces: produits.reduce((t, x) => t + x.stock, 0),
        rotationLente: produits.filter((x) => x.rotationLente).length,
        ...(voirCouts ? { valeur: produits.reduce((t, x) => t + (x.valeur ?? 0), 0) } : {}),
      },
    };
  }

  /** Achats par fournisseur ou par produit (§5.7). */
  async achats(du: string, au: string, groupe: 'fournisseur' | 'produit') {
    if (groupe === 'produit') {
      const lignes = await this.lignes<{ cle: string; libelle: string; detail: string; pieces: string; montant: string; frais: string; achats: string }>(sql`
        SELECT p.id::text AS cle, p.designation AS libelle, p.code AS detail, sum(l.quantite_pieces) AS pieces,
               sum(l.montant) AS montant, sum(l.part_frais) AS frais, count(DISTINCT a.id) AS achats
          FROM achat_lignes l JOIN achats a ON a.id = l.achat_id JOIN produits p ON p.id = l.produit_id
         WHERE a.statut = 'valide' AND a.date >= ${du} AND a.date <= ${au}
         GROUP BY 1, 2, 3 ORDER BY sum(l.montant) DESC`);
      const res = lignes.map((l) => ({ cle: l.cle, libelle: l.libelle, detail: l.detail, achats: Number(l.achats), pieces: nombre(l.pieces), montant: nombre(l.montant), frais: nombre(l.frais), total: nombre(l.montant) + nombre(l.frais) }));
      return { du, au, groupe, lignes: res, totaux: { pieces: res.reduce((t, x) => t + x.pieces, 0), montant: res.reduce((t, x) => t + x.montant, 0), frais: res.reduce((t, x) => t + x.frais, 0), total: res.reduce((t, x) => t + x.total, 0) } };
    }
    const lignes = await this.lignes<{ cle: string; libelle: string; achats: string; montant: string; frais: string; total: string; paye: string }>(sql`
      SELECT f.id::text AS cle, f.nom AS libelle, count(*) AS achats, sum(a.total_marchandises) AS montant, sum(a.total_frais) AS frais,
             sum(a.total) AS total, sum(a.montant_paye) AS paye
        FROM achats a JOIN fournisseurs f ON f.id = a.fournisseur_id
       WHERE a.statut = 'valide' AND a.date >= ${du} AND a.date <= ${au}
       GROUP BY 1, 2 ORDER BY sum(a.total) DESC`);
    const res = lignes.map((l) => ({ cle: l.cle, libelle: l.libelle, achats: Number(l.achats), montant: nombre(l.montant), frais: nombre(l.frais), total: nombre(l.total), paye: nombre(l.paye), reste: nombre(l.total) - nombre(l.paye) }));
    const somme = (k: 'montant' | 'frais' | 'total' | 'paye' | 'reste') => res.reduce((t, x) => t + x[k], 0);
    return { du, au, groupe, lignes: res, totaux: { achats: res.reduce((t, x) => t + x.achats, 0), montant: somme('montant'), frais: somme('frais'), total: somme('total'), paye: somme('paye'), reste: somme('reste') } };
  }

  /** Mouvements de chaque compte sur la période : solde de début, entrées, sorties, solde de fin. */
  async tresorerie(du: string, au: string, u: UtilisateurConnecte) {
    const fin = lendemain(au);
    const lignes = await this.lignes<{ id: string; nom: string; type: string; debut: string; entrees: string; sorties: string }>(sql`
      SELECT c.id, c.nom, c.type,
             coalesce((SELECT sum(m.montant) FROM mouvements_tresorerie m WHERE m.compte_id = c.id AND m.date < ${du}::date), 0) AS debut,
             coalesce((SELECT sum(m.montant) FROM mouvements_tresorerie m WHERE m.compte_id = c.id AND m.date >= ${du}::date AND m.date < ${fin}::date AND m.montant > 0), 0) AS entrees,
             coalesce((SELECT -sum(m.montant) FROM mouvements_tresorerie m WHERE m.compte_id = c.id AND m.date >= ${du}::date AND m.date < ${fin}::date AND m.montant < 0), 0) AS sorties
        FROM comptes_tresorerie c
       ORDER BY array_position(array['caisse','mobile_money','banque']::text[], c.type::text), c.nom`);
    const voitCaisse = TresorerieService.voitCaisse(u);
    const comptes = lignes.map((l) => {
      const masque = l.type === 'caisse' && !voitCaisse;
      const debut = nombre(l.debut);
      const entrees = nombre(l.entrees);
      const sorties = nombre(l.sorties);
      return { id: l.id, nom: l.nom, type: l.type, masque, debut: masque ? null : debut, entrees: masque ? null : entrees, sorties: masque ? null : sorties, fin: masque ? null : debut + entrees - sorties };
    });
    return { du, au, comptes };
  }

  /** Résultat simplifié du mois (§5.7) : ventes - coût des marchandises vendues - dépenses, et pertes de stock. */
  async resultat(mois: string) {
    const du = `${mois}-01`;
    const d = new Date(`${du}T12:00:00`);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    const au = aujourdhui(d);
    const [v] = await this.lignes<{ ca: string; cout: string }>(sql`WITH v AS (${this.baseVentes(du, au)}) SELECT sum(ca) AS ca, sum(cout) AS cout FROM v`);
    const depenses = await this.lignes<{ categorie: string; montant: string }>(sql`
      SELECT k.nom AS categorie, sum(d.montant) AS montant FROM depenses d JOIN categories_depenses k ON k.id = d.categorie_id
       WHERE d.statut = 'valide' AND d.date >= ${du} AND d.date <= ${au} GROUP BY 1 ORDER BY 2 DESC`);
    const pertes = await this.lignes<{ type: string; valeur: string }>(sql`
      SELECT m.type, sum(m.quantite::numeric * m.cout_centimes / 100.0) AS valeur FROM mouvements_stock m
       WHERE m.type IN ('casse', 'peremption', 'ajustement', 'inventaire') AND m.date >= ${du}::date AND m.date < ${lendemain(au)}::date
       GROUP BY 1`);
    const [tva] = await this.lignes<{ facturee: string; avoirs: string }>(sql`
      SELECT (SELECT coalesce(sum(tva), 0) FROM factures WHERE date >= ${du} AND date <= ${au}) AS facturee,
             (SELECT coalesce(sum(tva), 0) FROM avoirs WHERE date >= ${du} AND date <= ${au}) AS avoirs`);
    const ventes = nombre(v.ca);
    const cmv = nombre(v.cout);
    const totalDepenses = depenses.reduce((t, x) => t + nombre(x.montant), 0);
    const libellesPertes: Record<string, string> = { casse: 'Casse', peremption: 'Péremption', ajustement: 'Ajustements de stock', inventaire: 'Écarts d’inventaire' };
    const lignesPertes = pertes.map((p) => ({ type: p.type, libelle: libellesPertes[p.type] ?? p.type, valeur: nombre(p.valeur) })).filter((p) => p.valeur !== 0);
    const totalPertes = lignesPertes.reduce((t, x) => t + x.valeur, 0);
    return {
      mois,
      du,
      au,
      ventes,
      coutMarchandises: cmv,
      margeBrute: ventes - cmv,
      tauxMarge: ventes ? Math.round(((ventes - cmv) * 1000) / ventes) / 10 : null,
      depenses: depenses.map((x) => ({ categorie: x.categorie, montant: nombre(x.montant) })),
      totalDepenses,
      /** Valeur des mouvements de stock hors ventes et achats : négatif = perte. */
      pertesStock: lignesPertes,
      totalPertesStock: totalPertes,
      resultat: ventes - cmv - totalDepenses + totalPertes,
      tvaCollectee: nombre(tva.facturee) - nombre(tva.avoirs),
    };
  }

  // ------------------------------------------------------------------ anti-fraude (§10.3)

  /** Actions sensibles d'une période, et toute opération faite hors des heures d'ouverture. */
  async actionsSensibles(du: string, au: string) {
    const p = await this.parametres.lire();
    const entrees = await this.db
      .select({ e: journalAudit, utilisateur: utilisateurs.nomComplet })
      .from(journalAudit)
      .leftJoin(utilisateurs, sql`${utilisateurs.id} = ${journalAudit.utilisateurId}`)
      .where(and(gte(journalAudit.horodatage, new Date(`${du}T00:00:00`)), sql`${journalAudit.horodatage} < ${new Date(`${lendemain(au)}T00:00:00`)}`))
      .orderBy(desc(journalAudit.id))
      .limit(5_000);
    const res = [];
    for (const { e, utilisateur } of entrees) {
      const heure = heureLocale(e.horodatage);
      const horsHeures = (heure < p.heureOuverture || heure >= p.heureFermeture) && !e.action.startsWith('sauvegarde.');
      const details = (e.details ?? {}) as Record<string, unknown>;
      let raison: string | undefined = ACTIONS_SENSIBLES[e.action];
      // Une clôture sans écart, une livraison sans remise ne sont pas sensibles.
      if (e.action === 'caisse.cloture_saisie' && !Number(details.ecart)) raison = undefined;
      if (e.action === 'livraison.validee' && (Number(details.remiseGlobalePct) > 0 || Number(details.remisesLignes) > 0)) raison = 'Livraison avec remise';
      if (!raison && !horsHeures) continue;
      res.push({
        id: e.id,
        horodatage: e.horodatage,
        action: e.action,
        libelle: raison ?? e.action,
        horsHeures,
        utilisateur,
        entite: e.entite,
        details: e.details,
      });
    }
    return { du, au, heureOuverture: p.heureOuverture, heureFermeture: p.heureFermeture, actions: res };
  }

  /** Alertes du tableau de bord (§10.3) : écarts de caisse et d'inventaire, opérations hors heures. */
  async alertesFraude() {
    const p = await this.parametres.lire();
    const il7 = aujourdhui(new Date(Date.now() - 6 * 24 * 3600_000));
    const il30 = new Date(Date.now() - 30 * 24 * 3600_000);
    const caisses = await this.lignes<{ jour: string; compte: string; ecart: string }>(sql`
      SELECT c.jour::text AS jour, k.nom AS compte, c.ecart FROM clotures_caisse c JOIN comptes_tresorerie k ON k.id = c.compte_id
       WHERE c.statut <> 'refusee' AND abs(c.ecart) >= ${p.seuilAlerteEcart} AND c.jour >= ${il7} ORDER BY c.jour DESC`);
    const inventaires = await this.lignes<{ id: string; libelle: string; valeur: string }>(sql`
      SELECT i.id, i.libelle, sum(m.quantite::numeric * m.cout_centimes / 100.0) AS valeur
        FROM inventaires i JOIN mouvements_stock m ON m.document_type = 'inventaire' AND m.document_id = i.id
       WHERE i.statut = 'valide' AND i.valide_le >= ${il30}
       GROUP BY 1, 2 HAVING abs(sum(m.quantite::numeric * m.cout_centimes / 100.0)) >= ${p.seuilAlerteEcart}`);
    const sensibles = await this.actionsSensibles(il7, aujourdhui());
    return {
      seuil: p.seuilAlerteEcart,
      ecartsCaisse: caisses.map((c) => ({ jour: c.jour, compte: c.compte, ecart: nombre(c.ecart) })),
      ecartsInventaire: inventaires.map((i) => ({ id: i.id, libelle: i.libelle, valeur: nombre(i.valeur) })),
      horsHeures: sensibles.actions.filter((a) => a.horsHeures).length,
      sensiblesAujourdhui: sensibles.actions.filter((a) => !a.horsHeures && aujourdhui(a.horodatage) === aujourdhui()).length,
    };
  }
}
