import { Module } from '@nestjs/common';
import { SauvegardesController } from './sauvegardes.controller';
import { SauvegardesService } from './sauvegardes.service';

@Module({ providers: [SauvegardesService], controllers: [SauvegardesController], exports: [SauvegardesService] })
export class SauvegardesModule {}
