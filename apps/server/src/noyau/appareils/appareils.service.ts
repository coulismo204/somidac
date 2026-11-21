import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ALPHABET_CODE_ACTIVATION,
  CODES_ERREUR as E,
  DELAI_RENOUVELLEMENT_CERTIFICAT_JOURS,
  DUREE_CODE_ACTIVATION_MIN,
  EnrolementDto,
  PREFIXE_PREUVE_APPAREIL,
  PREFIXE_PREUVE_SERVEUR,
  TENTATIVES_MAX_CODE_ACTIVATION,
} from '@somidac/shared';
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';
import * as crypto from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from '../auth/sessions.service';
import { DB, Db, DbOuTx } from '../base/base';
import { appareils, sites } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';
import { ParametresService } from '../parametres/parametres.service';
import { ErreurPki, Pki, PKI } from '../pki/pki';

type Appareil = typeof appareils.$inferSelect;

export function hmac(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function egaliteConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function tirerCaracteres(n: number): string {
  let res = '';
  for (let i = 0; i < n; i++) res += ALPHABET_CODE_ACTIVATION[crypto.randomInt(ALPHABET_CODE_ACTIVATION.length)];
  return res;
}

/** Vue publique d'un appareil : jamais le secret ni la clé. */
export function vueAppareil(a: Appareil) {
  return {
    id: a.id,
    nom: a.nom,
    statut: a.statut,
    codeEnAttente: a.statut === 'en_attente' && !!a.codeExpireLe && a.codeExpireLe > new Date(),
    codeExpireLe: a.codeExpireLe,
    enregistreLe: a.enregistreLe,
    derniereConnexion: a.derniereConnexion,
    dernierUtilisateurId: a.dernierUtilisateurId,
    certificatExpireLe: a.certificatExpireLe,
    infosSysteme: a.infosSysteme,
    revoqueLe: a.revoqueLe,
    creeLe: a.creeLe,
  };
}

/** Gestion des appareils et de leur clé chiffrée (cahier des charges §10.1). */
@Injectable()
export class AppareilsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PKI) private readonly pki: Pki,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly parametres: ParametresService,
  ) {}

  async lister() {
    const lignes = await this.db.select().from(appareils).orderBy(desc(appareils.creeLe));
    return lignes.map(vueAppareil);
  }

  /** Étape 1 : le gérant crée l'appareil et obtient un code d'activation à usage unique. */
  async creer(nom: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      await this.verifierLimite(tx);
      const [site] = await tx.select().from(sites).limit(1);
      const code = await this.genererCode(tx);
      const [a] = await tx
        .insert(appareils)
        .values({
          siteId: site.id,
          nom,
          idCode: code.idCode,
          secretCode: code.secret,
          codeExpireLe: code.expireLe,
          creePar: utilisateurId,
        })
        .returning();
      await this.audit.enregistrer(tx, {
        action: 'appareil.cree',
        utilisateurId,
        appareilId,
        entite: 'appareil',
        entiteId: a.id,
        apres: vueAppareil(a),
      });
      return { appareil: vueAppareil(a), codeActivation: code.affichage, expireLe: code.expireLe };
    });
  }

  /** Nouveau code pour un appareil pas encore enregistré (code perdu ou expiré). */
  async nouveauCode(id: string, utilisateurId: string, appareilId: string) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(appareils).where(eq(appareils.id, id)).for('update');
      if (!a) throw new ErreurMetier('INTROUVABLE', 'Appareil introuvable', HttpStatus.NOT_FOUND);
      if (a.statut !== 'en_attente') {
        throw new ErreurMetier('APPAREIL_DEJA_ENREGISTRE', 'Cet appareil est déjà enregistré ou révoqué');
      }
      const code = await this.genererCode(tx);
      await tx
        .update(appareils)
        .set({ idCode: code.idCode, secretCode: code.secret, codeExpireLe: code.expireLe, tentativesCode: 0 })
        .where(eq(appareils.id, id));
      await this.audit.enregistrer(tx, {
        action: 'appareil.nouveau_code',
        utilisateurId,
        appareilId,
        entite: 'appareil',
        entiteId: id,
      });
      return { codeActivation: code.affichage, expireLe: code.expireLe };
    });
  }

  /**
   * Étapes 2 à 4 : l'appareil présente sa demande de certificat et la preuve qu'il connaît le code.
   * Le serveur renvoie le certificat, l'autorité, et sa propre preuve (protection contre un faux serveur).
   */
  async enregistrer(dto: EnrolementDto) {
    const refus = () =>
      new ErreurMetier(E.CODE_ACTIVATION_INVALIDE, "Code d'activation invalide ou expiré", HttpStatus.UNAUTHORIZED);

    const resultat = await this.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(appareils)
        .where(and(eq(appareils.idCode, dto.idCode), eq(appareils.statut, 'en_attente')))
        .for('update');
      if (!a || !a.secretCode || !a.codeExpireLe || a.codeExpireLe <= new Date()) return { erreur: refus() };

      if (!egaliteConstante(hmac(a.secretCode, PREFIXE_PREUVE_APPAREIL + dto.csrPem), dto.preuve)) {
        const tentatives = a.tentativesCode + 1;
        const epuise = tentatives >= TENTATIVES_MAX_CODE_ACTIVATION;
        await tx
          .update(appareils)
          .set(
            epuise
              ? { tentativesCode: tentatives, idCode: null, secretCode: null, codeExpireLe: null }
              : { tentativesCode: tentatives },
          )
          .where(eq(appareils.id, a.id));
        await this.audit.enregistrer(tx, {
          action: epuise ? 'appareil.code_annule_trop_d_essais' : 'appareil.enregistrement_refuse',
          entite: 'appareil',
          entiteId: a.id,
          details: { tentatives },
        });
        // L'échec est mémorisé (commit) avant de renvoyer l'erreur.
        return { erreur: refus() };
      }

      await this.verifierLimite(tx, a.id);
      let emis;
      try {
        emis = await this.pki.emettreCertificatAppareil(a.id, dto.csrPem);
      } catch (e) {
        if (e instanceof ErreurPki) return { erreur: new ErreurMetier('CSR_INVALIDE', e.message) };
        throw e;
      }
      const secret = a.secretCode;
      const [maj] = await tx
        .update(appareils)
        .set({
          statut: 'actif',
          idCode: null,
          secretCode: null,
          codeExpireLe: null,
          tentativesCode: 0,
          empreinteClePublique: emis.empreinteClePublique,
          numeroSerieCertificat: emis.numeroSerie,
          certificatPem: emis.certificatPem,
          certificatExpireLe: emis.expireLe,
          infosSysteme: dto.infosSysteme as Record<string, string>,
          enregistreLe: new Date(),
        })
        .where(eq(appareils.id, a.id))
        .returning();
      await this.audit.enregistrer(tx, {
        action: 'appareil.enregistre',
        appareilId: a.id,
        entite: 'appareil',
        entiteId: a.id,
        apres: vueAppareil(maj),
        details: { empreinteClePublique: emis.empreinteClePublique },
      });
      return {
        ok: {
          appareilId: a.id,
          nom: a.nom,
          certificatPem: emis.certificatPem,
          caPem: this.pki.caPem,
          preuveServeur: hmac(secret, PREFIXE_PREUVE_SERVEUR + emis.certificatPem + this.pki.caPem),
        },
      };
    });
    if ('erreur' in resultat && resultat.erreur) throw resultat.erreur;
    return resultat.ok!;
  }

  /** Enregistrement direct du poste principal lors de l'initialisation (depuis le PC lui-même). */
  async enregistrerPostePrincipal(tx: DbOuTx, nom: string, csrPem: string, infos: Record<string, string>) {
    const [site] = await tx.select().from(sites).limit(1);
    const [a] = await tx.insert(appareils).values({ siteId: site.id, nom }).returning();
    let emis;
    try {
      emis = await this.pki.emettreCertificatAppareil(a.id, csrPem);
    } catch (e) {
      if (e instanceof ErreurPki) throw new ErreurMetier('CSR_INVALIDE', e.message);
      throw e;
    }
    const [maj] = await tx
      .update(appareils)
      .set({
        statut: 'actif',
        empreinteClePublique: emis.empreinteClePublique,
        numeroSerieCertificat: emis.numeroSerie,
        certificatPem: emis.certificatPem,
        certificatExpireLe: emis.expireLe,
        infosSysteme: infos,
        enregistreLe: new Date(),
      })
      .where(eq(appareils.id, a.id))
      .returning();
    return { appareil: maj, certificatPem: emis.certificatPem, caPem: this.pki.caPem };
  }

  /** Révocation : effet immédiat, toutes les sessions de l'appareil sont fermées (§10.1). */
  async revoquer(id: string, utilisateurId: string, appareilCourantId: string) {
    if (id === appareilCourantId) {
      throw new ErreurMetier('REVOCATION_APPAREIL_COURANT', "Impossible de révoquer l'appareil que vous utilisez");
    }
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(appareils).where(eq(appareils.id, id)).for('update');
      if (!a) throw new ErreurMetier('INTROUVABLE', 'Appareil introuvable', HttpStatus.NOT_FOUND);
      if (a.statut === 'revoque') return vueAppareil(a);
      const [maj] = await tx
        .update(appareils)
        .set({
          statut: 'revoque',
          idCode: null,
          secretCode: null,
          codeExpireLe: null,
          revoqueLe: new Date(),
          revoquePar: utilisateurId,
        })
        .where(eq(appareils.id, id))
        .returning();
      await this.sessions.fermerPourAppareil(tx, id);
      await this.audit.enregistrer(tx, {
        action: 'appareil.revoque',
        utilisateurId,
        appareilId: appareilCourantId,
        entite: 'appareil',
        entiteId: id,
        avant: vueAppareil(a),
        apres: vueAppareil(maj),
      });
      return vueAppareil(maj);
    });
  }

  /** Renouvellement automatique du certificat avant expiration, si l'appareil est toujours autorisé. */
  async renouveler(appareilId: string, csrPem: string) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(appareils).where(eq(appareils.id, appareilId)).for('update');
      if (!a || a.statut !== 'actif') {
        throw new ErreurMetier(E.APPAREIL_REVOQUE, 'Cet appareil a été révoqué', HttpStatus.UNAUTHORIZED);
      }
      const limite = Date.now() + DELAI_RENOUVELLEMENT_CERTIFICAT_JOURS * 24 * 3600_000;
      if (a.certificatExpireLe && a.certificatExpireLe.getTime() > limite) {
        throw new ErreurMetier('RENOUVELLEMENT_PREMATURE', "Le certificat n'est pas encore à renouveler");
      }
      let emis;
      try {
        emis = await this.pki.emettreCertificatAppareil(a.id, csrPem);
      } catch (e) {
        if (e instanceof ErreurPki) throw new ErreurMetier('CSR_INVALIDE', e.message);
        throw e;
      }
      await tx
        .update(appareils)
        .set({
          empreinteClePublique: emis.empreinteClePublique,
          numeroSerieCertificat: emis.numeroSerie,
          certificatPem: emis.certificatPem,
          certificatExpireLe: emis.expireLe,
        })
        .where(eq(appareils.id, a.id));
      await this.audit.enregistrer(tx, {
        action: 'appareil.certificat_renouvele',
        appareilId: a.id,
        entite: 'appareil',
        entiteId: a.id,
        details: { expireLe: emis.expireLe.toISOString() },
      });
      return { certificatPem: emis.certificatPem, caPem: this.pki.caPem, expireLe: emis.expireLe };
    });
  }

  /** Limite : appareils actifs + codes en attente encore valides (§10.1). */
  private async verifierLimite(tx: DbOuTx, saufId?: string) {
    const { nbMaxAppareils } = await this.parametres.lire(tx);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(appareils)
      .where(
        or(
          eq(appareils.statut, 'actif'),
          and(eq(appareils.statut, 'en_attente'), isNotNull(appareils.codeExpireLe), gt(appareils.codeExpireLe, new Date())),
        ),
      );
    // L'appareil en cours d'enregistrement est déjà compté (code en attente).
    const occupe = saufId ? total - 1 : total;
    if (occupe >= nbMaxAppareils) {
      throw new ErreurMetier(
        E.LIMITE_APPAREILS,
        `Nombre maximal d'appareils atteint (${nbMaxAppareils}). Révoquez un appareil ou augmentez la limite.`,
        HttpStatus.CONFLICT,
      );
    }
  }

  private async genererCode(tx: DbOuTx) {
    for (let essai = 0; essai < 10; essai++) {
      const idCode = tirerCaracteres(4);
      const [existant] = await tx
        .select({ id: appareils.id })
        .from(appareils)
        .where(inArray(appareils.idCode, [idCode]));
      if (existant) continue;
      const secret = tirerCaracteres(8);
      return {
        idCode,
        secret,
        affichage: `${idCode}-${secret.slice(0, 4)}-${secret.slice(4)}`,
        expireLe: new Date(Date.now() + DUREE_CODE_ACTIVATION_MIN * 60_000),
      };
    }
    throw new Error("Impossible de générer un code d'activation unique");
  }
}
