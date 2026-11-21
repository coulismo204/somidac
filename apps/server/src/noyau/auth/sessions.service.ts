import { Inject, Injectable } from '@nestjs/common';
import { DUREE_MAX_SESSION_HEURES, INACTIVITE_VERROUILLAGE_MIN } from '@somidac/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { DB, Db, DbOuTx } from '../base/base';
import { sessions } from '../base/schema';

export function hacherJeton(jeton: string): string {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

export type EtatSession =
  | { etat: 'valide'; sessionId: string; utilisateurId: string }
  | { etat: 'verrouillee'; sessionId: string; utilisateurId: string }
  | { etat: 'invalide' };

/**
 * Sessions côté serveur : jeton aléatoire (seule son empreinte est stockée), lié à l'appareil,
 * verrouillé après 15 min d'inactivité, expiré après 12 h.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async ouvrir(tx: DbOuTx, utilisateurId: string, appareilId: string): Promise<{ jeton: string; sessionId: string }> {
    const jeton = crypto.randomBytes(32).toString('base64url');
    const [s] = await tx
      .insert(sessions)
      .values({
        utilisateurId,
        appareilId,
        hashJeton: hacherJeton(jeton),
        expireLe: new Date(Date.now() + DUREE_MAX_SESSION_HEURES * 3600_000),
      })
      .returning({ id: sessions.id });
    return { jeton, sessionId: s.id };
  }

  /** Vérifie un jeton présenté depuis un appareil donné et met à jour l'activité. */
  async verifier(jeton: string, appareilId: string, maintenant = new Date()): Promise<EtatSession> {
    const [s] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.hashJeton, hacherJeton(jeton)), isNull(sessions.fermeeLe)));
    if (!s || s.appareilId !== appareilId || s.expireLe <= maintenant) return { etat: 'invalide' };

    const inactif = maintenant.getTime() - s.derniereActivite.getTime() > INACTIVITE_VERROUILLAGE_MIN * 60_000;
    if (s.verrouillee || inactif) {
      if (!s.verrouillee) await this.db.update(sessions).set({ verrouillee: true }).where(eq(sessions.id, s.id));
      return { etat: 'verrouillee', sessionId: s.id, utilisateurId: s.utilisateurId };
    }
    await this.db.update(sessions).set({ derniereActivite: maintenant }).where(eq(sessions.id, s.id));
    return { etat: 'valide', sessionId: s.id, utilisateurId: s.utilisateurId };
  }

  async verrouiller(tx: DbOuTx, sessionId: string) {
    await tx.update(sessions).set({ verrouillee: true }).where(eq(sessions.id, sessionId));
  }

  async deverrouiller(tx: DbOuTx, sessionId: string) {
    await tx.update(sessions).set({ verrouillee: false, derniereActivite: new Date() }).where(eq(sessions.id, sessionId));
  }

  async fermer(tx: DbOuTx, sessionId: string) {
    await tx.update(sessions).set({ fermeeLe: new Date() }).where(eq(sessions.id, sessionId));
  }

  /** Ferme toutes les sessions d'un utilisateur (désactivation, changement de mot de passe). */
  async fermerPourUtilisateur(tx: DbOuTx, utilisateurId: string, saufSessionId?: string) {
    const conditions = [eq(sessions.utilisateurId, utilisateurId), isNull(sessions.fermeeLe)];
    if (saufSessionId) conditions.push(ne(sessions.id, saufSessionId));
    await tx.update(sessions).set({ fermeeLe: new Date() }).where(and(...conditions));
  }

  /** Ferme toutes les sessions ouvertes depuis un appareil (révocation). */
  async fermerPourAppareil(tx: DbOuTx, appareilId: string) {
    await tx
      .update(sessions)
      .set({ fermeeLe: new Date() })
      .where(and(eq(sessions.appareilId, appareilId), isNull(sessions.fermeeLe)));
  }
}
