import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { AuditModule } from '@modules/audit/audit.module';
import { AccessControlModule } from '@modules/access-control/access-control.module';

@Module({
  imports: [AuditModule, AccessControlModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
