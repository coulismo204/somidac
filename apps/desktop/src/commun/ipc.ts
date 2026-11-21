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

export type Resultat<T> = { ok: true; valeur: T } | { ok: false; code: string; message: string };

export interface ReponseApi<T = unknown> {
  statut: number;
  corps: T;
}

export interface ApiSomidac {
  poste: {
    etat(): Promise<Resultat<EtatPoste>>;
    etatServeurLocal(): Promise<Resultat<{ joignable: boolean; initialise: boolean }>>;
    adressesReseau(): Promise<Resultat<string[]>>;
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
}

export const CANAUX = {
  ETAT: 'poste:etat',
  SERVEUR_LOCAL: 'poste:serveur-local',
  ADRESSES: 'poste:adresses',
  INITIALISER: 'poste:initialiser',
  REENREGISTRER: 'poste:reenregistrer',
  ENREGISTRER: 'poste:enregistrer',
  OUBLIER: 'poste:oublier',
  CONNECTER: 'session:connecter',
  DECONNECTER: 'session:deconnecter',
  APPELER: 'api:appeler',
} as const;
