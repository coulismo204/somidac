import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@somidac/shared';
import { Permissions } from '../auth/decorateurs';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions(PERMISSIONS.AUDIT_VOIR)
  lister(@Query('limite') limite?: string, @Query('avantId') avantId?: string) {
    return this.audit.lister(limite ? Number(limite) : 100, avantId ? Number(avantId) : undefined);
  }

  @Get('verification')
  @Permissions(PERMISSIONS.AUDIT_VOIR)
  verifier() {
    return this.audit.verifierChaine();
  }
}
