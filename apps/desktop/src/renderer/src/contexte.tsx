import { CODES_ERREUR as E, INACTIVITE_VERROUILLAGE_MIN } from '@somidac/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EtatPoste, Profil } from '../../commun/ipc';

export class ErreurApi extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statut = 0,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type Phase = 'chargement' | 'configuration' | 'revoque' | 'connexion' | 'application';

interface ContexteSession {
  phase: Phase;
  poste?: EtatPoste;
  profil?: Profil;
  verrouille: boolean;
  messageConnexion?: string;
  rafraichirPoste(): Promise<void>;
  connecter(identifiant: string, motDePasse: string): Promise<void>;
  deconnecter(message?: string): Promise<void>;
  verrouiller(): void;
  deverrouiller(motDePasse: string): Promise<void>;
  rechargerProfil(): Promise<void>;
  appeler<T>(methode: string, chemin: string, corps?: unknown): Promise<T>;
  peut(permission: string): boolean;
}

const Contexte = createContext<ContexteSession | null>(null);

export function useSession(): ContexteSession {
  const c = useContext(Contexte);
  if (!c) throw new Error('useSession hors de SessionProvider');
  return c;
}

function deballer<T>(r: { ok: true; valeur: T } | { ok: false; code: string; message: string }): T {
  if (!r.ok) throw new ErreurApi(r.code, r.message);
  return r.valeur;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('chargement');
  const [poste, setPoste] = useState<EtatPoste>();
  const [profil, setProfil] = useState<Profil>();
  const [verrouille, setVerrouille] = useState(false);
  const [messageConnexion, setMessageConnexion] = useState<string>();

  const rafraichirPoste = useCallback(async () => {
    const etat = deballer(await window.somidac.poste.etat());
    setPoste(etat);
    setPhase(etat.configure ? 'connexion' : 'configuration');
  }, []);

  useEffect(() => {
    void rafraichirPoste();
  }, [rafraichirPoste]);

  const quitterSession = useCallback((message?: string) => {
    setProfil(undefined);
    setVerrouille(false);
    setMessageConnexion(message);
    setPhase('connexion');
  }, []);

  /** Appel API avec traitement uniforme des erreurs de sécurité. */
  const appeler = useCallback(
    async <T,>(methode: string, chemin: string, corps?: unknown): Promise<T> => {
      const reponse = deballer(await window.somidac.api.appeler<T>(methode, chemin, corps));
      if (reponse.statut >= 200 && reponse.statut < 300) return reponse.corps;
      const err = (reponse.corps ?? {}) as { code?: string; message?: string | string[]; details?: unknown };
      const code = err.code ?? `HTTP_${reponse.statut}`;
      const message = Array.isArray(err.message) ? err.message.join(' ; ') : (err.message ?? 'Erreur du serveur');
      switch (code) {
        case E.SESSION_VERROUILLEE:
          setVerrouille(true);
          break;
        case E.SESSION_EXPIREE:
        case E.NON_CONNECTE:
          quitterSession(message);
          break;
        case E.APPAREIL_REVOQUE:
        case E.APPAREIL_NON_RECONNU:
          setProfil(undefined);
          setPhase('revoque');
          break;
        case E.CHANGEMENT_MOT_DE_PASSE_REQUIS:
          setProfil((p) => (p ? { ...p, doitChangerMotDePasse: true } : p));
          break;
      }
      throw new ErreurApi(code, message, reponse.statut, err.details);
    },
    [quitterSession],
  );

  const rechargerProfil = useCallback(async () => {
    setProfil(await appeler<Profil>('GET', '/auth/moi'));
  }, [appeler]);

  const connecter = useCallback(async (identifiant: string, motDePasse: string) => {
    const r = await window.somidac.session.connecter(identifiant, motDePasse);
    if (!r.ok && (r.code === E.APPAREIL_REVOQUE || r.code === E.APPAREIL_NON_RECONNU)) {
      setPhase('revoque');
    }
    const p = deballer(r);
    setProfil(p);
    setMessageConnexion(undefined);
    setVerrouille(false);
    setPhase('application');
  }, []);

  const deconnecter = useCallback(
    async (message?: string) => {
      await window.somidac.session.deconnecter();
      quitterSession(message);
    },
    [quitterSession],
  );

  /** Verrouille l'écran et la session côté serveur (même si le serveur est injoignable, l'écran reste verrouillé). */
  const verrouiller = useCallback(() => {
    setVerrouille(true);
    void window.somidac.api.appeler('POST', '/auth/verrouiller');
  }, []);

  const deverrouiller = useCallback(
    async (motDePasse: string) => {
      await appeler('POST', '/auth/deverrouiller', { motDePasse });
      setVerrouille(false);
    },
    [appeler],
  );

  // Verrouillage local après 15 minutes sans activité (le serveur l'impose aussi).
  const derniereActivite = useRef(Date.now());
  useEffect(() => {
    if (phase !== 'application') return;
    const marquer = () => (derniereActivite.current = Date.now());
    const evenements = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    evenements.forEach((e) => window.addEventListener(e, marquer, { passive: true }));
    const minuteur = window.setInterval(() => {
      if (Date.now() - derniereActivite.current > INACTIVITE_VERROUILLAGE_MIN * 60_000) verrouiller();
    }, 15_000);
    return () => {
      evenements.forEach((e) => window.removeEventListener(e, marquer));
      window.clearInterval(minuteur);
    };
  }, [phase, verrouiller]);

  const peut = useCallback((permission: string) => !!profil?.permissions.includes(permission), [profil]);

  const valeur = useMemo<ContexteSession>(
    () => ({
      phase,
      poste,
      profil,
      verrouille,
      messageConnexion,
      rafraichirPoste,
      connecter,
      deconnecter,
      verrouiller,
      deverrouiller,
      rechargerProfil,
      appeler,
      peut,
    }),
    [phase, poste, profil, verrouille, messageConnexion, rafraichirPoste, connecter, deconnecter, verrouiller, deverrouiller, rechargerProfil, appeler, peut],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** Message lisible pour une erreur quelconque. */
export function messageErreur(e: unknown): string {
  if (e instanceof ErreurApi) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur inattendue est survenue.';
}
