import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  BP,
  calculerTotaux,
  LivraisonDto,
  montantLigne,
  PERMISSIONS,
  pctVersBp,
  ReceptionDto,
  remiseCumuleeBp,
} from '@somidac/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, DbOuTx, Tx } from '../../noyau/base/base';
import {
  blLignes,
  blSorties,
  bonsLivraison,
  clients,
  conditionnements,
  factureLignes,
  factures,
  lots,
  prixClients,
  produits,
} from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { ParametresService } from '../../noyau/parametres/parametres.service';
import { SequencesService } from '../../noyau/sequences/sequences.service';
import { aujourdhui, DocumentOrigine, StockService } from '../stock/stock.service';

type StatutLivraison = (typeof bonsLivraison.$inferSelect)['statut'];

/** Ajoute des jours à une date AAAA-MM-JJ. */
export function ajouterJours(jour: string, jours: number): string {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() + jours);
  return aujourdhui(d);
}

/**
 * Contrôle des remises (R3) : sans la permission, aucune remise ; avec, la remise effective
 * d'une ligne (ligne + total) ne dépasse pas le plafond de l'utilisateur, sauf pour le gérant.
 */
export function verifierRemises(u: UtilisateurConnecte, remiseGlobaleBp: number, remisesLignesBp: number[]) {
  const effective = Math.max(remiseGlobaleBp, ...remisesLignesBp.map((r) => remiseCumuleeBp(r, remiseGlobaleBp)));
  if (effective === 0 || u.permissions.has(PERMISSIONS.REMISES_SANS_LIMITE)) return;
  if (!u.permissions.has(PERMISSIONS.REMISES_ACCORDER)) {
    throw new ErreurMetier('PERMISSION_REFUSEE', "Vous n'avez pas le droit d'accorder une remise", HttpStatus.FORBIDDEN);
  }
  if (effective > u.plafondRemisePct * 100) {
    throw new ErreurMetier(
      'REMISE_PLAFOND',
      `Remise de ${(effective / 100).toLocaleString('fr-FR')} % refusée : votre plafond est de ${u.plafondRemisePct} %`,
      HttpStatus.FORBIDDEN,
    );
  }
}

@Injectable()
export class LivraisonsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly stock: StockService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditService,
    private readonly parametres: ParametresService,
  ) {}

  // ------------------------------------------------------------------ consultation

  async lister(statut?: string) {
    return this.db
      .select({
        id: bonsLivraison.id,
        numero: bonsLivraison.numero,
        date: bonsLivraison.date,
        statut: bonsLivraison.statut,
        clientId: bonsLivraison.clientId,
        client: clients.raisonSociale,
        referenceClient: bonsLivraison.referenceClient,
        totalHT: bonsLivraison.totalHT,
        nbLignes: sql<number>`(SELECT count(*)::int FROM ${blLignes} WHERE ${blLignes.blId} = ${bonsLivraison.id})`,
        factureId: factures.id,
        factureNumero: factures.numero,
        creeLe: bonsLivraison.creeLe,
      })
      .from(bonsLivraison)
      .innerJoin(clients, eq(clients.id, bonsLivraison.clientId))
      .leftJoin(factures, eq(factures.blId, bonsLivraison.id))
      .where(statut ? eq(bonsLivraison.statut, statut as StatutLivraison) : undefined)
      .orderBy(sql`${bonsLivraison.statut} = 'brouillon' DESC`, desc(bonsLivraison.date), desc(bonsLivraison.creeLe))
      .limit(500);
  }

  async detail(id: string, voirCouts: boolean) {
    const [b] = await this.db
      .select({ bl: bonsLivraison, client: clients })
      .from(bonsLivraison)
      .innerJoin(clients, eq(clients.id, bonsLivraison.clientId))
      .where(eq(bonsLivraison.id, id));
    if (!b) throw new ErreurMetier('INTROUVABLE', 'Bon de livraison introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({
        l: blLignes,
        produit: produits.designation,
        codeProduit: produits.code,
        suiviLot: produits.suiviLot,
        stock: produits.stock,
        conditionnement: conditionnements.nom,
        nbPieces: conditionnements.nbPieces,
      })
      .from(blLignes)
      .innerJoin(produits, eq(produits.id, blLignes.produitId))
      .innerJoin(conditionnements, eq(conditionnements.id, blLignes.conditionnementId))
      .where(eq(blLignes.blId, id))
      .orderBy(asc(blLignes.ordre));
    const sorties = lignes.length
      ? await this.db
          .select({ s: blSorties, numero: lots.numero, datePeremption: lots.datePeremption })
          .from(blSorties)
          .innerJoin(lots, eq(lots.id, blSorties.lotId))
          .where(inArray(blSorties.blLigneId, lignes.map((l) => l.l.id)))
          .orderBy(asc(blSorties.ordre))
      : [];
    const [facture] = await this.db.select({ id: factures.id, numero: factures.numero }).from(factures).where(eq(factures.blId, id));
    const bl = b.bl;
    const coutTotal = lignes.reduce((t, x) => t + (x.l.quantitePieces ?? 0) * (x.l.coutPieceCentimes ?? 0), 0);
    return {
      ...bl,
      remiseGlobalePct: b.bl.remiseGlobaleBp / 100,
      client: {
        id: b.client.id,
        code: b.client.code,
        raisonSociale: b.client.raisonSociale,
        type: b.client.type,
        adresse: b.client.adresse,
        telephone: b.client.telephone,
        nif: b.client.nif,
        blSansPrix: b.client.blSansPrix,
      },
      facture: facture ?? null,
      lignes: lignes.map((x) => {
        const { coutPieceCentimes, ...l } = x.l;
        return {
          ...l,
          remisePct: l.remiseBp / 100,
          produit: x.produit,
          codeProduit: x.codeProduit,
          suiviLot: x.suiviLot,
          stockDisponible: x.stock,
          conditionnement: x.conditionnement,
          nbPieces: x.nbPieces,
          lots: sorties
            .filter((s) => s.s.blLigneId === l.id)
            .map((s) => ({ numero: s.numero, datePeremption: s.datePeremption, quantite: s.s.quantite, quantiteRetournee: s.s.quantiteRetournee })),
          ...(voirCouts && coutPieceCentimes != null ? { coutPiece: Math.round(coutPieceCentimes / 100) } : {}),
        };
      }),
      ...(voirCouts && b.bl.statut !== 'brouillon' ? { coutTotal: Math.round(coutTotal / 100) } : {}),
    };
  }

  // ------------------------------------------------------------------ brouillon

  async creer(dto: LivraisonDto, u: UtilisateurConnecte) {
    return this.db.transaction(async (tx) => {
      const [b] = await tx.insert(bonsLivraison).values({ clientId: dto.clientId, date: dto.date, creePar: u.id }).returning();
      await this.ecrireContenu(tx, b.id, dto, u);
      return { id: b.id };
    });
  }

  async modifier(id: string, dto: LivraisonDto, u: UtilisateurConnecte) {
    return this.db.transaction(async (tx) => {
      await this.verrouiller(tx, id, ['brouillon']);
      await this.ecrireContenu(tx, id, dto, u);
      return { id };
    });
  }

  /** Un brouillon n'a touché ni au stock ni à la numérotation : il peut être supprimé. */
  async supprimer(id: string) {
    return this.db.transaction(async (tx) => {
      await this.verrouiller(tx, id, ['brouillon']);
      await tx.delete(bonsLivraison).where(eq(bonsLivraison.id, id));
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ étapes de la livraison (§5.5)

  /** Validation : prix figés (R3), numéro BL (R6), sortie du stock lot par lot (R4, R5), coût de la vente (R2). */
  async valider(id: string, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const b = await this.verrouiller(tx, id, ['brouillon']);
      const lignes = await tx.select().from(blLignes).where(eq(blLignes.blId, id)).orderBy(asc(blLignes.ordre));
      if (!lignes.length) throw new ErreurMetier('LIVRAISON_VIDE', 'Le bon de livraison ne contient aucune ligne');
      const [client] = await tx.select().from(clients).where(eq(clients.id, b.clientId));
      if (!client.actif) throw new ErreurMetier('CLIENT_INACTIF', 'Ce client est désactivé');

      // Les produits sont verrouillés dans un ordre fixe : deux postes qui valident en même temps
      // des bons portant les mêmes produits s'attendent au lieu de se bloquer mutuellement.
      const idsProduits = [...new Set(lignes.map((l) => l.produitId))].sort();
      const prods = await tx.select().from(produits).where(inArray(produits.id, idsProduits)).orderBy(asc(produits.id)).for('update');
      const conds = await tx.select().from(conditionnements).where(inArray(conditionnements.id, lignes.map((l) => l.conditionnementId)));
      const prix = await this.prixApplicables(tx, b.clientId, conds.map((c) => c.id));

      const numero = await this.sequences.suivant(tx, 'BL', new Date(`${b.date}T12:00:00`));
      const montants: number[] = [];
      for (const l of lignes) {
        const p = prods.find((x) => x.id === l.produitId)!;
        const c = conds.find((x) => x.id === l.conditionnementId)!;
        if (!p.actif) throw new ErreurMetier('PRODUIT_INACTIF', `« ${p.designation} » est archivé`);
        const prixUnitaire = prix.get(c.id);
        if (prixUnitaire == null) {
          throw new ErreurMetier('PRIX_MANQUANT', `« ${p.designation} » (${c.nom}) n'a pas de prix de vente : fixez-le dans la fiche produit`);
        }
        const pieces = l.quantite * c.nbPieces;
        const sorties = await this.stock.sortie(tx, {
          produitId: p.id,
          quantite: pieces,
          type: 'vente',
          document: { type: 'bon_livraison', id },
          utilisateurId: u.id,
        });
        await tx.insert(blSorties).values(sorties.map((s, i) => ({ blLigneId: l.id, ordre: i, lotId: s.lotId, quantite: s.quantite, coutCentimes: s.coutCentimes })));
        const cout = Math.round(sorties.reduce((t, s) => t + s.quantite * s.coutCentimes, 0) / pieces);
        const montant = montantLigne(l.quantite, prixUnitaire, l.remiseBp);
        montants.push(montant);
        await tx.update(blLignes).set({ prixUnitaire, montant, quantitePieces: pieces, coutPieceCentimes: cout }).where(eq(blLignes.id, l.id));
      }
      const totaux = calculerTotaux(montants, b.remiseGlobaleBp, 0);
      await tx
        .update(bonsLivraison)
        .set({ numero, statut: 'livre', totalLignes: totaux.totalLignes, totalHT: totaux.totalHT, validePar: u.id, valideLe: new Date() })
        .where(eq(bonsLivraison.id, id));
      await this.audit.enregistrer(tx, {
        action: 'livraison.validee',
        utilisateurId: u.id,
        appareilId,
        entite: 'bon_livraison',
        entiteId: id,
        details: {
          numero,
          client: client.raisonSociale,
          totalHT: totaux.totalHT,
          lignes: lignes.length,
          remiseGlobalePct: b.remiseGlobaleBp / 100,
          remisesLignes: lignes.filter((l) => l.remiseBp > 0).length,
        },
      });
      return { id, numero, totalHT: totaux.totalHT };
    });
  }

  /** Réception chez le client : quantités acceptées ; les refus reviennent en stock dans leur lot. */
  async receptionner(id: string, dto: ReceptionDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const b = await this.verrouiller(tx, id, ['livre']);
      const lignes = await tx.select().from(blLignes).where(eq(blLignes.blId, id)).orderBy(asc(blLignes.ordre));
      const saisies = new Map(dto.lignes.map((l) => [l.ligneId, l]));
      if (saisies.size !== dto.lignes.length || lignes.some((l) => !saisies.has(l.id)) || saisies.size !== lignes.length) {
        throw new ErreurMetier('RECEPTION_INCOMPLETE', 'Indiquez la quantité acceptée pour chaque ligne du bon');
      }
      let refusees = 0;
      let acceptees = 0;
      for (const l of lignes) {
        const s = saisies.get(l.id)!;
        if (s.quantiteAcceptee > l.quantite) {
          throw new ErreurMetier('QUANTITE_INVALIDE', 'La quantité acceptée ne peut pas dépasser la quantité livrée');
        }
        const refus = l.quantite - s.quantiteAcceptee;
        if (refus > 0 && !s.motifRefus) throw new ErreurMetier('MOTIF_REQUIS', 'Indiquez le motif de chaque refus (casse, date courte…)');
        if (refus > 0) {
          const piecesParUnite = l.quantitePieces! / l.quantite;
          await this.rendreAuStock(tx, l.id, refus * piecesParUnite, {
            destination: 'stock',
            motif: `Refus à la livraison ${b.numero} : ${s.motifRefus}`,
            document: { type: 'bon_livraison', id },
            utilisateurId: u.id,
          });
        }
        refusees += refus;
        acceptees += s.quantiteAcceptee;
        await tx
          .update(blLignes)
          .set({ quantiteAcceptee: s.quantiteAcceptee, motifRefus: refus > 0 ? s.motifRefus : null })
          .where(eq(blLignes.id, l.id));
      }
      const statut = acceptees === 0 ? 'retourne' : 'receptionne';
      await tx.update(bonsLivraison).set({ statut, receptionPar: u.id, receptionLe: new Date() }).where(eq(bonsLivraison.id, id));
      await this.audit.enregistrer(tx, {
        action: 'livraison.receptionnee',
        utilisateurId: u.id,
        appareilId,
        entite: 'bon_livraison',
        entiteId: id,
        details: { numero: b.numero, refusees, acceptees, statut },
      });
      return { id, statut };
    });
  }

  /** Facture (§5.5) : générée à partir des quantités acceptées, numéro FAC, TVA selon les paramètres (R9). */
  async facturer(id: string, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const b = await this.verrouiller(tx, id, ['receptionne']);
      const [client] = await tx.select().from(clients).where(eq(clients.id, b.clientId));
      const lignes = await tx
        .select({ l: blLignes, designation: produits.designation })
        .from(blLignes)
        .innerJoin(produits, eq(produits.id, blLignes.produitId))
        .where(eq(blLignes.blId, id))
        .orderBy(asc(blLignes.ordre));
      const facturees = lignes.filter((x) => (x.l.quantiteAcceptee ?? 0) > 0);
      if (!facturees.length) throw new ErreurMetier('RIEN_A_FACTURER', 'Aucune marchandise acceptée : rien à facturer');
      const params = await this.parametres.lire(tx);
      const tauxTvaBp = params.tvaActive ? params.tauxTvaBp : 0;

      const contenu = facturees.map(({ l, designation }, i) => {
        const quantite = l.quantiteAcceptee!;
        return {
          blLigneId: l.id,
          ordre: i,
          produitId: l.produitId,
          conditionnementId: l.conditionnementId,
          designation,
          quantite,
          prixUnitaire: l.prixUnitaire!,
          remiseBp: l.remiseBp,
          montant: montantLigne(quantite, l.prixUnitaire!, l.remiseBp),
          quantitePieces: (l.quantitePieces! / l.quantite) * quantite,
          coutPieceCentimes: l.coutPieceCentimes!,
        };
      });
      const totaux = calculerTotaux(contenu.map((c) => c.montant), b.remiseGlobaleBp, tauxTvaBp);
      const date = aujourdhui();
      const numero = await this.sequences.suivant(tx, 'FAC', new Date(`${date}T12:00:00`));
      const [f] = await tx
        .insert(factures)
        .values({
          numero,
          blId: id,
          clientId: b.clientId,
          date,
          echeance: client.conditionPaiement === 'credit' ? ajouterJours(date, client.delaiPaiementJours) : date,
          referenceClient: b.referenceClient,
          remiseGlobaleBp: b.remiseGlobaleBp,
          ...totaux,
          tauxTvaBp,
          creePar: u.id,
        })
        .returning();
      await tx.insert(factureLignes).values(contenu.map((c) => ({ ...c, factureId: f.id })));
      await tx.update(bonsLivraison).set({ statut: 'facture' }).where(eq(bonsLivraison.id, id));
      await this.audit.enregistrer(tx, {
        action: 'facture.emise',
        utilisateurId: u.id,
        appareilId,
        entite: 'facture',
        entiteId: f.id,
        details: { numero, bonLivraison: b.numero, client: client.raisonSociale, totalTTC: totaux.totalTTC },
      });
      return { id: f.id, numero, totalTTC: totaux.totalTTC };
    });
  }

  // ------------------------------------------------------------------ outils partagés

  /** Prix appliqué (R3) : le prix particulier du client s'il existe, sinon le prix par défaut. */
  async prixApplicables(tx: DbOuTx, clientId: string, conditionnementIds: string[]): Promise<Map<string, number | null>> {
    const res = new Map<string, number | null>();
    if (!conditionnementIds.length) return res;
    const conds = await tx
      .select({ id: conditionnements.id, prixVente: conditionnements.prixVente })
      .from(conditionnements)
      .where(inArray(conditionnements.id, conditionnementIds));
    const particuliers = await tx
      .select()
      .from(prixClients)
      .where(and(eq(prixClients.clientId, clientId), inArray(prixClients.conditionnementId, conditionnementIds)));
    for (const c of conds) res.set(c.id, particuliers.find((p) => p.conditionnementId === c.id)?.prix ?? c.prixVente ?? null);
    return res;
  }

  /**
   * Remet en stock des pièces sorties pour une ligne de BL, dans les lots d'où elles venaient
   * (dans l'ordre de sortie), au coût de la vente. Destination « casse » : la marchandise revient
   * puis sort aussitôt en casse, pour que le stock et l'historique restent justes.
   */
  async rendreAuStock(
    tx: Tx,
    blLigneId: string,
    pieces: number,
    r: { destination: 'stock' | 'casse'; motif: string; document: DocumentOrigine; utilisateurId: string },
  ) {
    const [ligne] = await tx.select({ produitId: blLignes.produitId }).from(blLignes).where(eq(blLignes.id, blLigneId));
    const sorties = await tx
      .select({ s: blSorties, numero: lots.numero, datePeremption: lots.datePeremption })
      .from(blSorties)
      .innerJoin(lots, eq(lots.id, blSorties.lotId))
      .where(eq(blSorties.blLigneId, blLigneId))
      .orderBy(asc(blSorties.ordre))
      .for('update', { of: blSorties });
    let reste = pieces;
    for (const { s, numero, datePeremption } of sorties) {
      if (reste === 0) break;
      const q = Math.min(reste, s.quantite - s.quantiteRetournee);
      if (q <= 0) continue;
      const lotId = await this.stock.entree(tx, {
        produitId: ligne.produitId,
        quantite: q,
        coutCentimes: s.coutCentimes,
        numeroLot: numero || null,
        datePeremption,
        type: 'retour_client',
        document: r.document,
        motif: r.motif,
        utilisateurId: r.utilisateurId,
      });
      if (r.destination === 'casse') {
        await this.stock.sortie(tx, { produitId: ligne.produitId, quantite: q, lotId, type: 'casse', document: r.document, motif: r.motif, utilisateurId: r.utilisateurId });
      }
      await tx.update(blSorties).set({ quantiteRetournee: s.quantiteRetournee + q }).where(eq(blSorties.id, s.id));
      reste -= q;
    }
    if (reste > 0) throw new ErreurMetier('RETOUR_IMPOSSIBLE', 'Plus de marchandise que ce qui a été livré');
  }

  private async verrouiller(tx: Tx, id: string, statuts: StatutLivraison[]) {
    const [b] = await tx.select().from(bonsLivraison).where(eq(bonsLivraison.id, id)).for('update');
    if (!b) throw new ErreurMetier('INTROUVABLE', 'Bon de livraison introuvable', HttpStatus.NOT_FOUND);
    if (!statuts.includes(b.statut)) {
      const messages: Record<StatutLivraison, string> = {
        brouillon: "Ce bon n'est pas encore validé",
        livre: 'Ce bon est validé : il ne peut plus être modifié (règle R7)',
        receptionne: 'La réception de ce bon est déjà enregistrée',
        facture: 'Ce bon est déjà facturé',
        retourne: 'Toute la marchandise de ce bon a été refusée',
      };
      throw new ErreurMetier('STATUT_LIVRAISON', messages[b.statut], HttpStatus.CONFLICT);
    }
    return b;
  }

  private async ecrireContenu(tx: Tx, id: string, dto: LivraisonDto, u: UtilisateurConnecte) {
    const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, dto.clientId), eq(clients.actif, true)));
    if (!c) throw new ErreurMetier('CLIENT_INCONNU', 'Client inconnu ou désactivé');
    const remiseGlobaleBp = pctVersBp(dto.remiseGlobalePct);
    const remises = dto.lignes.map((l) => pctVersBp(l.remisePct));
    if (remiseGlobaleBp > BP || remises.some((r) => r > BP)) throw new ErreurMetier('REMISE_INVALIDE', 'Remise invalide');
    verifierRemises(u, remiseGlobaleBp, remises);

    const conds = dto.lignes.length
      ? await tx
          .select({ id: conditionnements.id, produitId: conditionnements.produitId, actif: conditionnements.actif, nom: conditionnements.nom })
          .from(conditionnements)
          .where(inArray(conditionnements.id, dto.lignes.map((l) => l.conditionnementId)))
      : [];
    for (const l of dto.lignes) {
      const cond = conds.find((x) => x.id === l.conditionnementId);
      if (!cond || cond.produitId !== l.produitId) throw new ErreurMetier('CONDITIONNEMENT_INVALIDE', 'Conditionnement incohérent avec le produit');
      if (!cond.actif) throw new ErreurMetier('CONDITIONNEMENT_INACTIF', `Le conditionnement « ${cond.nom} » n'est plus utilisé`);
    }
    // Prix indicatifs pour le brouillon (ils sont recalculés et figés à la validation).
    const prix = await this.prixApplicables(tx, dto.clientId, conds.map((x) => x.id));
    const montants = dto.lignes.map((l, i) => {
      const p = prix.get(l.conditionnementId);
      return p == null ? 0 : montantLigne(l.quantite, p, remises[i]);
    });
    const totaux = calculerTotaux(montants, remiseGlobaleBp, 0);
    await tx
      .update(bonsLivraison)
      .set({
        clientId: dto.clientId,
        date: dto.date,
        referenceClient: dto.referenceClient ?? null,
        notes: dto.notes ?? null,
        remiseGlobaleBp,
        totalLignes: totaux.totalLignes,
        totalHT: totaux.totalHT,
      })
      .where(eq(bonsLivraison.id, id));
    await tx.delete(blLignes).where(eq(blLignes.blId, id));
    if (dto.lignes.length) {
      await tx.insert(blLignes).values(
        dto.lignes.map((l, i) => ({
          blId: id,
          ordre: i,
          produitId: l.produitId,
          conditionnementId: l.conditionnementId,
          quantite: l.quantite,
          remiseBp: remises[i],
          prixUnitaire: prix.get(l.conditionnementId) ?? null,
          montant: montants[i],
        })),
      );
    }
  }
}
