import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, Menu, safeStorage, session, shell } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CANAUX, EtatServeurLocal, Resultat } from '../commun/ipc';
import { rechercherPostesPrincipaux } from './poste/decouverte';
import { ErreurReseau } from './poste/https';
import { Chiffreur, ErreurPoste, Poste, PORT_SERVEUR_PAR_DEFAUT } from './poste/poste';

// Interface en français, y compris les champs de date (JJ/MM/AAAA).
app.commandLine.appendSwitch('lang', 'fr-FR');

const enDeveloppement = !app.isPackaged;
const urlDev = process.env.ELECTRON_RENDERER_URL;

/** Chiffrement de la clé par le système : DPAPI sous Windows (§10.1). */
const chiffreurSysteme: Chiffreur = {
  disponible: () => safeStorage.isEncryptionAvailable(),
  chiffrer: (texte) => safeStorage.encryptString(texte),
  dechiffrer: (donnees) => safeStorage.decryptString(donnees),
};

let poste: Poste;
let fenetre: BrowserWindow | undefined;

function adressesReseau(): string[] {
  const res: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) if (i.family === 'IPv4' && !i.internal) res.push(i.address);
  }
  return res;
}

/** État du service Windows « SOMIDAC Serveur » (lecture seule, sans droits administrateur). */
function etatServiceWindows(): EtatServeurLocal['service'] {
  if (process.platform !== 'win32') return 'inconnu';
  const r = spawnSync('sc.exe', ['query', 'SOMIDAC-Serveur'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (r.status === 1060) return 'absent';
  const sortie = r.stdout ?? '';
  if (/RUNNING/.test(sortie)) return 'demarre';
  if (/START_PENDING/.test(sortie)) return 'demarrage';
  if (/STOPPED|STOP_PENDING/.test(sortie)) return 'arrete';
  return 'inconnu';
}

async function diagnosticServeurLocal(): Promise<EtatServeurLocal> {
  const { joignable, initialise } = await poste.etatServeurLocal(PORT_SERVEUR_PAR_DEFAUT);
  const installeAvecServeur = !app.isPackaged || fs.existsSync(path.join(process.resourcesPath, 'service', 'SOMIDAC-Serveur.exe'));
  return { joignable, initialise, installeAvecServeur, service: etatServiceWindows(), journal: joignable ? undefined : finJournalServeur() };
}

/** Dernières lignes utiles du journal du serveur (lisible par les utilisateurs du PC, sans secret). */
function finJournalServeur(): string[] | undefined {
  if (process.platform !== 'win32') return undefined;
  const fichier = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'SOMIDAC', 'journaux', 'serveur.log');
  try {
    const lignes = fs.readFileSync(fichier, 'utf8').split(/\r?\n/).filter(Boolean);
    return lignes.slice(-12);
  } catch {
    return undefined;
  }
}

/**
 * Fait de ce PC le poste principal : démarre le service et ouvre le pare-feu au réseau privé.
 * Windows demande une fois l'autorisation administrateur (UAC). En développement, le serveur
 * est lancé à la main : rien à faire.
 */
function activerPostePrincipal(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') return Promise.resolve();
  const script = path.join(process.resourcesPath, 'service', 'activer-poste-principal.cmd');
  if (!fs.existsSync(script)) {
    return Promise.reject(new ErreurPoste('ACTIVATION_IMPOSSIBLE', "Le serveur SOMIDAC n'est pas installé sur ce PC."));
  }
  const commande = `Start-Process -FilePath "$env:ComSpec" -ArgumentList '/c', '"${script.replace(/'/g, "''")}"' -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', commande], { windowsHide: true });
    p.on('error', () => reject(new ErreurPoste('ACTIVATION_IMPOSSIBLE', "Impossible de demander l'autorisation administrateur.")));
    p.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new ErreurPoste(
              'ELEVATION_REFUSEE',
              "L'autorisation administrateur a été refusée : ce PC ne peut pas devenir le poste principal sans elle.",
            ),
          ),
    );
  });
}

/** Seuls nos propres écrans peuvent appeler le processus principal. */
function origineAutorisee(evenement: IpcMainInvokeEvent): boolean {
  const url = evenement.senderFrame?.url ?? '';
  if (urlDev && url.startsWith(urlDev)) return true;
  return url.startsWith('file://') && url.includes(path.join('renderer', 'index.html').replace(/\\/g, '/'));
}

function gerer<A extends unknown[], T>(canal: string, action: (...args: A) => Promise<T> | T) {
  ipcMain.handle(canal, async (evenement, ...args): Promise<Resultat<T>> => {
    if (!origineAutorisee(evenement)) return { ok: false, code: 'ORIGINE_REFUSEE', message: 'Appel refusé' };
    try {
      return { ok: true, valeur: await action(...(args as A)) };
    } catch (e) {
      if (e instanceof ErreurPoste) return { ok: false, code: e.code, message: e.message };
      if (e instanceof ErreurReseau) return { ok: false, code: 'SERVEUR_INJOIGNABLE', message: e.message };
      console.error(`[${canal}]`, e);
      return { ok: false, code: 'ERREUR_INTERNE', message: 'Une erreur inattendue est survenue.' };
    }
  });
}

function enregistrerCanaux() {
  gerer(CANAUX.ETAT, () => poste.etat());
  gerer(CANAUX.SERVEUR_LOCAL, () => diagnosticServeurLocal());
  gerer(CANAUX.ADRESSES, () => adressesReseau());
  gerer(CANAUX.RECHERCHER, () => rechercherPostesPrincipaux());
  gerer(CANAUX.ACTIVER_PRINCIPAL, () => activerPostePrincipal());
  gerer(CANAUX.INITIALISER, (donnees: Parameters<Poste['initialiserPostePrincipal']>[0]) =>
    poste.initialiserPostePrincipal({ ...donnees, port: PORT_SERVEUR_PAR_DEFAUT }),
  );
  gerer(CANAUX.REENREGISTRER, (donnees: { identifiant: string; motDePasse: string; nomPoste: string }) =>
    poste.reenregistrerPostePrincipal({ ...donnees, port: PORT_SERVEUR_PAR_DEFAUT }),
  );
  gerer(CANAUX.ENREGISTRER, (adresse: string, code: string) => poste.enregistrerPosteSecondaire(adresse, code));
  gerer(CANAUX.OUBLIER, () => poste.oublier());
  gerer(CANAUX.CONNECTER, (identifiant: string, motDePasse: string) => poste.connecter(identifiant, motDePasse));
  gerer(CANAUX.DECONNECTER, () => poste.deconnecter());
  gerer(CANAUX.APPELER, (methode: string, chemin: string, corps?: unknown) => {
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(methode) || !chemin.startsWith('/')) {
      throw new ErreurPoste('APPEL_INVALIDE', 'Appel invalide');
    }
    return poste.appeler(methode, chemin, corps);
  });
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'SOMIDAC',
    backgroundColor: '#f4f6fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  fenetre.once('ready-to-show', () => fenetre?.show());

  // Aucune navigation ni nouvelle fenêtre : les liens externes s'ouvrent dans le navigateur.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (!(urlDev && url.startsWith(urlDev))) e.preventDefault();
  });
  if (enDeveloppement) {
    fenetre.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') fenetre?.webContents.toggleDevTools();
    });
  }

  if (urlDev) void fenetre.loadURL(urlDev);
  else void fenetre.loadFile(path.join(__dirname, '../renderer/index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (fenetre?.isMinimized()) fenetre.restore();
    fenetre?.focus();
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Développement sous Linux sans trousseau : chiffrement de secours (jamais dans l'application installée,
    // qui tourne sous Windows avec DPAPI).
    if (enDeveloppement && process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
      safeStorage.setUsePlainTextEncryption(true);
    }
    // Aucune permission navigateur (caméra, micro, notifications...) n'est accordée.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, rappel) => rappel(false));

    poste = new Poste(app.getPath('userData'), chiffreurSysteme, {
      nomMachine: os.hostname(),
      systeme: `${os.type()} ${os.release()}`,
      versionApp: app.getVersion(),
    });
    enregistrerCanaux();
    creerFenetre();

    // Renouvellement automatique du certificat de l'appareil (§10.1).
    poste.renouvelerSiNecessaire().catch((e) => console.warn('Renouvellement du certificat reporté :', e.message));
  });

  app.on('window-all-closed', () => {
    void poste?.deconnecter().finally(() => app.quit());
  });
}
