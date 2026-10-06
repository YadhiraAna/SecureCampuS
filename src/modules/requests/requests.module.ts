import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestEntity } from './entities/request.entity';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { AuditModule } from '@modules/audit/audit.module';
import { AccessControlModule } from '@modules/access-control/access-control.module';

@Module({
  imports: [TypeOrmModule.forFeature([RequestEntity]), AuditModule, AccessControlModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
