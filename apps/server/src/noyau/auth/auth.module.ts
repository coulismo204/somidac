import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';
import { SecuriteGuard } from './securite.guard';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  providers: [AuthService, SessionsService, PermissionsService, { provide: APP_GUARD, useClass: SecuriteGuard }],
  controllers: [AuthController],
  exports: [AuthService, SessionsService, PermissionsService],
})
export class AuthModule {}
