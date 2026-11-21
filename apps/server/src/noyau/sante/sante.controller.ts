import { Controller, Get, Inject } from '@nestjs/common';
import { Public, SansAppareil } from '../auth/decorateurs';
import { CONFIGURATION, Configuration } from '../../config/configuration';

/** Point de contrôle utilisé par les postes pour savoir si le serveur répond. */
@Controller('sante')
@Public()
@SansAppareil()
export class SanteController {
  constructor(@Inject(CONFIGURATION) private readonly config: Configuration) {}

  @Get()
  etat() {
    return { statut: 'ok', application: 'somidac-serveur', version: this.config.version, heureServeur: new Date() };
  }
}
