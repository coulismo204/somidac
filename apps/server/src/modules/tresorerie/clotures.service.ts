import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ClotureDto, DecisionClotureDto } from '@somidac/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import { AuditService } from '../../noyau/audit/audit.service';
import { DB, Db, Tx } from '../../noyau/base/base';
import { cloturesCaisse, comptesTresorerie, utilisateurs } from '../../noyau/base/schema';
import { ErreurMetier } from '../../noyau/commun/erreurs';
import type { UtilisateurConnecte } from '../../noyau/commun/requete';
import { ParametresService } from '../../noyau/parametres/parametres.service';
import { SauvegardesService } from '../../noyau/sauvegardes/sauvegardes.service';
import { aujourdhui } from '../stock/stock.service';
import { TresorerieService } from './tresorerie.service';

type Cloture = typeof cloturesCaisse.$inferSelect;

/**
 * Clôture de caisse journalière (§5.6, §10.3) : le caissier saisit le montant compté sans voir le
 * solde attendu ; tout écart doit être justifié ; le gérant valide, et l'écart est alors passé
 * en caisse pour que le solde suive l'argent réellement présent. Une sauvegarde suit (§9).
 */
@Injectable()
export class CloturesService {
  private readonly journal = new Logger('Clôtures');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tresorerie: TresorerieService,
    private readonly audit: AuditService,
    private readonly parametres: ParametresService,
    private readonly sauvegardes: SauvegardesService,
  ) {}

  private vue(c: Cloture & { compte?: string; saisiePar?: string | null; validePar?: string | null }, u: UtilisateurConnecte, noms: Record<string, string | null> = {}) {
    const voit = TresorerieService.voitCaisse(u);
    return {
      id: c.id,
      compteId: c.compteId,
      compte: noms.compte ?? null,
      jour: c.jour,
      montantCompte: c.montantCompte,
      soldeCalcule: voit ? c.soldeCalcule : null,
      ecart: voit ? c.ecart : null,
      avecEcart: c.ecart !== 0,
      justification: c.justification,
      statut: c.statut,
      commentaire: c.commentaire,
      saisieLe: c.saisieLe,
      saisiePar: noms.saisiePar ?? null,
      valideLe: c.valideLe,
      validePar: noms.validePar ?? null,
    };
  }

  async saisir(dto: ClotureDto, u: UtilisateurConnecte, appareilId: string) {
    const valideDirectement = TresorerieService.voitCaisse(u);
    const resultat = await this.db.transaction(async (tx) => {
      const [compte] = await this.tresorerie.verrouiller(tx, [dto.compteId]);
      if (compte.type !== 'caisse' || !compte.actif) throw new ErreurMetier('PAS_UNE_CAISSE', 'Seule une caisse espèces active se clôture');
      const jour = aujourdhui();
      const [deja] = await tx
        .select()
        .from(cloturesCaisse)
        .where(and(eq(cloturesCaisse.compteId, compte.id), eq(cloturesCaisse.jour, jour), ne(cloturesCaisse.statut, 'refusee')));
      if (deja) {
        throw new ErreurMetier('CLOTURE_DEJA_FAITE', deja.statut === 'validee' ? 'La caisse est déjà clôturée aujourd’hui' : 'La clôture du jour attend la validation du gérant', HttpStatus.CONFLICT);
      }
      const ecart = dto.montantCompte - compte.solde;
      if (ecart !== 0 && !dto.justification) {
        throw new ErreurMetier(
          'ECART_A_JUSTIFIER',
          valideDirectement
            ? `Écart de ${ecart > 0 ? '+' : ''}${ecart} FCFA avec le solde attendu (${compte.solde} FCFA) : indiquez sa raison`
            : 'Le montant compté ne correspond pas au solde attendu. Recomptez la caisse ; si l’écart se confirme, expliquez-le.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const [c] = await tx
        .insert(cloturesCaisse)
        .values({ compteId: compte.id, jour, soldeCalcule: compte.solde, montantCompte: dto.montantCompte, ecart, justification: dto.justification, saisiePar: u.id })
        .returning();
      await this.audit.enregistrer(tx, {
        action: 'caisse.cloture_saisie',
        utilisateurId: u.id,
        appareilId,
        entite: 'cloture_caisse',
        entiteId: c.id,
        details: { compte: compte.nom, jour, montantCompte: dto.montantCompte, soldeCalcule: compte.solde, ecart },
      });
      return valideDirectement ? this.appliquer(tx, c, 'valider', null, u, appareilId) : c;
    });
    if (resultat.statut === 'validee') this.sauvegarderEnFond(u, appareilId);
    return this.vue(resultat, u);
  }

  async decider(id: string, dto: DecisionClotureDto, u: UtilisateurConnecte, appareilId: string) {
    const resultat = await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(cloturesCaisse).where(eq(cloturesCaisse.id, id)).for('update');
      if (!c) throw new ErreurMetier('INTROUVABLE', 'Clôture introuvable', HttpStatus.NOT_FOUND);
      if (c.statut !== 'a_valider') throw new ErreurMetier('CLOTURE_TRAITEE', 'Cette clôture a déjà été traitée', HttpStatus.CONFLICT);
      if (dto.decision === 'refuser' && !dto.commentaire) throw new ErreurMetier('COMMENTAIRE_REQUIS', 'Indiquez pourquoi la clôture est refusée (le caissier devra recompter)');
      return this.appliquer(tx, c, dto.decision, dto.commentaire, u, appareilId);
    });
    if (resultat.statut === 'validee') this.sauvegarderEnFond(u, appareilId);
    return this.vue(resultat, u);
  }

  private async appliquer(tx: Tx, c: Cloture, decision: 'valider' | 'refuser', commentaire: string | null | undefined, u: UtilisateurConnecte, appareilId: string) {
    if (decision === 'valider' && c.ecart !== 0) {
      await this.tresorerie.operation(tx, {
        compteId: c.compteId,
        montant: c.ecart,
        type: 'ecart_cloture',
        document: { type: 'cloture_caisse', id: c.id },
        libelle: `Écart de clôture du ${c.jour.split('-').reverse().join('/')} : ${c.justification ?? ''}`,
        utilisateurId: u.id,
        correction: true,
      });
    }
    const [maj] = await tx
      .update(cloturesCaisse)
      .set({ statut: decision === 'valider' ? 'validee' : 'refusee', commentaire: commentaire ?? null, validePar: u.id, valideLe: new Date() })
      .where(eq(cloturesCaisse.id, c.id))
      .returning();
    await this.audit.enregistrer(tx, {
      action: decision === 'valider' ? 'caisse.cloture_validee' : 'caisse.cloture_refusee',
      utilisateurId: u.id,
      appareilId,
      entite: 'cloture_caisse',
      entiteId: c.id,
      details: { jour: c.jour, ecart: c.ecart, commentaire: commentaire ?? null },
    });
    return maj;
  }

  /** Sauvegarde à la fermeture de la journée de caisse (§9), sans faire attendre l'écran. */
  private sauvegarderEnFond(u: UtilisateurConnecte, appareilId: string) {
    void this.parametres
      .lire()
      .then((p) => (p.sauvegardeClePublique ? this.sauvegardes.sauvegarder('cloture-caisse', u.id, appareilId) : undefined))
      .catch((e) => this.journal.warn(`Sauvegarde après clôture impossible : ${(e as Error).message}`));
  }

  async lister(u: UtilisateurConnecte) {
    const lignes = await this.db
      .select({ c: cloturesCaisse, compte: comptesTresorerie.nom, saisiePar: utilisateurs.nomComplet })
      .from(cloturesCaisse)
      .innerJoin(comptesTresorerie, eq(comptesTresorerie.id, cloturesCaisse.compteId))
      .leftJoin(utilisateurs, eq(utilisateurs.id, cloturesCaisse.saisiePar))
      .orderBy(desc(cloturesCaisse.saisieLe))
      .limit(120);
    const valideurs = await this.db.select({ id: utilisateurs.id, nom: utilisateurs.nomComplet }).from(utilisateurs);
    return lignes.map(({ c, compte, saisiePar }) =>
      this.vue(c, u, { compte, saisiePar, validePar: c.validePar ? (valideurs.find((v) => v.id === c.validePar)?.nom ?? null) : null }),
    );
  }
}
