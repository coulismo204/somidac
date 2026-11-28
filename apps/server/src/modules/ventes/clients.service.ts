import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientDto, PrixClientDto } from '@somidac/shared';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { clients, conditionnements, factures, prixClients, produits, sequencesDocuments, sites } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { ParametresService } from '../../noyau/parametres/parametres.service';

/** Code client (C-0001) : série unique, non annuelle. */
export async function codeClientSuivant(tx: Tx): Promise<string> {
  const [ligne] = await tx
    .insert(sequencesDocuments)
    .values({ type: 'CLI', annee: 0, derniereValeur: 1 })
    .onConflictDoUpdate({
      target: [sequencesDocuments.type, sequencesDocuments.annee],
      set: { derniereValeur: sql`${sequencesDocuments.derniereValeur} + 1` },
    })
    .returning({ valeur: sequencesDocuments.derniereValeur });
  return `C-${String(ligne.valeur).padStart(4, '0')}`;
}

@Injectable()
export class ClientsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly parametres: ParametresService,
  ) {}

  /** Clients avec leur reste dû (factures non soldées). */
  async lister(options: { recherche?: string; inclureInactifs?: boolean } = {}) {
    const conditions = [];
    if (!options.inclureInactifs) conditions.push(eq(clients.actif, true));
    if (options.recherche?.trim()) {
      const motif = `%${options.recherche.trim()}%`;
      conditions.push(or(ilike(clients.raisonSociale, motif), ilike(clients.code, motif), ilike(clients.telephone, motif)));
    }
    const liste = await this.db
      .select()
      .from(clients)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(clients.raisonSociale));
    const dus = await this.db
      .select({
        id: factures.clientId,
        du: sql<number>`coalesce(sum(greatest(${factures.totalTTC} - ${factures.montantAvoirs} - ${factures.montantPaye}, 0)), 0)::bigint`,
      })
      .from(factures)
      .groupBy(factures.clientId);
    return liste.map((c) => ({ ...c, resteDu: Number(dus.find((d) => d.id === c.id)?.du ?? 0) }));
  }

  async detail(id: string) {
    const [c] = await this.db.select().from(clients).where(eq(clients.id, id));
    if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable', HttpStatus.NOT_FOUND);
    return { ...c, prix: await this.prix(id) };
  }

  /** Prix particuliers, avec le prix par défaut pour comparaison. */
  async prix(clientId: string) {
    return this.db
      .select({
        conditionnementId: prixClients.conditionnementId,
        prix: prixClients.prix,
        produitId: produits.id,
        codeProduit: produits.code,
        produit: produits.designation,
        conditionnement: conditionnements.nom,
        nbPieces: conditionnements.nbPieces,
        prixDefaut: conditionnements.prixVente,
        modifieLe: prixClients.modifieLe,
      })
      .from(prixClients)
      .innerJoin(conditionnements, eq(conditionnements.id, prixClients.conditionnementId))
      .innerJoin(produits, eq(produits.id, conditionnements.produitId))
      .where(eq(prixClients.clientId, clientId))
      .orderBy(asc(produits.designation), asc(conditionnements.nbPieces));
  }

  async enregistrer(id: string | null, dto: ClientDto, u: UtilisateurConnecte, appareilId: string) {
    if (dto.conditionPaiement === 'credit' && !(await this.parametres.moduleActif('credit_client'))) {
      throw new ErreurMetier('CREDIT_DESACTIVE', 'Le crédit client est désactivé : la condition de paiement doit être « comptant »');
    }
    const valeurs = { ...dto, delaiPaiementJours: dto.conditionPaiement === 'credit' ? dto.delaiPaiementJours : 0 };
    return this.db.transaction(async (tx) => {
      const [doublon] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(sql`lower(${clients.raisonSociale}) = lower(${dto.raisonSociale})`);
      if (doublon && doublon.id !== id) throw new ErreurMetier('DOUBLON', 'Un client porte déjà ce nom', HttpStatus.CONFLICT);
      let c: typeof clients.$inferSelect | undefined;
      let avant: typeof clients.$inferSelect | undefined;
      if (id) {
        [avant] = await tx.select().from(clients).where(eq(clients.id, id)).for('update');
        if (!avant) throw new ErreurMetier('INTROUVABLE', 'Client introuvable', HttpStatus.NOT_FOUND);
        [c] = await tx.update(clients).set({ ...valeurs, modifieLe: new Date() }).where(eq(clients.id, id)).returning();
      } else {
        const [site] = await tx.select().from(sites).limit(1);
        [c] = await tx
          .insert(clients)
          .values({ ...valeurs, siteId: site.id, code: await codeClientSuivant(tx), creePar: u.id })
          .returning();
      }
      await this.audit.enregistrer(tx, {
        action: id ? 'client.modifie' : 'client.cree',
        utilisateurId: u.id,
        appareilId,
        entite: 'client',
        entiteId: c.id,
        avant,
        apres: c,
      });
      return c;
    });
  }

  /** Remplace les prix particuliers du client (permission « Modifier les prix de vente », R11). */
  async definirPrix(clientId: string, dto: PrixClientDto, u: UtilisateurConnecte, appareilId: string) {
    const ids = dto.prix.map((p) => p.conditionnementId);
    if (new Set(ids).size !== ids.length) throw new ErreurMetier('PRIX_DOUBLON', 'Le même conditionnement a deux prix');
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(clients).where(eq(clients.id, clientId)).for('update');
      if (!c) throw new ErreurMetier('INTROUVABLE', 'Client introuvable', HttpStatus.NOT_FOUND);
      if (ids.length) {
        const connus = await tx.select({ id: conditionnements.id }).from(conditionnements).where(inArray(conditionnements.id, ids));
        if (connus.length !== ids.length) throw new ErreurMetier('CONDITIONNEMENT_INCONNU', 'Conditionnement inconnu');
      }
      const avant = await tx
        .select({ conditionnementId: prixClients.conditionnementId, prix: prixClients.prix })
        .from(prixClients)
        .where(eq(prixClients.clientId, clientId));
      const inchanges = new Set(dto.prix.filter((p) => avant.some((a) => a.conditionnementId === p.conditionnementId && a.prix === p.prix)).map((p) => p.conditionnementId));
      // Les prix inchangés gardent leur date et leur auteur.
      const aRemplacer = avant.filter((a) => !inchanges.has(a.conditionnementId)).map((a) => a.conditionnementId);
      if (aRemplacer.length) {
        await tx.delete(prixClients).where(and(eq(prixClients.clientId, clientId), inArray(prixClients.conditionnementId, aRemplacer)));
      }
      const nouveaux = dto.prix.filter((p) => !inchanges.has(p.conditionnementId));
      if (nouveaux.length) {
        await tx.insert(prixClients).values(nouveaux.map((p) => ({ clientId, conditionnementId: p.conditionnementId, prix: p.prix, modifiePar: u.id })));
      }
      if (aRemplacer.length || nouveaux.length) {
        await this.audit.enregistrer(tx, {
          action: 'client.prix_modifies',
          utilisateurId: u.id,
          appareilId,
          entite: 'client',
          entiteId: clientId,
          avant,
          apres: dto.prix,
          details: { client: c.raisonSociale },
        });
      }
    });
    return this.prix(clientId);
  }
}
