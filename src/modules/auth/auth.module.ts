import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CredentialEntity } from './entities/credential.entity';
import { SessionEntity } from './entities/session.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuditModule } from '@modules/audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialEntity, SessionEntity]),
    JwtModule.register({
      global: true, // JwtService queda disponible en toda la app sin reimportar JwtModule
    }),
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService], // otros modulos pueden necesitar validar identidad
})
export class AuthModule {}
