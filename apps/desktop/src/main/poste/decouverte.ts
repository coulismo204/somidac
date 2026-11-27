import { MESSAGE_DECOUVERTE, PORT_DECOUVERTE, ReponseDecouverte } from '@somidac/shared';
import * as dgram from 'node:dgram';
import * as os from 'node:os';

export interface PostePrincipalTrouve extends ReponseDecouverte {
  /** Adresse IP par laquelle il a répondu. */
  adresse: string;
  /** Vrai si c'est ce PC lui-même. */
  local: boolean;
}

/** Adresses de diffusion de chaque réseau IPv4 de ce PC (Wi-Fi, câble). */
export function adressesDiffusion(): string[] {
  const res = new Set<string>(['255.255.255.255']);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const ip = i.address.split('.').map(Number);
      const masque = i.netmask.split('.').map(Number);
      res.add(ip.map((o, n) => (o & masque[n]) | (~masque[n] & 255)).join('.'));
    }
  }
  return [...res];
}

function adressesDeCePc(): Set<string> {
  const res = new Set(['127.0.0.1']);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const i of interfaces ?? []) if (i.family === 'IPv4') res.add(i.address);
  }
  return res;
}

/**
 * Cherche le poste principal sur le réseau local (§4) : un message est diffusé, chaque
 * serveur SOMIDAC répond. Rien n'est fait confiance ici : l'enregistrement vérifie ensuite
 * l'identité du serveur (preuve HMAC + certificat).
 */
export function rechercherPostesPrincipaux(options: { port?: number; delaiMs?: number } = {}): Promise<PostePrincipalTrouve[]> {
  const port = options.port ?? PORT_DECOUVERTE;
  const delaiMs = options.delaiMs ?? 2500;
  const locales = adressesDeCePc();
  return new Promise((resolve) => {
    const trouves = new Map<string, PostePrincipalTrouve>();
    const socket = dgram.createSocket('udp4');
    const terminer = () => {
      try {
        socket.close();
      } catch {
        /* déjà fermé */
      }
      resolve([...trouves.values()].sort((a, b) => Number(a.local) - Number(b.local) || a.adresse.localeCompare(b.adresse)));
    };
    socket.on('error', terminer);
    socket.on('message', (donnees, emetteur) => {
      try {
        const r = JSON.parse(donnees.toString('utf8')) as ReponseDecouverte;
        if (r.application !== 'somidac' || typeof r.port !== 'number') return;
        const local = locales.has(emetteur.address);
        // Un même serveur répond sur plusieurs adresses : on garde celle du réseau (pas 127.0.0.1).
        const cle = local ? 'local' : `${emetteur.address}:${r.port}`;
        if (local && trouves.has(cle) && emetteur.address === '127.0.0.1') return;
        trouves.set(cle, { ...r, adresse: emetteur.address, local });
      } catch {
        /* réponse illisible : ignorée */
      }
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const message = Buffer.from(MESSAGE_DECOUVERTE);
      for (const cible of [...adressesDiffusion(), '127.0.0.1']) {
        socket.send(message, port, cible, () => undefined);
      }
      setTimeout(terminer, delaiMs);
    });
  });
}
