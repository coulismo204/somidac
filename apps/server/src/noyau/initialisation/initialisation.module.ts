import { Module } from '@nestjs/common';
import { AppareilsModule } from '../appareils/appareils.module';
import { UtilisateursModule } from '../utilisateurs/utilisateurs.module';
import { InitialisationController } from './initialisation.controller';

@Module({ imports: [AppareilsModule, UtilisateursModule], controllers: [InitialisationController] })
export class InitialisationModule {}
