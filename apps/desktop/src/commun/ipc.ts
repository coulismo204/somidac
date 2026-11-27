/**
 * Contrat entre les écrans (renderer) et le processus principal.
 * Les écrans n'ont accès ni à la clé de l'appareil ni au jeton de session.
 */
export interface AdresseServeur {
  hote: string;
  port: number;
}

export interface EtatPoste {
  configure: boolean;
  mode?: 'principal' | 'secondaire';
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

/** Poste principal trouvé sur le réseau local. */
export interface PostePrincipalTrouve {
  adresse: string;
  port: number;
  entreprise: string;
  initialise: boolean;
  nomMachine: string;
  version: string;
  local: boolean;
}

/** Diagnostic du serveur installé sur ce PC (poste principal). */
export interface EtatServeurLocal {
  joignable: boolean;
  initialise: boolean;
  /** Faux si l'application a été installée avec l'installateur des postes secondaires. */
  installeAvecServeur: boolean;
  /** État du service Windows « SOMIDAC Serveur ». */
  service: 'demarre' | 'demarrage' | 'arrete' | 'absent' | 'inconnu';
  /** Dernières lignes du journal du serveur (quand il ne répond pas). */
  journal?: string[];
}

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; code: string; message: string };

export interface ReponseApi<T = unknown> {
  statut: number;
  corps: T;
}

export interface ApiSomidac {
  poste: {
    etat(): Promise<Resultat<EtatPoste>>;
    etatServeurLocal(): Promise<Resultat<EtatServeurLocal>>;
    adressesReseau(): Promise<Resultat<string[]>>;
    /** Cherche le poste principal sur le réseau local. */
    rechercher(): Promise<Resultat<PostePrincipalTrouve[]>>;
    /** Fait de ce PC le poste principal (autorisation administrateur). */
    activerPrincipal(): Promise<Resultat<void>>;
    initialiserPrincipal(donnees: {
      raisonSociale?: string;
      gerant: { identifiant: string; nomComplet: string; motDePasse: string };
      nomPoste: string;
    }): Promise<Resultat<EtatPoste>>;
    reenregistrerPrincipal(donnees: { identifiant: string; motDePasse: string; nomPoste: string }): Promise<Resultat<EtatPoste>>;
    enregistrerSecondaire(adresse: string, code: string): Promise<Resultat<EtatPoste>>;
    oublier(): Promise<Resultat<void>>;
  };
  session: {
    connecter(identifiant: string, motDePasse: string): Promise<Resultat<Profil>>;
    deconnecter(): Promise<Resultat<void>>;
  };
  api: {
    appeler<T = unknown>(methode: string, chemin: string, corps?: unknown): Promise<Resultat<ReponseApi<T>>>;
  };
  /** Documents imprimés (§8) : la page affiche le document dans sa zone d'impression avant l'appel. */
  documents: {
    imprimer(): Promise<Resultat<void>>;
    /** Enregistre en PDF A4 ; renvoie le chemin du fichier, ou null si l'utilisateur annule. */
    enregistrerPdf(nomFichier: string): Promise<Resultat<string | null>>;
  };
}

export const CANAUX = {
  ETAT: 'poste:etat',
  SERVEUR_LOCAL: 'poste:serveur-local',
  ADRESSES: 'poste:adresses',
  INITIALISER: 'poste:initialiser',
  REENREGISTRER: 'poste:reenregistrer',
  RECHERCHER: 'poste:rechercher',
  ACTIVER_PRINCIPAL: 'poste:activer-principal',
  ENREGISTRER: 'poste:enregistrer',
  OUBLIER: 'poste:oublier',
  CONNECTER: 'session:connecter',
  DECONNECTER: 'session:deconnecter',
  APPELER: 'api:appeler',
  IMPRIMER: 'documents:imprimer',
  PDF: 'documents:pdf',
} as const;
