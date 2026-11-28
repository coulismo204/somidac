import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AvoirDto, partCumulee } from '@somidac/shared';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db } from '../../noyau/base/base';
import {
  avoirLignes,
  avoirs,
  bonsLivraison,
  clients,
  comptesTresorerie,
  conditionnements,
  factureLignes,
  factures,
  paiementAffectations,
  paiements,
  produits,
} from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { SequencesService } from '../../noyau/sequences/sequences.service';
import { aujourdhui } from '../stock/stock.service';
import { LivraisonsService } from './livraisons.service';

type Facture = typeof factures.$inferSelect;

/** Règle R10 : une facture est payée quand ses paiements atteignent son total (déduction faite des avoirs). */
export function statutPaiement(f: Pick<Facture, 'totalTTC' | 'montantAvoirs' | 'montantPaye'>) {
  const du = f.totalTTC - f.montantAvoirs;
  if (du <= 0) return 'annulee' as const;
  if (f.montantPaye >= du) return 'payee' as const;
  if (f.montantPaye > 0) return 'partielle' as const;
  return 'non_payee' as const;
}

const resteDu = (f: Pick<Facture, 'totalTTC' | 'montantAvoirs' | 'montantPaye'>) => Math.max(0, f.totalTTC - f.montantAvoirs - f.montantPaye);

/** Montant HT après remise sur le total, pour une part `x` des lignes : f(totalLignes) = totalHT. */
const htApresRemise = (f: Pick<Facture, 'totalLignes' | 'remiseGlobale'>, x: number) =>
  f.totalLignes > 0 ? x - Math.round((f.remiseGlobale * x) / f.totalLignes) : 0;

@Injectable()
export class FacturesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly livraisons: LivraisonsService,
    private readonly sequences: SequencesService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ factures

  async lister(options: { clientId?: string; nonSoldees?: boolean } = {}) {
    const liste = await this.db
      .select({ f: factures, client: clients.raisonSociale, blNumero: bonsLivraison.numero })
      .from(factures)
      .innerJoin(clients, eq(clients.id, factures.clientId))
      .innerJoin(bonsLivraison, eq(bonsLivraison.id, factures.blId))
      .where(options.clientId ? eq(factures.clientId, options.clientId) : undefined)
      .orderBy(desc(factures.date), desc(factures.numero))
      .limit(500);
    return liste
      .map(({ f, client, blNumero }) => ({
        id: f.id,
        numero: f.numero,
        date: f.date,
        echeance: f.echeance,
        clientId: f.clientId,
        client,
        blNumero,
        referenceClient: f.referenceClient,
        totalTTC: f.totalTTC,
        montantAvoirs: f.montantAvoirs,
        montantPaye: f.montantPaye,
        resteDu: resteDu(f),
        statutPaiement: statutPaiement(f),
      }))
      .filter((f) => !options.nonSoldees || f.resteDu > 0);
  }

  async detail(id: string, voirCouts: boolean) {
    const [r] = await this.db
      .select({ f: factures, client: clients, bl: bonsLivraison })
      .from(factures)
      .innerJoin(clients, eq(clients.id, factures.clientId))
      .innerJoin(bonsLivraison, eq(bonsLivraison.id, factures.blId))
      .where(eq(factures.id, id));
    if (!r) throw new ErreurMetier('INTROUVABLE', 'Facture introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({ l: factureLignes, codeProduit: produits.code, conditionnement: conditionnements.nom })
      .from(factureLignes)
      .innerJoin(produits, eq(produits.id, factureLignes.produitId))
      .innerJoin(conditionnements, eq(conditionnements.id, factureLignes.conditionnementId))
      .where(eq(factureLignes.factureId, id))
      .orderBy(asc(factureLignes.ordre));
    const listeAvoirs = await this.db
      .select({ id: avoirs.id, numero: avoirs.numero, date: avoirs.date, motif: avoirs.motif, totalTTC: avoirs.totalTTC })
      .from(avoirs)
      .where(eq(avoirs.factureId, id))
      .orderBy(asc(avoirs.numero));
    const reglements = await this.db
      .select({ id: paiements.id, numero: paiements.numero, date: paiements.date, montant: paiementAffectations.montant, statut: paiements.statut, compte: comptesTresorerie.nom })
      .from(paiementAffectations)
      .innerJoin(paiements, eq(paiements.id, paiementAffectations.paiementId))
      .innerJoin(comptesTresorerie, eq(comptesTresorerie.id, paiements.compteId))
      .where(eq(paiementAffectations.factureId, id))
      .orderBy(asc(paiements.creeLe));
    const cout = Math.round(lignes.reduce((t, x) => t + x.l.quantitePieces * x.l.coutPieceCentimes, 0) / 100);
    return {
      ...r.f,
      tauxTvaPct: r.f.tauxTvaBp / 100,
      remiseGlobalePct: r.f.remiseGlobaleBp / 100,
      resteDu: resteDu(r.f),
      statutPaiement: statutPaiement(r.f),
      bonLivraison: { id: r.bl.id, numero: r.bl.numero, date: r.bl.date },
      client: {
        id: r.client.id,
        code: r.client.code,
        raisonSociale: r.client.raisonSociale,
        adresse: r.client.adresse,
        telephone: r.client.telephone,
        nif: r.client.nif,
        conditionPaiement: r.client.conditionPaiement,
      },
      lignes: lignes.map(({ l, codeProduit, conditionnement }) => {
        const { coutPieceCentimes, ...reste } = l;
        return {
          ...reste,
          remisePct: l.remiseBp / 100,
          codeProduit,
          conditionnement,
          ...(voirCouts ? { coutPiece: Math.round(coutPieceCentimes / 100) } : {}),
        };
      }),
      avoirs: listeAvoirs,
      paiements: reglements,
      ...(voirCouts ? { cout, marge: r.f.totalHT - cout } : {}),
    };
  }

  // ------------------------------------------------------------------ avoirs (R7)

  /**
   * Avoir sur une facture : lignes retournées, montant proportionnel (en cumulé, pour retomber
   * exactement sur la facture quand tout est rendu), marchandise remise en stock ou passée en casse.
   */
  async creerAvoir(factureId: string, dto: AvoirDto, u: UtilisateurConnecte, appareilId: string) {
    const ids = dto.lignes.map((l) => l.factureLigneId);
    if (new Set(ids).size !== ids.length) throw new ErreurMetier('LIGNE_DOUBLON', 'Une même ligne apparaît deux fois');
    return this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(factures).where(eq(factures.id, factureId)).for('update');
      if (!f) throw new ErreurMetier('INTROUVABLE', 'Facture introuvable', HttpStatus.NOT_FOUND);
      const lignes = await tx.select().from(factureLignes).where(eq(factureLignes.factureId, factureId)).for('update');
      const [{ dejaLignes }] = await tx
        .select({ dejaLignes: sql<number>`coalesce(sum(${avoirLignes.montant}), 0)::bigint` })
        .from(avoirLignes)
        .innerJoin(avoirs, eq(avoirs.id, avoirLignes.avoirId))
        .where(eq(avoirs.factureId, factureId));
      const avant = Number(dejaLignes);

      const date = aujourdhui();
      const numero = await this.sequences.suivant(tx, 'AV', new Date(`${date}T12:00:00`));
      const contenu: { factureLigneId: string; ordre: number; quantite: number; montant: number; destination: 'stock' | 'casse' }[] = [];
      for (const [i, saisie] of dto.lignes.entries()) {
        const l = lignes.find((x) => x.id === saisie.factureLigneId);
        if (!l) throw new ErreurMetier('LIGNE_INCONNUE', "Cette ligne n'appartient pas à la facture");
        if (saisie.quantite > l.quantite - l.quantiteRetournee) {
          throw new ErreurMetier(
            'RETOUR_EXCESSIF',
            `« ${l.designation} » : ${l.quantite - l.quantiteRetournee} au plus peuvent encore être retournés`,
          );
        }
        const montant = partCumulee(l.montant, l.quantite, l.quantiteRetournee, saisie.quantite);
        contenu.push({ factureLigneId: l.id, ordre: i, quantite: saisie.quantite, montant, destination: saisie.destination });
        await tx.update(factureLignes).set({ quantiteRetournee: l.quantiteRetournee + saisie.quantite }).where(eq(factureLignes.id, l.id));
      }
      const ajout = contenu.reduce((t, c) => t + c.montant, 0);
      const htAvant = htApresRemise(f, avant);
      const htApres = htApresRemise(f, avant + ajout);
      const totalHT = htApres - htAvant;
      const tva = Math.round((htApres * f.tauxTvaBp) / 10_000) - Math.round((htAvant * f.tauxTvaBp) / 10_000);
      const totalTTC = totalHT + tva;

      const [a] = await tx
        .insert(avoirs)
        .values({ numero, factureId, clientId: f.clientId, date, motif: dto.motif, totalHT, tva, totalTTC, creePar: u.id })
        .returning();
      await tx.insert(avoirLignes).values(contenu.map((c) => ({ ...c, avoirId: a.id })));

      for (const c of contenu) {
        const l = lignes.find((x) => x.id === c.factureLigneId)!;
        await this.livraisons.rendreAuStock(tx, l.blLigneId, (l.quantitePieces / l.quantite) * c.quantite, {
          destination: c.destination,
          motif: `Avoir ${numero} : ${dto.motif}`,
          document: { type: 'avoir', id: a.id },
          utilisateurId: u.id,
        });
      }
      await tx.update(factures).set({ montantAvoirs: f.montantAvoirs + totalTTC }).where(eq(factures.id, factureId));
      await this.audit.enregistrer(tx, {
        action: 'avoir.emis',
        utilisateurId: u.id,
        appareilId,
        entite: 'avoir',
        entiteId: a.id,
        details: { numero, facture: f.numero, totalTTC, motif: dto.motif, lignes: contenu.map((c) => ({ quantite: c.quantite, destination: c.destination })) },
      });
      return { id: a.id, numero, totalTTC };
    });
  }

  async listerAvoirs() {
    return this.db
      .select({
        id: avoirs.id,
        numero: avoirs.numero,
        date: avoirs.date,
        motif: avoirs.motif,
        totalTTC: avoirs.totalTTC,
        client: clients.raisonSociale,
        factureId: avoirs.factureId,
        factureNumero: factures.numero,
      })
      .from(avoirs)
      .innerJoin(clients, eq(clients.id, avoirs.clientId))
      .innerJoin(factures, eq(factures.id, avoirs.factureId))
      .orderBy(desc(avoirs.date), desc(avoirs.numero))
      .limit(500);
  }

  async detailAvoir(id: string) {
    const [r] = await this.db
      .select({ a: avoirs, client: clients, facture: factures })
      .from(avoirs)
      .innerJoin(clients, eq(clients.id, avoirs.clientId))
      .innerJoin(factures, eq(factures.id, avoirs.factureId))
      .where(eq(avoirs.id, id));
    if (!r) throw new ErreurMetier('INTROUVABLE', 'Avoir introuvable', HttpStatus.NOT_FOUND);
    const lignes = await this.db
      .select({
        id: avoirLignes.id,
        quantite: avoirLignes.quantite,
        montant: avoirLignes.montant,
        destination: avoirLignes.destination,
        designation: factureLignes.designation,
        prixUnitaire: factureLignes.prixUnitaire,
        remiseBp: factureLignes.remiseBp,
        codeProduit: produits.code,
        conditionnement: conditionnements.nom,
      })
      .from(avoirLignes)
      .innerJoin(factureLignes, eq(factureLignes.id, avoirLignes.factureLigneId))
      .innerJoin(produits, eq(produits.id, factureLignes.produitId))
      .innerJoin(conditionnements, eq(conditionnements.id, factureLignes.conditionnementId))
      .where(eq(avoirLignes.avoirId, id))
      .orderBy(asc(avoirLignes.ordre));
    return {
      ...r.a,
      tauxTvaPct: r.facture.tauxTvaBp / 100,
      facture: { id: r.facture.id, numero: r.facture.numero, date: r.facture.date, referenceClient: r.facture.referenceClient },
      client: {
        id: r.client.id,
        code: r.client.code,
        raisonSociale: r.client.raisonSociale,
        adresse: r.client.adresse,
        telephone: r.client.telephone,
        nif: r.client.nif,
      },
      lignes: lignes.map((l) => ({ ...l, remisePct: l.remiseBp / 100 })),
    };
  }

  // ------------------------------------------------------------------ tableau de bord (§5.1)

  /** Chiffre d'affaires HT (factures moins avoirs) du jour et du mois, livraisons, bons à facturer. */
  async resume() {
    const jour = aujourdhui();
    const debutMois = `${jour.slice(0, 8)}01`;
    const ca = async (debut: string) => {
      const [fa] = await this.db
        .select({ v: sql<number>`coalesce(sum(${factures.totalHT}), 0)::bigint` })
        .from(factures)
        .where(and(gte(factures.date, debut), lte(factures.date, jour)));
      const [av] = await this.db
        .select({ v: sql<number>`coalesce(sum(${avoirs.totalHT}), 0)::bigint` })
        .from(avoirs)
        .where(and(gte(avoirs.date, debut), lte(avoirs.date, jour)));
      return Number(fa.v) - Number(av.v);
    };
    const livraisons = async (debut: string) => {
      const [r] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(bonsLivraison)
        .where(and(ne(bonsLivraison.statut, 'brouillon'), gte(bonsLivraison.date, debut), lte(bonsLivraison.date, jour)));
      return r.n;
    };
    const [aFacturer] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(bonsLivraison)
      .where(inArray(bonsLivraison.statut, ['livre', 'receptionne']));
    const nonSoldees = await this.lister({ nonSoldees: true });
    return {
      caJour: await ca(jour),
      caMois: await ca(debutMois),
      livraisonsJour: await livraisons(jour),
      livraisonsMois: await livraisons(debutMois),
      bonsAFacturer: aFacturer.n,
      facturesNonSoldees: nonSoldees.length,
      resteDuClients: nonSoldees.reduce((t, f) => t + f.resteDu, 0),
    };
  }
}
