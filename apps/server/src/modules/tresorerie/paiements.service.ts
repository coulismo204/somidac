import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EncaissementDto, PaiementFournisseurDto } from '@somidac/shared';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { achats, clients, comptesTresorerie, factures, fournisseurs, paiementAffectations, paiements, utilisateurs } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { SequencesService } from '../../noyau/sequences/sequences.service';
import { aujourdhui } from '../stock/stock.service';
import { lendemain, TresorerieService } from './tresorerie.service';

const resteFacture = (f: typeof factures.$inferSelect) => f.totalTTC - f.montantAvoirs - f.montantPaye;

function verifierDoublons(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new ErreurMetier('AFFECTATION_DOUBLON', 'Un même document apparaît deux fois');
}

@Injectable()
export class PaiementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tresorerie: TresorerieService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditService,
  ) {}

  /** Encaissement d'un client (R10) : chaque part ne dépasse pas le reste dû de sa facture. */
  async encaisser(dto: EncaissementDto, u: UtilisateurConnecte, appareilId: string) {
    verifierDoublons(dto.affectations.map((a) => a.factureId));
    return this.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(eq(clients.id, dto.clientId));
      if (!client) throw new ErreurMetier('CLIENT_INCONNU', 'Client inconnu');
      const ids = dto.affectations.map((a) => a.factureId).sort();
      const liste = await tx.select().from(factures).where(inArray(factures.id, ids)).orderBy(asc(factures.id)).for('update');
      for (const a of dto.affectations) {
        const f = liste.find((x) => x.id === a.factureId);
        if (!f || f.clientId !== dto.clientId) throw new ErreurMetier('FACTURE_INCONNUE', 'Facture inconnue pour ce client');
        if (a.montant > resteFacture(f)) {
          throw new ErreurMetier('PAIEMENT_EXCESSIF', `La facture ${f.numero} n’a plus que ${Math.max(0, resteFacture(f))} FCFA à payer (R10)`, HttpStatus.CONFLICT);
        }
      }
      const montant = dto.affectations.reduce((t, a) => t + a.montant, 0);
      const date = aujourdhui();
      const numero = await this.sequences.suivant(tx, 'PAI', new Date(`${date}T12:00:00`));
      const [p] = await tx
        .insert(paiements)
        .values({ numero, sens: 'client', clientId: dto.clientId, compteId: dto.compteId, date, montant, reference: dto.reference, notes: dto.notes, creePar: u.id })
        .returning();
      await tx.insert(paiementAffectations).values(dto.affectations.map((a) => ({ paiementId: p.id, factureId: a.factureId, montant: a.montant })));
      for (const a of dto.affectations) {
        await tx.update(factures).set({ montantPaye: sql`${factures.montantPaye} + ${a.montant}` }).where(eq(factures.id, a.factureId));
      }
      await this.tresorerie.operation(tx, {
        compteId: dto.compteId,
        montant,
        type: 'encaissement',
        document: { type: 'paiement', id: p.id },
        libelle: `Encaissement ${numero} - ${client.raisonSociale}`,
        utilisateurId: u.id,
      });
      await this.audit.enregistrer(tx, {
        action: 'paiement.encaisse',
        utilisateurId: u.id,
        appareilId,
        entite: 'paiement',
        entiteId: p.id,
        details: { numero, client: client.raisonSociale, montant, factures: liste.map((f) => f.numero) },
      });
      return { id: p.id, numero, montant };
    });
  }

  /** Paiement d'un fournisseur, éventuellement dans la transaction qui valide l'achat. */
  async payerFournisseur(dto: PaiementFournisseurDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction((tx) => this.payerFournisseurDans(tx, dto, u.id, appareilId));
  }

  async payerFournisseurDans(tx: Tx, dto: PaiementFournisseurDto, utilisateurId: string, appareilId: string) {
    verifierDoublons(dto.affectations.map((a) => a.achatId));
    const [fournisseur] = await tx.select().from(fournisseurs).where(eq(fournisseurs.id, dto.fournisseurId));
    if (!fournisseur) throw new ErreurMetier('FOURNISSEUR_INCONNU', 'Fournisseur inconnu');
    const ids = dto.affectations.map((a) => a.achatId).sort();
    const liste = await tx.select().from(achats).where(inArray(achats.id, ids)).orderBy(asc(achats.id)).for('update');
    for (const a of dto.affectations) {
      const achat = liste.find((x) => x.id === a.achatId);
      if (!achat || achat.fournisseurId !== dto.fournisseurId || achat.statut !== 'valide') {
        throw new ErreurMetier('ACHAT_INCONNU', 'Achat inconnu ou non validé pour ce fournisseur');
      }
      if (a.montant > achat.total - achat.montantPaye) {
        throw new ErreurMetier('PAIEMENT_EXCESSIF', `L’achat ${achat.numero} n’a plus que ${achat.total - achat.montantPaye} FCFA à payer`, HttpStatus.CONFLICT);
      }
    }
    const montant = dto.affectations.reduce((t, a) => t + a.montant, 0);
    const date = aujourdhui();
    const numero = await this.sequences.suivant(tx, 'PAI', new Date(`${date}T12:00:00`));
    const [p] = await tx
      .insert(paiements)
      .values({ numero, sens: 'fournisseur', fournisseurId: dto.fournisseurId, compteId: dto.compteId, date, montant, reference: dto.reference, notes: dto.notes, creePar: utilisateurId })
      .returning();
    await tx.insert(paiementAffectations).values(dto.affectations.map((a) => ({ paiementId: p.id, achatId: a.achatId, montant: a.montant })));
    for (const a of dto.affectations) {
      await tx.update(achats).set({ montantPaye: sql`${achats.montantPaye} + ${a.montant}` }).where(eq(achats.id, a.achatId));
    }
    await this.tresorerie.operation(tx, {
      compteId: dto.compteId,
      montant: -montant,
      type: 'paiement_fournisseur',
      document: { type: 'paiement', id: p.id },
      libelle: `Paiement ${numero} - ${fournisseur.nom}`,
      utilisateurId,
    });
    await this.audit.enregistrer(tx, {
      action: 'paiement.fournisseur',
      utilisateurId,
      appareilId,
      entite: 'paiement',
      entiteId: p.id,
      details: { numero, fournisseur: fournisseur.nom, montant, achats: liste.map((a) => a.numero) },
    });
    return { id: p.id, numero, montant };
  }

  /** Annulation tracée (R7) : l'argent fait le chemin inverse, les restes dus réapparaissent. */
  async annuler(id: string, motif: string, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(paiements).where(eq(paiements.id, id)).for('update');
      if (!p) throw new ErreurMetier('INTROUVABLE', 'Paiement introuvable', HttpStatus.NOT_FOUND);
      if (p.statut === 'annule') throw new ErreurMetier('DEJA_ANNULE', 'Ce paiement est déjà annulé', HttpStatus.CONFLICT);
      const affectations = await tx.select().from(paiementAffectations).where(eq(paiementAffectations.paiementId, id));
      for (const a of affectations) {
        if (a.factureId) await tx.update(factures).set({ montantPaye: sql`${factures.montantPaye} - ${a.montant}` }).where(eq(factures.id, a.factureId));
        if (a.achatId) await tx.update(achats).set({ montantPaye: sql`${achats.montantPaye} - ${a.montant}` }).where(eq(achats.id, a.achatId));
      }
      await this.tresorerie.operation(tx, {
        compteId: p.compteId,
        montant: p.sens === 'client' ? -p.montant : p.montant,
        type: 'annulation',
        document: { type: 'paiement', id },
        libelle: `Annulation du paiement ${p.numero} : ${motif}`,
        utilisateurId: u.id,
        correction: true,
      });
      await tx.update(paiements).set({ statut: 'annule', motifAnnulation: motif, annulePar: u.id, annuleLe: new Date() }).where(eq(paiements.id, id));
      await this.audit.enregistrer(tx, { action: 'paiement.annule', utilisateurId: u.id, appareilId, entite: 'paiement', entiteId: id, details: { numero: p.numero, montant: p.montant, motif } });
      return { id, statut: 'annule' };
    });
  }

  // ------------------------------------------------------------------ consultation

  async lister(o: { sens?: string; du?: string; au?: string; clientId?: string; fournisseurId?: string }) {
    const conditions = [];
    if (o.sens === 'client' || o.sens === 'fournisseur') conditions.push(eq(paiements.sens, o.sens));
    if (o.du) conditions.push(gte(paiements.date, o.du));
    if (o.au) conditions.push(lt(paiements.date, lendemain(o.au)));
    if (o.clientId) conditions.push(eq(paiements.clientId, o.clientId));
    if (o.fournisseurId) conditions.push(eq(paiements.fournisseurId, o.fournisseurId));
    return this.db
      .select({
        id: paiements.id,
        numero: paiements.numero,
        sens: paiements.sens,
        date: paiements.date,
        montant: paiements.montant,
        reference: paiements.reference,
        statut: paiements.statut,
        compte: comptesTresorerie.nom,
        typeCompte: comptesTresorerie.type,
        tiers: sql<string>`coalesce(${clients.raisonSociale}, ${fournisseurs.nom})`,
        par: utilisateurs.nomComplet,
        documents: sql<string>`(SELECT string_agg(coalesce(f.numero, a.numero), ', ') FROM paiement_affectations pa LEFT JOIN factures f ON f.id = pa.facture_id LEFT JOIN achats a ON a.id = pa.achat_id WHERE pa.paiement_id = ${paiements.id})`,
      })
      .from(paiements)
      .innerJoin(comptesTresorerie, eq(comptesTresorerie.id, paiements.compteId))
      .leftJoin(clients, eq(clients.id, paiements.clientId))
      .leftJoin(fournisseurs, eq(fournisseurs.id, paiements.fournisseurId))
      .leftJoin(utilisateurs, eq(utilisateurs.id, paiements.creePar))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(paiements.creeLe))
      .limit(500);
  }

  /** Détail d'un paiement, avec ce qu'il règle : sert aussi au reçu de paiement (§8). */
  async detail(id: string) {
    const [r] = await this.db
      .select({ p: paiements, compte: comptesTresorerie, client: clients, fournisseur: fournisseurs.nom, par: utilisateurs.nomComplet })
      .from(paiements)
      .innerJoin(comptesTresorerie, eq(comptesTresorerie.id, paiements.compteId))
      .leftJoin(clients, eq(clients.id, paiements.clientId))
      .leftJoin(fournisseurs, eq(fournisseurs.id, paiements.fournisseurId))
      .leftJoin(utilisateurs, eq(utilisateurs.id, paiements.creePar))
      .where(eq(paiements.id, id));
    if (!r) throw new ErreurMetier('INTROUVABLE', 'Paiement introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({ a: paiementAffectations, facture: factures, achat: achats })
      .from(paiementAffectations)
      .leftJoin(factures, eq(factures.id, paiementAffectations.factureId))
      .leftJoin(achats, eq(achats.id, paiementAffectations.achatId))
      .where(eq(paiementAffectations.paiementId, id));
    return {
      ...r.p,
      compte: { id: r.compte.id, nom: r.compte.nom, type: r.compte.type },
      par: r.par,
      client: r.client ? { id: r.client.id, code: r.client.code, raisonSociale: r.client.raisonSociale, adresse: r.client.adresse, telephone: r.client.telephone, nif: r.client.nif } : null,
      fournisseur: r.fournisseur,
      affectations: lignes.map(({ a, facture, achat }) => ({
        id: a.id,
        montant: a.montant,
        documentId: facture?.id ?? achat?.id,
        numero: facture?.numero ?? achat?.numero,
        date: facture?.date ?? achat?.date,
        total: facture ? facture.totalTTC - facture.montantAvoirs : achat?.total,
        /** Reste dû aujourd'hui sur le document. */
        resteDu: facture ? Math.max(0, resteFacture(facture)) : achat ? achat.total - achat.montantPaye : 0,
      })),
    };
  }
}
