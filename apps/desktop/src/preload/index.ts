import { contextBridge, ipcRenderer } from 'electron';
import { ApiSomidac, CANAUX } from '../commun/ipc';

const api: ApiSomidac = {
  poste: {
    etat: () => ipcRenderer.invoke(CANAUX.ETAT),
    etatServeurLocal: () => ipcRenderer.invoke(CANAUX.SERVEUR_LOCAL),
    adressesReseau: () => ipcRenderer.invoke(CANAUX.ADRESSES),
    rechercher: () => ipcRenderer.invoke(CANAUX.RECHERCHER),
    activerPrincipal: () => ipcRenderer.invoke(CANAUX.ACTIVER_PRINCIPAL),
    initialiserPrincipal: (donnees) => ipcRenderer.invoke(CANAUX.INITIALISER, donnees),
    reenregistrerPrincipal: (donnees) => ipcRenderer.invoke(CANAUX.REENREGISTRER, donnees),
    enregistrerSecondaire: (adresse, code) => ipcRenderer.invoke(CANAUX.ENREGISTRER, adresse, code),
    oublier: () => ipcRenderer.invoke(CANAUX.OUBLIER),
  },
  session: {
    connecter: (identifiant, motDePasse) => ipcRenderer.invoke(CANAUX.CONNECTER, identifiant, motDePasse),
    deconnecter: () => ipcRenderer.invoke(CANAUX.DECONNECTER),
  },
  api: {
    appeler: (methode, chemin, corps) => ipcRenderer.invoke(CANAUX.APPELER, methode, chemin, corps),
  },
  documents: {
    imprimer: () => ipcRenderer.invoke(CANAUX.IMPRIMER),
    enregistrerPdf: (nomFichier) => ipcRenderer.invoke(CANAUX.PDF, nomFichier),
  },
};

contextBridge.exposeInMainWorld('somidac', api);
