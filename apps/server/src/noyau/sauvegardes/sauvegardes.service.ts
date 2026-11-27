import { HttpStatus, Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';
import { CONFIGURATION, Configuration } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { DB, Db } from '../base/base';
import { trouverDossierMigrations } from '../base/migrations';
import { appareils, parametres, sauvegardes, sessions } from '../base/schema';
import { ErreurMetier } from '../commun/erreurs';
import { ParametresService } from '../parametres/parametres.service';
import { COFFRE, Coffre } from '../pki/coffre';
import {
  aSupprimer,
  changerMotDePasseRestauration,
  chiffrerSauvegarde,
  creerClesSauvegarde,
  deballer,
  dechiffrerClePrivee,
  dechiffrerSauvegarde,
  empaqueter,
  ErreurSauvegarde,
  lireEntete,
} from './format';

const EXTENSION = '.somidac';
const MOTIF_FICHIER = /^somidac-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.somidac$/;
/** Alerte si aucune copie externe n'a réussi depuis ce délai (§9). */
const ALERTE_COPIE_EXTERNE_JOURS = 3;
const EXE = process.platform === 'win32' ? '.exe' : '';

export interface FichierListe {
  nom: string;
  dossier: string;
  taille: number;
  date: string;
}

function dateDuNom(nom: string): Date | null {
  const m = MOTIF_FICHIER.exec(nom);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function nomPourDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `somidac-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${EXTENSION}`;
}

function erreurEnTexte(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sauvegardes (cahier des charges §9) : quotidiennes et automatiques, chiffrées, copiées vers des dossiers
 * externes (clé USB, dossier synchronisé), conservées 30 jours + 12 mois, restaurables par le gérant.
 */
@Injectable()
export class SauvegardesService implements OnModuleInit, OnApplicationShutdown {
  private readonly journal = new Logger('Sauvegardes');
  private enCours = false;
  private minuteur?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIGURATION) private readonly config: Configuration,
    @Inject(COFFRE) private readonly coffre: Coffre,
    private readonly parametres: ParametresService,
    private readonly audit: AuditService,
  ) {}

  get dossierLocal() {
    return this.config.sauvegardesDir;
  }

  onModuleInit() {
    fs.mkdirSync(this.dossierLocal, { recursive: true });
    if (process.env.SOMIDAC_SAUVEGARDE_AUTO === '0') return;
    this.minuteur = setInterval(() => void this.verifierPlanification(), 60_000);
    this.minuteur.unref();
  }

  onApplicationShutdown() {
    if (this.minuteur) clearInterval(this.minuteur);
  }

  /** Sauvegarde automatique : une fois par jour, à partir de l'heure choisie. */
  async verifierPlanification(maintenant = new Date()) {
    try {
      const p = await this.parametres.lire();
      if (!p.sauvegardeClePublique || this.enCours) return;
      const [h, m] = p.sauvegardeHeure.split(':').map(Number);
      const heurePrevue = new Date(maintenant);
      heurePrevue.setHours(h, m, 0, 0);
      if (maintenant < heurePrevue) return;
      const debutJour = new Date(maintenant);
      debutJour.setHours(0, 0, 0, 0);
      const [derniere] = await this.db
        .select({ creeLe: sauvegardes.creeLe })
        .from(sauvegardes)
        .where(sql`${sauvegardes.declenchement} = 'automatique' AND ${sauvegardes.statut} = 'reussie' AND ${sauvegardes.creeLe} >= ${debutJour}`)
        .limit(1);
      if (derniere) return;
      await this.sauvegarder('automatique', null, null);
    } catch (e) {
      this.journal.error(`Sauvegarde automatique impossible : ${erreurEnTexte(e)}`);
    }
  }

  // ---------------------------------------------------------------- état et réglages

  async etat() {
    const p = await this.parametres.lire();
    const historique = await this.db.select().from(sauvegardes).orderBy(desc(sauvegardes.creeLe)).limit(30);
    const derniereReussie = historique.find((s) => s.statut === 'reussie');
    const derniereCopieExterne = historique.find((s) => s.statut === 'reussie' && s.copies.some((c) => c.ok));

    const alertes: string[] = [];
    if (!p.sauvegardeClePublique) alertes.push("Les sauvegardes ne sont pas configurées : choisissez un mot de passe de restauration.");
    else {
      if (!derniereReussie) alertes.push("Aucune sauvegarde n'a encore été faite.");
      if (!p.sauvegardeDossiers.length) alertes.push('Aucun dossier externe (clé USB, dossier synchronisé) : les sauvegardes restent sur ce PC.');
      else if (
        !derniereCopieExterne ||
        Date.now() - derniereCopieExterne.creeLe.getTime() > ALERTE_COPIE_EXTERNE_JOURS * 24 * 3600_000
      ) {
        alertes.push(`Aucune copie externe réussie depuis plus de ${ALERTE_COPIE_EXTERNE_JOURS} jours : vérifiez la clé USB ou le dossier synchronisé.`);
      }
    }
    return {
      configure: !!p.sauvegardeClePublique,
      outilDisponible: this.outilDisponible('pg_dump'),
      heure: p.sauvegardeHeure,
      dossiers: p.sauvegardeDossiers,
      dossierLocal: this.dossierLocal,
      derniereReussieLe: derniereReussie?.creeLe ?? null,
      derniereCopieExterneLe: derniereCopieExterne?.creeLe ?? null,
      alertes,
      historique,
    };
  }

  /** Premier choix ou changement du mot de passe de restauration (les anciennes sauvegardes restent lisibles). */
  async definirMotDePasse(motDePasse: string, ancien: string | undefined, utilisateurId: string, appareilId: string) {
    const p = await this.parametres.lire();
    let maj: { sauvegardeClePublique?: string; sauvegardeClePriveeChiffree: string };
    if (!p.sauvegardeClePriveeChiffree) {
      const cles = creerClesSauvegarde(motDePasse);
      maj = { sauvegardeClePublique: cles.clePublique, sauvegardeClePriveeChiffree: cles.clePriveeChiffree };
    } else {
      if (!ancien) throw new ErreurMetier('ANCIEN_MOT_DE_PASSE_REQUIS', 'Saisissez le mot de passe de restauration actuel');
      maj = { sauvegardeClePriveeChiffree: this.traduire(() => changerMotDePasseRestauration(p.sauvegardeClePriveeChiffree!, ancien, motDePasse)) };
    }
    await this.db.transaction(async (tx) => {
      await tx.update(parametres).set(maj).where(eq(parametres.id, 1));
      await this.audit.enregistrer(tx, {
        action: p.sauvegardeClePriveeChiffree ? 'sauvegarde.mot_de_passe_change' : 'sauvegarde.configuree',
        utilisateurId,
        appareilId,
      });
    });
    this.parametres.invaliderCache();
    return this.etat();
  }

  async modifierReglages(heure: string, dossiers: string[], utilisateurId: string, appareilId: string) {
    const propres = [...new Set(dossiers.map((d) => d.trim()).filter(Boolean))];
    const problemes = propres
      .map((d) => ({ d, erreur: this.testerDossier(d) }))
      .filter((x) => x.erreur)
      .map((x) => `${x.d} : ${x.erreur}`);
    if (problemes.length) {
      throw new ErreurMetier('DOSSIER_INACCESSIBLE', `Dossier inutilisable - ${problemes.join(' ; ')}`);
    }
    const avant = await this.parametres.lire();
    await this.db.transaction(async (tx) => {
      await tx.update(parametres).set({ sauvegardeHeure: heure, sauvegardeDossiers: propres }).where(eq(parametres.id, 1));
      await this.audit.enregistrer(tx, {
        action: 'sauvegarde.reglages_modifies',
        utilisateurId,
        appareilId,
        avant: { heure: avant.sauvegardeHeure, dossiers: avant.sauvegardeDossiers },
        apres: { heure, dossiers: propres },
      });
    });
    this.parametres.invaliderCache();
    return this.etat();
  }

  /** Liste les sauvegardes présentes sur ce PC et dans les dossiers externes. */
  async listerFichiers(): Promise<FichierListe[]> {
    const p = await this.parametres.lire();
    const res: FichierListe[] = [];
    for (const dossier of [this.dossierLocal, ...p.sauvegardeDossiers]) {
      let noms: string[] = [];
      try {
        noms = fs.readdirSync(dossier);
      } catch {
        continue;
      }
      for (const nom of noms) {
        const date = dateDuNom(nom);
        if (!date) continue;
        res.push({ nom, dossier, taille: fs.statSync(path.join(dossier, nom)).size, date: date.toISOString() });
      }
    }
    return res.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---------------------------------------------------------------- sauvegarde

  async sauvegarder(declenchement: 'automatique' | 'manuelle' | 'avant-restauration', utilisateurId: string | null, appareilId: string | null) {
    if (this.enCours) throw new ErreurMetier('SAUVEGARDE_EN_COURS', 'Une sauvegarde est déjà en cours', HttpStatus.CONFLICT);
    this.enCours = true;
    const debut = Date.now();
    try {
      const p = await this.parametres.lire();
      if (!p.sauvegardeClePublique) {
        throw new ErreurMetier('SAUVEGARDE_NON_CONFIGUREE', "Choisissez d'abord un mot de passe de restauration");
      }
      const contenu = empaqueter(
        [{ nom: 'base.dump', donnees: this.exporterBase() }, ...this.fichiersServeur()],
        await this.derniereMigration(),
      );
      const fichier = chiffrerSauvegarde(contenu, p.sauvegardeClePublique, {
        entreprise: p.raisonSociale,
        versionApplication: this.config.version,
      });
      const nom = nomPourDate(new Date());
      fs.writeFileSync(path.join(this.dossierLocal, nom), fichier, { mode: 0o600 });

      const copies = p.sauvegardeDossiers.map((dossier) => {
        try {
          fs.mkdirSync(dossier, { recursive: true });
          fs.copyFileSync(path.join(this.dossierLocal, nom), path.join(dossier, nom));
          this.appliquerConservation(dossier);
          return { dossier, ok: true };
        } catch (e) {
          return { dossier, ok: false, erreur: erreurEnTexte(e) };
        }
      });
      this.appliquerConservation(this.dossierLocal);

      const [ligne] = await this.db
        .insert(sauvegardes)
        .values({
          declenchement,
          utilisateurId,
          statut: 'reussie',
          fichier: nom,
          taille: fichier.length,
          empreinte: crypto.createHash('sha256').update(fichier).digest('hex'),
          copies,
          dureeMs: Date.now() - debut,
        })
        .returning();
      await this.audit.enregistrer(this.db, {
        action: 'sauvegarde.faite',
        utilisateurId,
        appareilId,
        entite: 'sauvegarde',
        entiteId: ligne.id,
        details: { fichier: nom, declenchement, copies: copies.map((c) => ({ dossier: c.dossier, ok: c.ok })) },
      });
      return ligne;
    } catch (e) {
      await this.db.insert(sauvegardes).values({
        declenchement,
        utilisateurId,
        statut: 'echouee',
        erreur: erreurEnTexte(e),
        dureeMs: Date.now() - debut,
      });
      await this.audit.enregistrer(this.db, {
        action: 'sauvegarde.echouee',
        utilisateurId,
        appareilId,
        details: { declenchement, erreur: erreurEnTexte(e) },
      });
      throw e;
    } finally {
      this.enCours = false;
    }
  }

  // ---------------------------------------------------------------- vérification et restauration

  /** Déchiffre une sauvegarde et contrôle son contenu, sans rien modifier. */
  async verifier(nom: string, dossier: string, motDePasse: string) {
    const { entete, fichiers } = await this.ouvrir(nom, dossier, motDePasse);
    const dump = fichiers.get('base.dump');
    if (!dump) throw new ErreurMetier('SAUVEGARDE_ALTEREE', 'Sauvegarde incomplète : base absente');
    this.controlerDump(dump);
    return { valide: true, creeLe: entete.creeLe, entreprise: entete.entreprise, versionApplication: entete.versionApplication, tailleBase: dump.length };
  }

  /**
   * Restaure une sauvegarde à la place de la base actuelle (§9).
   * 1. vérifie la sauvegarde ; 2. sauvegarde l'état actuel ; 3. charge la sauvegarde dans une nouvelle base ;
   * 4. échange les bases (l'ancienne est conservée sous un autre nom) ; 5. reporte les appareils
   * enregistrés ou révoqués depuis ; 6. ferme toutes les sessions.
   */
  async restaurer(nom: string, dossier: string, motDePasse: string, utilisateurId: string, appareilId: string) {
    const { entete, fichiers } = await this.ouvrir(nom, dossier, motDePasse);
    const dump = fichiers.get('base.dump');
    if (!dump) throw new ErreurMetier('SAUVEGARDE_ALTEREE', 'Sauvegarde incomplète : base absente');
    this.controlerDump(dump);

    // Filet de sécurité : l'état actuel est sauvegardé avant d'être remplacé.
    await this.sauvegarder('avant-restauration', utilisateurId, appareilId);
    const appareilsActuels = await this.db.select().from(appareils);

    const url = new URL(this.config.databaseUrl);
    const base = decodeURIComponent(url.pathname.slice(1));
    const horodatage = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const nouvelle = `${base}_restauration_${horodatage}`;
    const ancienne = `${base}_avant_${horodatage}`;
    const temporaire = path.join(this.dossierLocal, `.restauration-${horodatage}.dump`);
    fs.writeFileSync(temporaire, dump, { mode: 0o600 });

    const maintenance = new Client({ connectionString: this.urlBase('postgres') });
    await maintenance.connect();
    try {
      await maintenance.query(`CREATE DATABASE "${nouvelle}"`);
      const r = this.outil('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '-d', nouvelle, temporaire]);
      if (r.code !== 0) {
        await maintenance.query(`DROP DATABASE IF EXISTS "${nouvelle}"`);
        throw new ErreurMetier('RESTAURATION_ECHOUEE', `Chargement de la sauvegarde impossible : ${r.sortie.slice(0, 500)}`);
      }
      // Échange : les connexions à la base actuelle sont coupées, puis les bases sont renommées.
      await maintenance.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [base]);
      await maintenance.query(`ALTER DATABASE "${base}" RENAME TO "${ancienne}"`);
      await maintenance.query(`ALTER DATABASE "${nouvelle}" RENAME TO "${base}"`);
    } finally {
      await maintenance.end();
      fs.rmSync(temporaire, { force: true });
    }

    // La base restaurée peut être plus ancienne que l'application : mise à jour du schéma.
    await migrate(this.db, { migrationsFolder: trouverDossierMigrations() });
    await this.db.transaction(async (tx) => {
      // Les appareils enregistrés depuis la sauvegarde restent autorisés ; ceux révoqués depuis restent révoqués.
      const restaures = new Map((await tx.select().from(appareils)).map((a) => [a.id, a]));
      for (const a of appareilsActuels) {
        const r = restaures.get(a.id);
        if (!r) await tx.insert(appareils).values(a);
        else if (a.statut === 'revoque' && r.statut !== 'revoque') {
          await tx.update(appareils).set({ statut: 'revoque', revoqueLe: a.revoqueLe, revoquePar: a.revoquePar }).where(eq(appareils.id, a.id));
        } else if (a.numeroSerieCertificat !== r.numeroSerieCertificat && a.statut === 'actif') {
          // Certificat renouvelé depuis la sauvegarde : le certificat actuel reste valable.
          await tx.update(appareils).set({ numeroSerieCertificat: a.numeroSerieCertificat, certificatPem: a.certificatPem, certificatExpireLe: a.certificatExpireLe, empreinteClePublique: a.empreinteClePublique }).where(eq(appareils.id, a.id));
        }
      }
      // Toutes les sessions de la base restaurée sont fermées : chacun se reconnecte.
      await tx.update(sessions).set({ fermeeLe: new Date() }).where(sql`${sessions.fermeeLe} IS NULL`);
      await this.audit.enregistrer(tx, {
        action: 'sauvegarde.restauree',
        utilisateurId: null,
        appareilId,
        details: { fichier: nom, sauvegardeDu: entete.creeLe, ancienneBaseConservee: ancienne, demandeePar: utilisateurId },
      });
    });
    this.parametres.invaliderCache();
    return { restauree: true, sauvegardeDu: entete.creeLe, ancienneBaseConservee: ancienne };
  }

  // ---------------------------------------------------------------- outils internes

  private async ouvrir(nom: string, dossier: string, motDePasse: string) {
    const p = await this.parametres.lire();
    if (!p.sauvegardeClePriveeChiffree) {
      throw new ErreurMetier('SAUVEGARDE_NON_CONFIGUREE', "Choisissez d'abord un mot de passe de restauration");
    }
    const chemin = this.cheminAutorise(nom, dossier, p.sauvegardeDossiers);
    const fichier = fs.readFileSync(chemin);
    return this.traduire(() => {
      lireEntete(fichier);
      const cle = dechiffrerClePrivee(p.sauvegardeClePriveeChiffree!, motDePasse);
      const { entete, contenu } = dechiffrerSauvegarde(fichier, cle);
      return { entete, ...deballer(contenu) };
    });
  }

  /** Seuls les fichiers de sauvegarde des dossiers connus peuvent être lus (pas de chemin arbitraire). */
  private cheminAutorise(nom: string, dossier: string, dossiersExternes: string[]): string {
    if (!dateDuNom(nom) || path.basename(nom) !== nom) {
      throw new ErreurMetier('FICHIER_INVALIDE', 'Nom de sauvegarde invalide');
    }
    const autorises = [this.dossierLocal, ...dossiersExternes].map((d) => path.resolve(d));
    const choisi = path.resolve(dossier);
    if (!autorises.includes(choisi)) throw new ErreurMetier('DOSSIER_NON_AUTORISE', 'Dossier de sauvegarde non autorisé');
    const chemin = path.join(choisi, nom);
    if (!fs.existsSync(chemin)) throw new ErreurMetier('INTROUVABLE', 'Sauvegarde introuvable', HttpStatus.NOT_FOUND);
    return chemin;
  }

  private traduire<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      if (e instanceof ErreurSauvegarde) {
        const statut = e.code === 'MOT_DE_PASSE_RESTAURATION_INCORRECT' ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST;
        throw new ErreurMetier(e.code, e.message, statut);
      }
      throw e;
    }
  }

  private testerDossier(dossier: string): string | null {
    if (!path.isAbsolute(dossier)) return 'chemin complet attendu (ex. E:\\SOMIDAC-sauvegardes)';
    try {
      fs.mkdirSync(dossier, { recursive: true });
      const test = path.join(dossier, `.somidac-test-${crypto.randomBytes(4).toString('hex')}`);
      fs.writeFileSync(test, 'test');
      fs.rmSync(test);
      return null;
    } catch (e) {
      return erreurEnTexte(e);
    }
  }

  private appliquerConservation(dossier: string) {
    const fichiers = fs.readdirSync(dossier).filter((n) => dateDuNom(n));
    const parDate = new Map(fichiers.map((n) => [dateDuNom(n)!.getTime(), n]));
    for (const d of aSupprimer([...parDate.keys()].map((t) => new Date(t)))) {
      fs.rmSync(path.join(dossier, parDate.get(d.getTime())!), { force: true });
    }
  }

  private fichiersServeur() {
    // Autorité interne (certificats des appareils) et son mot de passe : nécessaires pour restaurer sur un nouveau PC.
    const pki = path.join(this.config.dataDir, 'pki');
    const res: { nom: string; donnees: Buffer }[] = [];
    for (const nom of ['autorite.cert.pem', 'autorite.key.pem']) {
      const f = path.join(pki, nom);
      if (fs.existsSync(f)) res.push({ nom: `pki/${nom}`, donnees: fs.readFileSync(f) });
    }
    const mdp = this.coffre.lire('motDePasseCleAutorite');
    if (mdp) res.push({ nom: 'secrets/motDePasseCleAutorite', donnees: Buffer.from(mdp) });
    return res;
  }

  private async derniereMigration(): Promise<string | null> {
    try {
      const r = await this.db.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`);
      return (r.rows[0] as { hash?: string } | undefined)?.hash ?? null;
    } catch {
      return null;
    }
  }

  private exporterBase(): Buffer {
    const temporaire = path.join(this.dossierLocal, `.export-${crypto.randomBytes(6).toString('hex')}.dump`);
    try {
      const r = this.outil('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '-f', temporaire, decodeURIComponent(new URL(this.config.databaseUrl).pathname.slice(1))]);
      if (r.code !== 0) throw new Error(`Export de la base impossible : ${r.sortie.slice(0, 500)}`);
      return fs.readFileSync(temporaire);
    } finally {
      fs.rmSync(temporaire, { force: true });
    }
  }

  private controlerDump(dump: Buffer) {
    const temporaire = path.join(this.dossierLocal, `.controle-${crypto.randomBytes(6).toString('hex')}.dump`);
    fs.writeFileSync(temporaire, dump, { mode: 0o600 });
    try {
      const r = this.outilBrut('pg_restore', ['--list', temporaire], {});
      if (r.code !== 0) throw new ErreurMetier('SAUVEGARDE_ALTEREE', 'La base contenue dans la sauvegarde est illisible');
    } finally {
      fs.rmSync(temporaire, { force: true });
    }
  }

  private outilDisponible(nom: string): boolean {
    return !!this.config.pgBin && fs.existsSync(path.join(this.config.pgBin, nom + EXE));
  }

  /** Lance un outil PostgreSQL connecté à la base (le mot de passe passe par l'environnement, jamais la ligne de commande). */
  private outil(nom: string, args: string[]) {
    const url = new URL(this.config.databaseUrl);
    return this.outilBrut(nom, ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), ...args], {
      PGPASSWORD: decodeURIComponent(url.password),
    });
  }

  private outilBrut(nom: string, args: string[], env: Record<string, string>) {
    if (!this.outilDisponible(nom)) {
      throw new ErreurMetier('OUTIL_INDISPONIBLE', `Outil PostgreSQL introuvable (${nom}) : sauvegarde impossible sur ce poste`);
    }
    const r = spawnSync(path.join(this.config.pgBin!, nom + EXE), args, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30 * 60_000,
    });
    return { code: r.status ?? -1, sortie: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
  }

  private urlBase(nom: string) {
    const url = new URL(this.config.databaseUrl);
    url.pathname = `/${nom}`;
    return url.toString();
  }
}
