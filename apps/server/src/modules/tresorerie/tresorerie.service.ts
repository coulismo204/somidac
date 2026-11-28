import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CompteDto, PERMISSIONS, TransfertDto, TYPES_COMPTES } from '@somidac/shared';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, DbOuTx, Tx } from '../../noyau/base/base';
import {
  achats,
  cloturesCaisse,
  comptesTresorerie,
  depenses,
  mouvementsTresorerie,
  paiements,
  transferts,
  utilisateurs,
} from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { aujourdhui } from '../stock/stock.service';

type Compte = typeof comptesTresorerie.$inferSelect;
export type TypeOperation = (typeof mouvementsTresorerie.$inferInsert)['type'];

/** Le lendemain d'une date AAAA-MM-JJ (borne de fin exclusive). */
export function lendemain(jour: string): string {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return aujourdhui(d);
}

/**
 * Service central de la trésorerie (§5.6) : toute entrée ou sortie d'argent passe par `operation`,
 * dans la transaction du document qui la provoque. Le compte est verrouillé : deux postes ne peuvent
 * pas dépenser le même argent. La caisse et le Mobile Money ne descendent jamais sous zéro.
 */
@Injectable()
export class TresorerieService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Le solde attendu de la caisse n'est visible que de qui valide les clôtures (§10.3). */
  static voitCaisse(u: UtilisateurConnecte) {
    return u.permissions.has(PERMISSIONS.CAISSE_VALIDER);
  }

  static voitSoldes(u: UtilisateurConnecte) {
    return u.permissions.has(PERMISSIONS.TRESORERIE_ENCAISSER) || u.permissions.has(PERMISSIONS.CAISSE_VALIDER);
  }

  private vue(c: Compte, u: UtilisateurConnecte) {
    const masque = !TresorerieService.voitSoldes(u) || (c.type === 'caisse' && !TresorerieService.voitCaisse(u));
    return { id: c.id, nom: c.nom, type: c.type, reference: c.reference, actif: c.actif, soldeInitial: masque ? null : c.soldeInitial, solde: masque ? null : c.solde, soldeMasque: masque };
  }

  async verrouiller(tx: DbOuTx, ids: string[]) {
    const tries = [...new Set(ids)].sort();
    const comptes = await tx.select().from(comptesTresorerie).where(inArray(comptesTresorerie.id, tries)).orderBy(asc(comptesTresorerie.id)).for('update');
    if (comptes.length !== tries.length) throw new ErreurMetier('COMPTE_INCONNU', 'Compte de trésorerie inconnu', HttpStatus.NOT_FOUND);
    return comptes;
  }

  /** Inscrit une opération sur un compte et met son solde à jour. Renvoie le nouveau solde. */
  async operation(
    tx: Tx,
    o: { compteId: string; montant: number; type: TypeOperation; document?: { type: string; id: string }; libelle: string; utilisateurId: string | null; correction?: boolean },
  ): Promise<number> {
    const [c] = await this.verrouiller(tx, [o.compteId]);
    if (!c.actif && !o.correction) throw new ErreurMetier('COMPTE_INACTIF', `Le compte « ${c.nom} » est désactivé`);
    const solde = c.solde + o.montant;
    // Une banque peut être à découvert ; pas une caisse ni un compte Mobile Money.
    if (solde < 0 && c.type !== 'banque' && !o.correction) {
      throw new ErreurMetier('SOLDE_INSUFFISANT', `Solde insuffisant dans « ${c.nom} » pour cette opération`, HttpStatus.CONFLICT);
    }
    await tx.update(comptesTresorerie).set({ solde }).where(eq(comptesTresorerie.id, c.id));
    await tx.insert(mouvementsTresorerie).values({
      compteId: c.id,
      montant: o.montant,
      soldeApres: solde,
      type: o.type,
      documentType: o.document?.type,
      documentId: o.document?.id,
      libelle: o.libelle,
      utilisateurId: o.utilisateurId,
    });
    return solde;
  }

  // ------------------------------------------------------------------ comptes

  async listerComptes(u: UtilisateurConnecte, inclureInactifs = false) {
    const liste = await this.db
      .select()
      .from(comptesTresorerie)
      .where(inclureInactifs ? undefined : eq(comptesTresorerie.actif, true))
      .orderBy(sql`array_position(array['caisse','mobile_money','banque']::text[], ${comptesTresorerie.type}::text)`, asc(comptesTresorerie.nom));
    return liste.map((c) => this.vue(c, u));
  }

  async enregistrerCompte(id: string | null, dto: CompteDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [doublon] = await tx.select({ id: comptesTresorerie.id }).from(comptesTresorerie).where(sql`lower(${comptesTresorerie.nom}) = lower(${dto.nom})`);
      if (doublon && doublon.id !== id) throw new ErreurMetier('DOUBLON', 'Un compte porte déjà ce nom', HttpStatus.CONFLICT);
      let c: Compte;
      let avant: Compte | undefined;
      if (id) {
        [avant] = await this.verrouiller(tx, [id]);
        if (avant.type !== dto.type) {
          const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(mouvementsTresorerie).where(eq(mouvementsTresorerie.compteId, id));
          if (n > 0) throw new ErreurMetier('COMPTE_UTILISE', 'Le type d’un compte déjà utilisé ne peut plus changer');
        }
        let solde = avant.solde;
        if (dto.soldeInitial !== avant.soldeInitial) {
          const [{ n }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(mouvementsTresorerie)
            .where(and(eq(mouvementsTresorerie.compteId, id), ne(mouvementsTresorerie.type, 'ouverture')));
          if (n > 0) {
            throw new ErreurMetier('COMPTE_UTILISE', 'Le solde d’ouverture ne peut plus changer : le compte a déjà servi. Corrigez par une clôture de caisse ou un transfert.');
          }
          await tx.delete(mouvementsTresorerie).where(eq(mouvementsTresorerie.compteId, id));
          solde = dto.soldeInitial;
          if (solde > 0) {
            await tx.insert(mouvementsTresorerie).values({ compteId: id, montant: solde, soldeApres: solde, type: 'ouverture', libelle: 'Solde d’ouverture', utilisateurId: u.id });
          }
        }
        [c] = await tx.update(comptesTresorerie).set({ ...dto, solde }).where(eq(comptesTresorerie.id, id)).returning();
      } else {
        [c] = await tx.insert(comptesTresorerie).values({ ...dto, solde: dto.soldeInitial }).returning();
        if (dto.soldeInitial > 0) {
          await tx.insert(mouvementsTresorerie).values({ compteId: c.id, montant: dto.soldeInitial, soldeApres: dto.soldeInitial, type: 'ouverture', libelle: 'Solde d’ouverture', utilisateurId: u.id });
        }
      }
      await this.audit.enregistrer(tx, { action: id ? 'compte.modifie' : 'compte.cree', utilisateurId: u.id, appareilId, entite: 'compte_tresorerie', entiteId: c.id, avant, apres: c });
      return this.vue(c, u);
    });
  }

  /** Journal d'un compte sur une période (§5.7 « journal de caisse et de chaque compte »). */
  async journal(compteId: string, du: string, au: string, u: UtilisateurConnecte) {
    const [c] = await this.db.select().from(comptesTresorerie).where(eq(comptesTresorerie.id, compteId));
    if (!c) throw new ErreurMetier('INTROUVABLE', 'Compte introuvable', HttpStatus.NOT_FOUND);
    const vue = this.vue(c, u);
    // Le journal de la caisse permettrait de recalculer le montant attendu : il est réservé à qui valide les clôtures (§10.3).
    if (c.type === 'caisse' && !TresorerieService.voitCaisse(u)) {
      throw new ErreurMetier('JOURNAL_CAISSE_RESERVE', 'Le journal de la caisse est réservé au gérant (clôture à l’aveugle)', HttpStatus.FORBIDDEN);
    }
    const lignes = await this.db
      .select({ m: mouvementsTresorerie, utilisateur: utilisateurs.nomComplet })
      .from(mouvementsTresorerie)
      .leftJoin(utilisateurs, eq(utilisateurs.id, mouvementsTresorerie.utilisateurId))
      .where(and(eq(mouvementsTresorerie.compteId, compteId), sql`${mouvementsTresorerie.date} >= ${du}::date`, sql`${mouvementsTresorerie.date} < ${lendemain(au)}::date`))
      .orderBy(desc(mouvementsTresorerie.date))
      .limit(2_000);
    const operations = lignes.map(({ m, utilisateur }) => ({
      id: m.id,
      date: m.date,
      type: m.type,
      libelle: m.libelle,
      montant: m.montant,
      soldeApres: vue.soldeMasque ? null : m.soldeApres,
      documentType: m.documentType,
      documentId: m.documentId,
      utilisateur,
    }));
    return {
      compte: vue,
      operations,
      entrees: operations.filter((o) => o.montant > 0).reduce((t, o) => t + o.montant, 0),
      sorties: operations.filter((o) => o.montant < 0).reduce((t, o) => t - o.montant, 0),
    };
  }

  // ------------------------------------------------------------------ transferts

  async transferer(dto: TransfertDto, u: UtilisateurConnecte, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const comptes = await this.verrouiller(tx, [dto.compteSourceId, dto.compteDestinationId]);
      const source = comptes.find((c) => c.id === dto.compteSourceId)!;
      const destination = comptes.find((c) => c.id === dto.compteDestinationId)!;
      const [t] = await tx
        .insert(transferts)
        .values({ date: aujourdhui(), compteSourceId: source.id, compteDestinationId: destination.id, montant: dto.montant, libelle: dto.libelle, creePar: u.id })
        .returning();
      const libelle = dto.libelle ?? `Transfert de « ${source.nom} » vers « ${destination.nom} »`;
      const document = { type: 'transfert', id: t.id };
      await this.operation(tx, { compteId: source.id, montant: -dto.montant, type: 'transfert', document, libelle: `${libelle} (sortie)`, utilisateurId: u.id });
      await this.operation(tx, { compteId: destination.id, montant: dto.montant, type: 'transfert', document, libelle: `${libelle} (entrée)`, utilisateurId: u.id });
      await this.audit.enregistrer(tx, {
        action: 'tresorerie.transfert',
        utilisateurId: u.id,
        appareilId,
        entite: 'transfert',
        entiteId: t.id,
        details: { source: source.nom, destination: destination.nom, montant: dto.montant },
      });
      return t;
    });
  }

  async listerTransferts() {
    return this.db
      .select({
        id: transferts.id,
        date: transferts.date,
        montant: transferts.montant,
        libelle: transferts.libelle,
        source: sql<string>`(SELECT nom FROM comptes_tresorerie WHERE id = ${transferts.compteSourceId})`,
        destination: sql<string>`(SELECT nom FROM comptes_tresorerie WHERE id = ${transferts.compteDestinationId})`,
        par: utilisateurs.nomComplet,
        creeLe: transferts.creeLe,
      })
      .from(transferts)
      .leftJoin(utilisateurs, eq(utilisateurs.id, transferts.creePar))
      .orderBy(desc(transferts.creeLe))
      .limit(500);
  }

  // ------------------------------------------------------------------ tableau de bord (§5.1)

  async resume(u: UtilisateurConnecte) {
    const comptes = await this.listerComptes(u);
    const jour = aujourdhui();
    const debutMois = `${jour.slice(0, 8)}01`;
    const parType = Object.fromEntries(
      (Object.keys(TYPES_COMPTES) as (keyof typeof TYPES_COMPTES)[]).map((t) => {
        const du = comptes.filter((c) => c.type === t);
        return [t, du.some((c) => c.soldeMasque) ? null : du.reduce((s, c) => s + (c.solde ?? 0), 0)];
      }),
    );
    const [enc] = await this.db
      .select({ v: sql<number>`coalesce(sum(${paiements.montant}), 0)::bigint` })
      .from(paiements)
      .where(and(eq(paiements.sens, 'client'), eq(paiements.statut, 'valide'), eq(paiements.date, jour)));
    const [dep] = await this.db
      .select({ v: sql<number>`coalesce(sum(${depenses.montant}), 0)::bigint` })
      .from(depenses)
      .where(and(eq(depenses.statut, 'valide'), gte(depenses.date, debutMois), lt(depenses.date, lendemain(jour))));
    const [dettes] = await this.db
      .select({ v: sql<number>`coalesce(sum(${achats.total} - ${achats.montantPaye}), 0)::bigint` })
      .from(achats)
      .where(eq(achats.statut, 'valide'));
    const [aValider] = await this.db.select({ n: sql<number>`count(*)::int` }).from(cloturesCaisse).where(eq(cloturesCaisse.statut, 'a_valider'));
    const [derniere] = await this.db.select().from(cloturesCaisse).where(eq(cloturesCaisse.statut, 'validee')).orderBy(desc(cloturesCaisse.jour)).limit(1);
    return {
      comptes,
      parType,
      total: Object.values(parType).some((v) => v === null) ? null : Object.values(parType).reduce((s: number, v) => s + (v ?? 0), 0),
      encaissementsJour: Number(enc.v),
      depensesMois: Number(dep.v),
      dettesFournisseurs: Number(dettes.v),
      cloturesAValider: aValider.n,
      derniereCloture: derniere ? { jour: derniere.jour, ecart: TresorerieService.voitCaisse(u) ? derniere.ecart : null } : null,
    };
  }
}
