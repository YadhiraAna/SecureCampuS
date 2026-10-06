import { Body, Controller, Ip, Headers, Post, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RequestResetDto, ConfirmResetDto } from './dto/reset-password.dto';

/**
 * Endpoints publicos (no requieren JwtAuthGuard) pero con rate limiting
 * estricto para mitigar fuerza bruta y enumeracion de cuentas.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesion con correo, contrasena y, si aplica, codigo MFA' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.login(dto.email, dto.password, dto.mfaCode, ip, ua);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotar el access token usando un refresh token vigente' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  refresh(@Body('refreshToken') token: string, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.refresh(token, ip, ua);
  }

  @Post('password-reset/request')
  @ApiOperation({ summary: 'Solicitar un token de recuperacion de acceso (respuesta generica)' })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  async requestReset(@Body() dto: RequestResetDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Respuesta generica: nunca confirma si el correo existe.
    return { message: 'Si el correo existe, se enviaran instrucciones.' };
  }

  @Post('password-reset/confirm')
  @ApiOperation({ summary: 'Confirmar el restablecimiento de contrasena con el token recibido' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async confirmReset(@Body() dto: ConfirmResetDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { message: 'Contrasena actualizada. Todas las sesiones fueron cerradas.' };
  }
}
