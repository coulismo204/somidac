import { Module } from '@nestjs/common';
import { TresorerieModule } from '../tresorerie/tresorerie.module';
import { RapportsController, TableauDeBordController } from './rapports.controller';
import { RapportsService } from './rapports.service';
import { SyntheseService } from './synthese.service';
import { TableauDeBordService } from './tableau-de-bord.service';

/** Module « Rapports » (§5.7) et tableau de bord (§5.1). Lecture seule : aucun rapport ne modifie la base. */
@Module({ imports: [TresorerieModule], providers: [RapportsService, TableauDeBordService, SyntheseService], controllers: [RapportsController, TableauDeBordController] })
export class RapportsModule {}
