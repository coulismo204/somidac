import {
  CODES_ERREUR as E,
  decouperCodeActivation,
  DELAI_RENOUVELLEMENT_CERTIFICAT_JOURS,
  PREFIXE_PREUVE_APPAREIL,
  PREFIXE_PREUVE_SERVEUR,
} from '@somidac/shared';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { creerCleEtDemande, dateExpiration, demandeDepuisCle, joursAvantExpiration } from './identite';
import {
  AdresseServeur,
  certificatServeurSigneParAutorite,
  ErreurReseau,
  ReponseApi,
  requeteServeur,
} from './https';

export const PORT_SERVEUR_PAR_DEFAUT = 7443;

/**
 * Chiffrement de la clé privée par le système.
 * Sous Windows, Electron `safeStorage` utilise DPAPI : la clé ne peut être déchiffrée
 * que sur ce PC, par ce compte Windows (§10.1 : copier le dossier ne sert à rien).
 */
export interface Chiffreur {
  disponible(): boolean;
  chiffrer(texte: string): Buffer;
  dechiffrer(donnees: Buffer): string;
}

export type ModePoste = 'principal' | 'secondaire';

interface ConfigPoste {
  version: 1;
  mode: ModePoste;
  serveur: AdresseServeur;
  appareilId: string;
  nomAppareil: string;
  certificatPem: string;
  caPem: string;
  /** Clé privée chiffrée par le système, en base64. */
  cleChiffree: string;
}

export interface EtatPoste {
  configure: boolean;
  mode?: ModePoste;
  nomAppareil?: string;
  appareilId?: string;
  serveur?: AdresseServeur;
  certificatExpireLe?: string;
  connecte: boolean;
}

export interface Profil {
  id: string;
  identifiant: string;
  nomComplet: string;
  doitChangerMotDePasse: boolean;
  plafondRemisePct: number;
  permissions: string[];
}

/** Erreur présentable à l'utilisateur, avec le code stable du serveur s'il existe. */
export class ErreurPoste extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function hmac(secret: string, message: string) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function egal(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Lit « 192.168.1.10 » ou « 192.168.1.10:7443 ». */
export function lireAdresse(saisie: string): AdresseServeur {
  const propre = saisie.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = /^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(propre);
  if (!m) throw new ErreurPoste('ADRESSE_INVALIDE', 'Adresse du serveur invalide (exemple : 192.168.1.10)');
  const port = m[2] ? Number(m[2]) : PORT_SERVEUR_PAR_DEFAUT;
  if (port < 1 || port > 65535) throw new ErreurPoste('ADRESSE_INVALIDE', 'Port invalide');
  return { hote: m[1], port };
}

/**
 * Le poste : son identité (clé + certificat), sa connexion au serveur et la session en cours.
 * Le jeton de session reste dans le processus principal ; les écrans ne le voient jamais.
 */
export class Poste {
  private config?: ConfigPoste;
  private cle?: string;
  private jeton?: string;

  constructor(
    private readonly dossier: string,
    private readonly chiffreur: Chiffreur,
    private readonly infosSysteme: Record<string, string> = {},
  ) {
    this.charger();
  }

  private get fichier() {
    return path.join(this.dossier, 'poste.json');
  }

  private charger() {
    if (!fs.existsSync(this.fichier)) return;
    const config = JSON.parse(fs.readFileSync(this.fichier, 'utf8')) as ConfigPoste;
    try {
      this.cle = this.chiffreur.dechiffrer(Buffer.from(config.cleChiffree, 'base64'));
      this.config = config;
    } catch {
      // Fichier copié depuis un autre PC ou compte Windows : la clé est illisible ici.
      this.config = undefined;
      this.cle = undefined;
    }
  }

  /** À vérifier AVANT de contacter le serveur : sinon il enregistre un appareil dont la clé serait perdue. */
  private exigerChiffrement() {
    if (!this.chiffreur.disponible()) {
      throw new ErreurPoste(
        'CHIFFREMENT_INDISPONIBLE',
        'Le chiffrement du système est indisponible : impossible de protéger la clé de cet appareil.',
      );
    }
  }

  private enregistrerConfig(config: ConfigPoste, cle: string) {
    this.exigerChiffrement();
    fs.mkdirSync(this.dossier, { recursive: true });
    const complet: ConfigPoste = { ...config, cleChiffree: this.chiffreur.chiffrer(cle).toString('base64') };
    const temporaire = `${this.fichier}.tmp`;
    fs.writeFileSync(temporaire, JSON.stringify(complet, null, 2), { mode: 0o600 });
    fs.renameSync(temporaire, this.fichier);
    this.config = complet;
    this.cle = cle;
  }

  etat(): EtatPoste {
    if (!this.config) return { configure: false, connecte: false };
    return {
      configure: true,
      mode: this.config.mode,
      nomAppareil: this.config.nomAppareil,
      appareilId: this.config.appareilId,
      serveur: this.config.serveur,
      certificatExpireLe: dateExpiration(this.config.certificatPem).toISOString(),
      connecte: !!this.jeton,
    };
  }

  /** Oublie l'identité (appareil révoqué) : il faudra un nouveau code d'activation. */
  oublier() {
    this.jeton = undefined;
    this.config = undefined;
    this.cle = undefined;
    if (fs.existsSync(this.fichier)) fs.rmSync(this.fichier);
  }

  /** Le serveur répond-il à cette adresse ? */
  async serveurJoignable(adresse: AdresseServeur): Promise<boolean> {
    try {
      const r = await requeteServeur<{ statut?: string }>(adresse, 'GET', '/sante', { delaiMs: 4000 });
      return r.statut === 200 && r.corps?.statut === 'ok';
    } catch {
      return false;
    }
  }

  /** Le serveur local répond-il, et est-il déjà initialisé ? */
  async etatServeurLocal(port = PORT_SERVEUR_PAR_DEFAUT): Promise<{ joignable: boolean; initialise: boolean }> {
    try {
      const r = await requeteServeur<{ initialise?: boolean }>({ hote: '127.0.0.1', port }, 'GET', '/initialisation', {
        delaiMs: 4000,
      });
      return { joignable: r.statut === 200, initialise: !!r.corps?.initialise };
    } catch {
      return { joignable: false, initialise: false };
    }
  }

  /** Le poste principal a perdu sa clé : nouvel enregistrement avec les identifiants du gérant (local). */
  async reenregistrerPostePrincipal(donnees: { identifiant: string; motDePasse: string; nomPoste: string; port?: number }) {
    this.exigerChiffrement();
    const adresse: AdresseServeur = { hote: '127.0.0.1', port: donnees.port ?? PORT_SERVEUR_PAR_DEFAUT };
    const { clePem, csrPem } = await creerCleEtDemande(donnees.nomPoste);
    const r = await this.appelBrut<{ appareilId: string; certificatPem: string; caPem: string }>(
      adresse,
      'POST',
      '/initialisation/poste-principal',
      {
        corps: {
          identifiant: donnees.identifiant,
          motDePasse: donnees.motDePasse,
          appareil: { nom: donnees.nomPoste, csrPem, infosSysteme: this.infosSysteme },
        },
      },
    );
    this.verifierSucces(r);
    if (!certificatServeurSigneParAutorite(r.certificatServeurDer, r.corps.caPem)) {
      throw new ErreurPoste('SERVEUR_NON_AUTHENTIFIE', "Le serveur local n'a pas pu être authentifié.");
    }
    this.enregistrerConfig(
      {
        version: 1,
        mode: 'principal',
        serveur: adresse,
        appareilId: r.corps.appareilId,
        nomAppareil: donnees.nomPoste,
        certificatPem: r.corps.certificatPem,
        caPem: r.corps.caPem,
        cleChiffree: '',
      },
      clePem,
    );
    return this.etat();
  }

  /** Première mise en route du poste principal : gérant + enregistrement de ce PC (local uniquement). */
  async initialiserPostePrincipal(donnees: {
    raisonSociale?: string;
    gerant: { identifiant: string; nomComplet: string; motDePasse: string };
    nomPoste: string;
    port?: number;
  }) {
    this.exigerChiffrement();
    const adresse: AdresseServeur = { hote: '127.0.0.1', port: donnees.port ?? PORT_SERVEUR_PAR_DEFAUT };
    const { clePem, csrPem } = await creerCleEtDemande(donnees.nomPoste);
    const r = await this.appelBrut<{ appareilId: string; certificatPem: string; caPem: string }>(
      adresse,
      'POST',
      '/initialisation',
      {
        corps: {
          raisonSociale: donnees.raisonSociale,
          gerant: donnees.gerant,
          appareil: { nom: donnees.nomPoste, csrPem, infosSysteme: this.infosSysteme },
        },
      },
    );
    this.verifierSucces(r);
    // Le serveur local doit présenter un certificat signé par l'autorité qu'il vient de nous donner.
    if (!certificatServeurSigneParAutorite(r.certificatServeurDer, r.corps.caPem)) {
      throw new ErreurPoste('SERVEUR_NON_AUTHENTIFIE', "Le serveur local n'a pas pu être authentifié.");
    }
    this.enregistrerConfig(
      {
        version: 1,
        mode: 'principal',
        serveur: adresse,
        appareilId: r.corps.appareilId,
        nomAppareil: donnees.nomPoste,
        certificatPem: r.corps.certificatPem,
        caPem: r.corps.caPem,
        cleChiffree: '',
      },
      clePem,
    );
    return this.etat();
  }

  /**
   * Enregistrement d'un poste secondaire avec le code donné par le gérant (§10.1 étapes 2 à 4).
   * Le secret du code ne quitte jamais ce PC : seule une preuve HMAC est envoyée.
   */
  async enregistrerPosteSecondaire(saisieAdresse: string, saisieCode: string) {
    this.exigerChiffrement();
    const adresse = lireAdresse(saisieAdresse);
    const code = decouperCodeActivation(saisieCode);
    if (!code) throw new ErreurPoste(E.CODE_ACTIVATION_INVALIDE, "Code d'activation mal saisi (format : ABCD-EFGH-JKLM)");

    const { clePem, csrPem } = await creerCleEtDemande('nouvel appareil');
    const r = await this.appelBrut<{
      appareilId: string;
      nom: string;
      certificatPem: string;
      caPem: string;
      preuveServeur: string;
    }>(adresse, 'POST', '/enrolement', {
      corps: {
        idCode: code.idCode,
        csrPem,
        preuve: hmac(code.secret, PREFIXE_PREUVE_APPAREIL + csrPem),
        infosSysteme: this.infosSysteme,
      },
    });
    this.verifierSucces(r);

    // 1. Le serveur prouve qu'il connaît le même code : ce n'est pas un faux serveur.
    const attendue = hmac(code.secret, PREFIXE_PREUVE_SERVEUR + r.corps.certificatPem + r.corps.caPem);
    if (!egal(attendue, r.corps.preuveServeur ?? '')) {
      throw new ErreurPoste('SERVEUR_NON_AUTHENTIFIE', "Le serveur n'a pas pu prouver son identité. Enregistrement annulé.");
    }
    // 2. Le certificat TLS présenté vient bien de cette autorité : pas d'intermédiaire.
    if (!certificatServeurSigneParAutorite(r.certificatServeurDer, r.corps.caPem)) {
      throw new ErreurPoste(
        'SERVEUR_NON_AUTHENTIFIE',
        'La connexion a été interceptée (certificat inattendu). Enregistrement annulé.',
      );
    }
    this.enregistrerConfig(
      {
        version: 1,
        mode: 'secondaire',
        serveur: adresse,
        appareilId: r.corps.appareilId,
        nomAppareil: r.corps.nom,
        certificatPem: r.corps.certificatPem,
        caPem: r.corps.caPem,
        cleChiffree: '',
      },
      clePem,
    );
    return this.etat();
  }

  /** Renouvelle le certificat s'il expire bientôt (appelé au démarrage). */
  async renouvelerSiNecessaire(maintenant = Date.now()): Promise<boolean> {
    if (!this.config || !this.cle) return false;
    if (joursAvantExpiration(this.config.certificatPem, maintenant) > DELAI_RENOUVELLEMENT_CERTIFICAT_JOURS) return false;
    const csrPem = await demandeDepuisCle(this.cle, this.config.nomAppareil);
    const r = await this.appeler<{ certificatPem: string; caPem: string }>('POST', '/appareils/moi/renouveler', {
      csrPem,
    });
    this.verifierSucces(r);
    this.enregistrerConfig({ ...this.config, certificatPem: r.corps.certificatPem, caPem: r.corps.caPem }, this.cle);
    return true;
  }

  async connecter(identifiant: string, motDePasse: string): Promise<Profil> {
    const r = await this.appeler<{ jeton: string; utilisateur: Profil }>('POST', '/auth/connexion', {
      identifiant,
      motDePasse,
    });
    this.verifierSucces(r);
    this.jeton = r.corps.jeton;
    return r.corps.utilisateur;
  }

  async deconnecter() {
    if (this.jeton) {
      try {
        await this.appeler('POST', '/auth/deconnexion');
      } catch {
        /* le serveur peut être injoignable : la session expirera seule */
      }
    }
    this.jeton = undefined;
  }

  /** Appel authentifié (certificat de l'appareil + jeton de session). */
  async appeler<T = unknown>(methode: string, chemin: string, corps?: unknown): Promise<ReponseApi<T>> {
    if (!this.config || !this.cle) {
      throw new ErreurPoste('POSTE_NON_CONFIGURE', "Cet appareil n'est pas encore enregistré.");
    }
    const r = await requeteServeur<T>(this.config.serveur, methode, chemin, {
      corps,
      jeton: this.jeton,
      cle: this.cle,
      certificat: this.config.certificatPem,
      ca: this.config.caPem,
    });
    const code = (r.corps as { code?: string } | undefined)?.code;
    if (code === E.SESSION_EXPIREE || code === E.NON_CONNECTE) this.jeton = undefined;
    return { statut: r.statut, corps: r.corps };
  }

  private async appelBrut<T>(adresse: AdresseServeur, methode: string, chemin: string, options: { corps?: unknown }) {
    try {
      return await requeteServeur<T>(adresse, methode, chemin, options);
    } catch (e) {
      if (e instanceof ErreurReseau) throw new ErreurPoste('SERVEUR_INJOIGNABLE', e.message);
      throw e;
    }
  }

  private verifierSucces(r: ReponseApi<unknown>) {
    if (r.statut >= 200 && r.statut < 300) return;
    const corps = (r.corps ?? {}) as { code?: string; message?: string | string[] };
    const message = Array.isArray(corps.message) ? corps.message.join(' ; ') : corps.message;
    throw new ErreurPoste(corps.code ?? `HTTP_${r.statut}`, message ?? `Erreur du serveur (${r.statut})`);
  }
}
