import { Module } from '@nestjs/common';
import { AppareilsModule } from './appareils/appareils.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BaseModule } from './base/base.module';
import { InitialisationModule } from './initialisation/initialisation.module';
import { ParametresModule } from './parametres/parametres.module';
import { SanteController } from './sante/sante.controller';
import { SequencesModule } from './sequences/sequences.module';
import { UtilisateursModule } from './utilisateurs/utilisateurs.module';

/**
 * Noyau : ce que tous les modules métier partagent (cahier des charges §4) —
 * connexion et permissions, appareils, audit, numérotation, paramètres.
 */
@Module({
  imports: [
    BaseModule,
    AuditModule,
    ParametresModule,
    SequencesModule,
    AuthModule,
    AppareilsModule,
    UtilisateursModule,
    InitialisationModule,
  ],
  controllers: [SanteController],
})
export class NoyauModule {}
