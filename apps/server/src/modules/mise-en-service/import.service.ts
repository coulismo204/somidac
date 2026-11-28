import { Inject, Injectable } from '@nestjs/common';
import { ErreurImport, FeuilleImport, ImportDto, ResultatImport } from '@somidac/shared';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { categories, clients, codesBarres, conditionnements, fournisseurs, marques, produits, sites } from '../../noyau/base/schema';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { codeProduitSuivant } from '../catalogue/catalogue.service';
import { StockService } from '../stock/stock.service';
import { codeClientSuivant } from '../ventes/clients.service';

/** Sert à annuler la transaction quand on ne fait que vérifier, ou qu'il y a des erreurs. */
class Annulation extends Error {}

const cle = (t: string) => t.trim().toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ');

/**
 * Import du fichier Excel de départ (lot 6). La vérification suit exactement le même chemin que
 * l'import réel, dans une transaction annulée à la fin : ce qui est annoncé est ce qui sera fait.
 * L'import réel est tout ou rien.
 */
@Injectable()
export class ImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async traiter(dto: ImportDto, u: UtilisateurConnecte, appareilId: string): Promise<ResultatImport> {
    let resultat: ResultatImport | undefined;
    try {
      await this.db.transaction(async (tx) => {
        resultat = await this.executer(tx, dto, u);
        if (dto.verifierSeulement || !resultat.valide) throw new Annulation();
        await this.audit.enregistrer(tx, { action: 'import.catalogue', utilisateurId: u.id, appareilId, details: resultat.compte });
        resultat.enregistre = true;
      });
    } catch (e) {
      if (!(e instanceof Annulation)) throw e;
    }
    return resultat!;
  }

  private async executer(tx: Tx, dto: ImportDto, u: UtilisateurConnecte): Promise<ResultatImport> {
    const erreurs: ErreurImport[] = [];
    const avertissements: ErreurImport[] = [];
    const erreur = (feuille: FeuilleImport, ligne: number, message: string) => erreurs.push({ feuille, ligne, message });
    const avertir = (feuille: FeuilleImport, ligne: number, message: string) => avertissements.push({ feuille, ligne, message });
    const compte = { produits: 0, categories: 0, marques: 0, fournisseurs: 0, clients: 0, lignesStock: 0, piecesStock: 0, valeurStock: 0 };

    const [site] = await tx.select().from(sites).limit(1);
    const cats = new Map((await tx.select().from(categories)).map((c) => [cle(c.nom), c.id]));
    const mqs = new Map((await tx.select().from(marques)).map((m) => [cle(m.nom), m.id]));
    const existants = await tx.select({ id: produits.id, code: produits.code, designation: produits.designation, suiviLot: produits.suiviLot, stock: produits.stock }).from(produits);
    const parDesignation = new Map(existants.map((p) => [cle(p.designation), p]));
    const parCode = new Map(existants.map((p) => [p.code.toUpperCase(), p]));
    const codesPris = new Set((await tx.select({ code: codesBarres.code }).from(codesBarres)).map((c) => c.code));

    // ---------------------------------------------------------------- produits
    for (const p of dto.produits) {
      const n = p.ligne;
      const avant = erreurs.length;
      if (parDesignation.has(cle(p.designation))) erreur('produits', n, `« ${p.designation} » existe déjà (dans l’application ou plus haut dans la feuille)`);
      let categorieId = cats.get(cle(p.categorie));
      if (!categorieId && !p.typeCategorie) erreur('produits', n, `Catégorie « ${p.categorie} » inconnue : indiquez son type (cosmétique ou bazar) pour la créer`);
      if (p.conditionnement && !p.piecesParConditionnement) erreur('produits', n, `Indiquez le nombre de pièces du conditionnement « ${p.conditionnement} »`);
      if ((p.prixConditionnement != null || p.codeBarreConditionnement) && !p.piecesParConditionnement) erreur('produits', n, 'Prix ou code-barres de conditionnement sans nombre de pièces');
      for (const code of [p.codeBarrePiece, p.codeBarreConditionnement]) {
        if (!code) continue;
        if (!/^[0-9A-Za-z-]{4,32}$/.test(code)) erreur('produits', n, `Code-barres invalide : ${code}`);
        else if (codesPris.has(code)) erreur('produits', n, `Le code-barres ${code} est déjà utilisé`);
      }
      if (p.codeBarrePiece && p.codeBarrePiece === p.codeBarreConditionnement) erreur('produits', n, 'Même code-barres pour la pièce et le conditionnement');
      if (erreurs.length > avant) continue;

      if (p.prixPiece == null && p.prixConditionnement == null) avertir('produits', n, `« ${p.designation} » n’a pas de prix de vente : il faudra le fixer avant de le vendre`);
      if (!categorieId) {
        const [c] = await tx.insert(categories).values({ nom: p.categorie.trim(), type: p.typeCategorie! }).returning();
        categorieId = c.id;
        cats.set(cle(p.categorie), c.id);
        compte.categories++;
      }
      let marqueId: string | null = null;
      if (p.marque) {
        marqueId = mqs.get(cle(p.marque)) ?? null;
        if (!marqueId) {
          const [m] = await tx.insert(marques).values({ nom: p.marque.trim() }).returning();
          marqueId = m.id;
          mqs.set(cle(p.marque), m.id);
          compte.marques++;
        }
      }
      const code = await codeProduitSuivant(tx);
      const [cree] = await tx
        .insert(produits)
        .values({ siteId: site.id, code, designation: p.designation.trim(), categorieId, marqueId, suiviLot: p.suiviLot, seuilAlerte: p.seuilAlerte, creePar: u.id })
        .returning();
      const [piece] = await tx.insert(conditionnements).values({ produitId: cree.id, nom: 'Pièce', nbPieces: 1, prixVente: p.prixPiece ?? null }).returning();
      let lot: typeof piece | undefined;
      if (p.piecesParConditionnement) {
        [lot] = await tx
          .insert(conditionnements)
          .values({ produitId: cree.id, nom: p.conditionnement ?? `Carton de ${p.piecesParConditionnement}`, nbPieces: p.piecesParConditionnement, prixVente: p.prixConditionnement ?? null })
          .returning();
      }
      for (const [codeBarre, cond] of [[p.codeBarrePiece, piece], [p.codeBarreConditionnement, lot]] as const) {
        if (!codeBarre || !cond) continue;
        await tx.insert(codesBarres).values({ code: codeBarre, produitId: cree.id, conditionnementId: cond.id });
        codesPris.add(codeBarre);
      }
      const vue = { id: cree.id, code, designation: cree.designation, suiviLot: cree.suiviLot, stock: 0 };
      parDesignation.set(cle(p.designation), vue);
      parCode.set(code, vue);
      compte.produits++;
    }

    // ---------------------------------------------------------------- fournisseurs et clients
    const nomsFournisseurs = new Set((await tx.select({ nom: fournisseurs.nom }).from(fournisseurs)).map((f) => cle(f.nom)));
    for (const f of dto.fournisseurs) {
      if (nomsFournisseurs.has(cle(f.nom))) {
        erreur('fournisseurs', f.ligne, `« ${f.nom} » existe déjà`);
        continue;
      }
      await tx.insert(fournisseurs).values({ nom: f.nom.trim(), telephone: f.telephone, adresse: f.adresse, nif: f.nif });
      nomsFournisseurs.add(cle(f.nom));
      compte.fournisseurs++;
    }
    const nomsClients = new Set((await tx.select({ nom: clients.raisonSociale }).from(clients)).map((c) => cle(c.nom)));
    for (const c of dto.clients) {
      if (nomsClients.has(cle(c.raisonSociale))) {
        erreur('clients', c.ligne, `« ${c.raisonSociale} » existe déjà`);
        continue;
      }
      await tx.insert(clients).values({
        siteId: site.id,
        code: await codeClientSuivant(tx),
        raisonSociale: c.raisonSociale.trim(),
        type: c.type,
        contact: c.contact,
        telephone: c.telephone,
        adresse: c.adresse,
        nif: c.nif,
        blSansPrix: c.blSansPrix,
        creePar: u.id,
      });
      nomsClients.add(cle(c.raisonSociale));
      compte.clients++;
    }

    // ---------------------------------------------------------------- stock d'ouverture
    const dejaEnStock = new Set<string>();
    for (const s of dto.stock) {
      const p = parCode.get(s.produit.trim().toUpperCase()) ?? parDesignation.get(cle(s.produit));
      if (!p) {
        erreur('stock', s.ligne, `Produit « ${s.produit} » introuvable (ni dans l’application, ni dans la feuille Produits)`);
        continue;
      }
      if (p.suiviLot && (!s.numeroLot || !s.datePeremption)) {
        erreur('stock', s.ligne, `« ${p.designation} » est suivi par lot : numéro de lot et date de péremption obligatoires`);
        continue;
      }
      if (p.stock > 0 && !dejaEnStock.has(p.id)) {
        avertir('stock', s.ligne, `« ${p.designation} » a déjà ${p.stock} pièce(s) en stock : elles s’ajouteront`);
        dejaEnStock.add(p.id);
      }
      if (s.coutUnitaire === 0) avertir('stock', s.ligne, `« ${p.designation} » : coût unitaire à 0, la marge sera faussée`);
      await this.stock.entree(tx, {
        produitId: p.id,
        quantite: s.quantite,
        coutCentimes: Math.round(s.coutUnitaire * 100),
        numeroLot: s.numeroLot,
        datePeremption: s.datePeremption ?? null,
        type: 'ouverture',
        motif: 'Stock d’ouverture (import)',
        utilisateurId: u.id,
      });
      compte.lignesStock++;
      compte.piecesStock += s.quantite;
      compte.valeurStock += Math.round(s.quantite * s.coutUnitaire);
    }

    return { valide: erreurs.length === 0, enregistre: false, erreurs, avertissements, compte };
  }
}
