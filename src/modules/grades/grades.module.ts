import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradeEntity } from './entities/grade.entity';
import { GradeVersionEntity } from './entities/grade-version.entity';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';
import { AuditModule } from '@modules/audit/audit.module';
import { AccessControlModule } from '@modules/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GradeEntity, GradeVersionEntity]),
    AuditModule,
    AccessControlModule,
  ],
  controllers: [GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
