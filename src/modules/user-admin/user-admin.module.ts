import { Module } from '@nestjs/common';
import { UserAdminService } from './user-admin.service';
import { UserAdminController } from './user-admin.controller';
import { AuditModule } from '@modules/audit/audit.module';
import { AccessControlModule } from '@modules/access-control/access-control.module';

@Module({
  imports: [AuditModule, AccessControlModule],
  controllers: [UserAdminController],
  providers: [UserAdminService],
})
export class UserAdminModule {}
