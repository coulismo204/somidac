import { Global, Module } from '@nestjs/common';
import { ParametresController } from './parametres.controller';
import { ParametresService } from './parametres.service';

@Global()
@Module({ providers: [ParametresService], controllers: [ParametresController], exports: [ParametresService] })
export class ParametresModule {}
