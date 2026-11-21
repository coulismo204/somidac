import type { Request } from 'express';
import type { TLSSocket } from 'node:tls';

export interface AppareilConnecte {
  id: string;
  nom: string;
}

export interface UtilisateurConnecte {
  id: string;
  identifiant: string;
  nomComplet: string;
  permissions: Set<string>;
  plafondRemisePct: number;
  doitChangerMotDePasse: boolean;
}

export interface RequeteSomidac extends Request {
  appareil?: AppareilConnecte;
  utilisateur?: UtilisateurConnecte;
  sessionId?: string;
  socket: TLSSocket;
}

export function estLocale(req: Request): boolean {
  const adresse = req.socket.remoteAddress ?? '';
  return adresse === '127.0.0.1' || adresse === '::1' || adresse === '::ffff:127.0.0.1';
}
