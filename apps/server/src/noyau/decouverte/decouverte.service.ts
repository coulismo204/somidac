import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { MESSAGE_DECOUVERTE, ReponseDecouverte } from '@somidac/shared';
import * as dgram from 'node:dgram';
import * as os from 'node:os';
import { CONFIGURATION, Configuration } from '../../config/configuration';
import { ParametresService } from '../parametres/parametres.service';

/** Adresses du réseau local (privées, lien local, boucle) : les seules auxquelles on répond. */
export function adresseLocale(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  return (
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^169\.254\./.test(v4) ||
    /^127\./.test(v4)
  );
}

/**
 * Découverte (cahier des charges §4) : les postes cherchent le poste principal sur le Wi-Fi
 * en envoyant un message UDP ; le serveur répond avec son nom et son port.
 * La réponse ne contient rien de secret, et la confiance ne repose jamais sur elle :
 * l'enregistrement vérifie ensuite l'identité du serveur (preuve HMAC + certificat).
 */
@Injectable()
export class DecouverteService implements OnModuleInit, OnApplicationShutdown {
  private readonly journal = new Logger('Découverte');
  private socket?: dgram.Socket;

  constructor(
    @Inject(CONFIGURATION) private readonly config: Configuration,
    private readonly parametres: ParametresService,
    private readonly http: HttpAdapterHost,
  ) {}

  /** Port HTTPS réellement ouvert (celui de la configuration, ou celui attribué par le système). */
  private portHttps(): number {
    const adresse = this.http.httpAdapter?.getHttpServer()?.address() as AddressInfo | null;
    return adresse?.port ?? this.config.port;
  }

  /** Port réellement utilisé (utile quand 0 est demandé dans les tests). */
  get port(): number | undefined {
    try {
      return this.socket?.address().port;
    } catch {
      return undefined;
    }
  }

  async onModuleInit() {
    if (this.config.portDecouverte < 0) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, emetteur) => void this.repondre(message, emetteur));
    socket.on('error', (e) => this.journal.warn(`Découverte indisponible : ${e.message}`));
    await new Promise<void>((ok) => socket.bind(this.config.portDecouverte, '0.0.0.0', () => ok()));
    this.socket = socket;
  }

  onApplicationShutdown() {
    this.socket?.close();
  }

  private async repondre(message: Buffer, emetteur: dgram.RemoteInfo) {
    if (message.length > 64 || message.toString('utf8').trim() !== MESSAGE_DECOUVERTE) return;
    if (!adresseLocale(emetteur.address)) return;
    const p = await this.parametres.lire().catch(() => undefined);
    const reponse: ReponseDecouverte = {
      application: 'somidac',
      version: this.config.version,
      port: this.portHttps(),
      entreprise: p?.raisonSociale ?? 'SOMIDAC',
      initialise: p?.initialise ?? false,
      nomMachine: os.hostname(),
    };
    this.socket?.send(Buffer.from(JSON.stringify(reponse)), emetteur.port, emetteur.address);
  }
}
