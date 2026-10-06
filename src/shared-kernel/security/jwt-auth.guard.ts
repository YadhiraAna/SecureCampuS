import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

/**
 * Valida el access token (JWT de vida corta) y adjunta el usuario al
 * request. No decide autorizacion (eso lo hace PolicyGuard); solo
 * responde: "quien eres".
 *
 * IMPORTANTE (invalidacion real de sesion): un JWT es stateless por
 * diseno, asi que verificar solo la firma NO basta para cumplir
 * "cuando el usuario es dado de baja o cambia su contrasena, su sesion
 * deja de ser valida". Sin este chequeo, un usuario desactivado o con
 * contrasena cambiada seguiria autorizado hasta que su token expirara
 * (hasta JWT_ACCESS_TTL, 15 min por defecto). Por eso aqui se hace UNA
 * consulta minima (por PK, indexada) para confirmar que la cuenta sigue
 * ACTIVE y que el token fue emitido DESPUES del ultimo cambio de
 * contrasena. El costo es una consulta extra por request; es el
 * trade-off correcto para un sistema donde la revocacion debe ser real,
 * no solo eventual.
 *
 * Los cambios de ROL (no de contrasena/estado) siguen acotados a la
 * ventana del access token (<=15 min): revocar un rol no invalida el
 * token de inmediato, solo evita que se renueve en el siguiente refresh.
 * Si se requiere invalidacion instantanea tambien para roles, se puede
 * extender el mismo mecanismo comparando un "roles_version" en vez de
 * (o ademas de) credential.last_change_at.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'] as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) throw new UnauthorizedException('Token no proporcionado');

    let payload: { sub: string; roles?: string[]; careerScopeId?: string | null; iat: number };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Tu sesión expiró o el token no es válido. Inicia sesión de nuevo.');
    }

    const rows = await this.dataSource.query(
      `SELECT u.status, c.last_change_at
       FROM users u
       LEFT JOIN credential c ON c.user_id = u.id
       WHERE u.id = $1`,
      [payload.sub],
    );
    const account = rows[0];

    if (!account || account.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tu cuenta ya no está activa. Contacta al administrador del sistema.');
    }

    const tokenIssuedAt = new Date(payload.iat * 1000);
    if (account.last_change_at && new Date(account.last_change_at) > tokenIssuedAt) {
      throw new UnauthorizedException('Tu contraseña fue actualizada. Inicia sesión de nuevo.');
    }

    request.user = {
      id: payload.sub,
      roles: payload.roles ?? [],
      careerScopeId: payload.careerScopeId ?? null,
    };
    return true;
  }
}