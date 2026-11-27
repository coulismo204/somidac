import { Module } from '@nestjs/common';
import { DecouverteService } from './decouverte.service';

@Module({ providers: [DecouverteService], exports: [DecouverteService] })
export class DecouverteModule {}
