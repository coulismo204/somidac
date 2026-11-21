import { Module } from '@nestjs/common';
import { RolesController, UtilisateursController } from './utilisateurs.controller';
import { UtilisateursService } from './utilisateurs.service';

@Module({
  providers: [UtilisateursService],
  controllers: [UtilisateursController, RolesController],
  exports: [UtilisateursService],
})
export class UtilisateursModule {}
