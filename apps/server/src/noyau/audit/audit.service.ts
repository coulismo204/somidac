import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, sql } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { DB, Db, DbOuTx } from '../base/base';
import { journalAudit } from '../base/schema';
import { jsonCanonique } from '../commun/json-canonique';

export const HASH_ORIGINE = '0'.repeat(64);
/** Clé du verrou PostgreSQL qui sérialise les écritures dans le journal. */
const VERROU_JOURNAL = 4_242_001;

export interface EntreeAudit {
  action: string;
  utilisateurId?: string | null;
  appareilId?: string | null;
  entite?: string | null;
  entiteId?: string | null;
  avant?: unknown;
  apres?: unknown;
  details?: unknown;
}

/** Champs qui ne doivent jamais apparaître dans le journal (§10.4). */
const CHAMPS_SENSIBLES = new Set([
  'hashMotDePasse',
  'motDePasse',
  'motDePasseInitial',
  'nouveauMotDePasse',
  'ancienMotDePasse',
  'secretCode',
  'jeton',
  'hashJeton',
  'preuve',
]);

function masquer(valeur: unknown): unknown {
  if (valeur === undefined || valeur === null) return null;
  if (valeur instanceof Date) return valeur.toISOString();
  if (Array.isArray(valeur)) return valeur.map(masquer);
  if (typeof valeur === 'object') {
    const res: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
      res[cle] = CHAMPS_SENSIBLES.has(cle) ? '***' : masquer(v);
    }
    return res;
  }
  return valeur;
}

export function calculerHash(hashPrecedent: string, contenu: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(hashPrecedent).update(jsonCanonique(contenu)).digest('hex');
}

/**
 * Journal d'audit chaîné (§10.5) : chaque entrée contient l'empreinte de la précédente,
 * donc toute modification ou suppression rompt la chaîne et est détectée.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** À appeler dans la transaction de l'opération : l'entrée n'existe que si l'opération réussit. */
  async enregistrer(tx: DbOuTx, entree: EntreeAudit): Promise<void> {
    const executer = async (t: DbOuTx) => {
      await t.execute(sql`SELECT pg_advisory_xact_lock(${VERROU_JOURNAL})`);
      const [dernier] = await t
        .select({ hash: journalAudit.hash })
        .from(journalAudit)
        .orderBy(desc(journalAudit.id))
        .limit(1);
      const hashPrecedent = dernier?.hash ?? HASH_ORIGINE;
      const contenu = {
        horodatage: new Date().toISOString(),
        utilisateurId: entree.utilisateurId ?? null,
        appareilId: entree.appareilId ?? null,
        action: entree.action,
        entite: entree.entite ?? null,
        entiteId: entree.entiteId ?? null,
        avant: masquer(entree.avant),
        apres: masquer(entree.apres),
        details: masquer(entree.details),
      };
      await t.insert(journalAudit).values({
        ...contenu,
        horodatage: new Date(contenu.horodatage),
        hashPrecedent,
        hash: calculerHash(hashPrecedent, contenu),
      });
    };
    // Le verrou « xact » exige une transaction : on en ouvre une si l'appelant n'en a pas.
    if (tx === this.db) await this.db.transaction(executer);
    else await executer(tx);
  }

  async lister(limite = 100, avantId?: number) {
    const requete = this.db.select().from(journalAudit);
    const filtree = avantId ? requete.where(sql`${journalAudit.id} < ${avantId}`) : requete;
    return filtree.orderBy(desc(journalAudit.id)).limit(Math.min(limite, 500));
  }

  /** Recalcule toute la chaîne et signale la première entrée altérée. */
  async verifierChaine(): Promise<{ valide: boolean; nbEntrees: number; premiereRuptureId: number | null }> {
    const entrees = await this.db.select().from(journalAudit).orderBy(asc(journalAudit.id));
    let precedent = HASH_ORIGINE;
    for (const e of entrees) {
      const contenu = {
        horodatage: e.horodatage.toISOString(),
        utilisateurId: e.utilisateurId,
        appareilId: e.appareilId,
        action: e.action,
        entite: e.entite,
        entiteId: e.entiteId,
        avant: e.avant,
        apres: e.apres,
        details: e.details,
      };
      if (e.hashPrecedent !== precedent || calculerHash(precedent, contenu) !== e.hash) {
        return { valide: false, nbEntrees: entrees.length, premiereRuptureId: e.id };
      }
      precedent = e.hash;
    }
    return { valide: true, nbEntrees: entrees.length, premiereRuptureId: null };
  }
}
