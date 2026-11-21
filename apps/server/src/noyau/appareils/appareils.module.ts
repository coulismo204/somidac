import { Module } from '@nestjs/common';
import { AppareilsController, EnrolementController } from './appareils.controller';
import { AppareilsService } from './appareils.service';

@Module({
  providers: [AppareilsService],
  controllers: [AppareilsController, EnrolementController],
  exports: [AppareilsService],
})
export class AppareilsModule {}
