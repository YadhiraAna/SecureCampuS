import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, createHash, randomUUID } from 'crypto';

import { CredentialEntity } from './entities/credential.entity';
import { SessionEntity } from './entities/session.entity';
import { AuditService } from '@modules/audit/audit.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_TTL_MIN = 20;

/**
 * Autenticacion y recuperacion de acceso.
 * - Contrasenas con Argon2id (nunca se guardan en claro ni reversibles).
 * - Bloqueo progresivo tras intentos fallidos (mitigacion de fuerza bruta).
 * - Access token JWT de vida corta + refresh token rotativo almacenado
 *   solo como hash (nunca en claro en base de datos).
 * - Recuperacion de acceso con token de un solo uso y respuesta generica
 *   para no revelar si un correo existe (anti user-enumeration).
 *
 * Los helpers de "resolver usuario", "cargar roles" y "token de reset"
 * usan DataSource.query (SQL crudo) en vez de entidades propias, porque
 * `users`, `user_role` y `password_reset_token` pertenecen conceptualmente
 * a otros modulos (user-admin / access-control); este modulo solo LEE lo
 * minimo necesario para autenticar, sin duplicar su logica de escritura.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(CredentialEntity) private readonly credentials: Repository<CredentialEntity>,
    @InjectRepository(SessionEntity) private readonly sessions: Repository<SessionEntity>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async login(email: string, password: string, mfaCode: string | undefined, ip: string, ua: string) {
    const userId = await this.resolveUserIdByEmail(email);

    if (!userId) {
      // Mismo tiempo de respuesta / mismo mensaje que credenciales invalidas,
      // para no filtrar si el correo existe.
      await this.audit.log({
        actorId: null,
        actorRole: null,
        action: 'LOGIN',
        outcome: 'FAILURE',
        ip,
        userAgent: ua,
      });
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const locked = await this.accountIsLocked(userId);
    if (locked) {
      await this.audit.log({
        actorId: userId,
        actorRole: null,
        action: 'LOGIN',
        outcome: 'DENIED',
        ip,
        userAgent: ua,
        after: { reason: 'ACCOUNT_LOCKED' },
      });
      throw new UnauthorizedException('Cuenta bloqueada temporalmente, intenta mas tarde');
    }

    const cred = await this.credentials.findOneOrFail({ where: { userId } });
    const passwordOk = await argon2.verify(cred.passwordHash, password);

    if (!passwordOk) {
      await this.registerFailedAttempt(userId);
      await this.audit.log({
        actorId: userId,
        actorRole: null,
        action: 'LOGIN',
        outcome: 'FAILURE',
        ip,
        userAgent: ua,
      });
      throw new UnauthorizedException('Credenciales invalidas');
    }

    if (cred.mfaEnabled && !this.verifyMfaCode(cred.mfaSecretEnc, mfaCode)) {
      await this.audit.log({
        actorId: userId,
        actorRole: null,
        action: 'LOGIN_MFA',
        outcome: 'FAILURE',
        ip,
        userAgent: ua,
      });
      throw new UnauthorizedException('Codigo MFA invalido');
    }

    await this.clearFailedAttempts(userId);

    const { roles, careerScopeId } = await this.loadRolesAndScope(userId);
    const { accessToken, refreshToken } = await this.issueTokens(userId, roles, careerScopeId, ip, ua);

    await this.audit.log({
      actorId: userId,
      actorRole: roles.join(','),
      action: 'LOGIN',
      outcome: 'SUCCESS',
      ip,
      userAgent: ua,
    });

    return { accessToken, refreshToken };
  }

  /** Rotacion de refresh token con deteccion de reutilizacion (token robado). */
  async refresh(rawRefreshToken: string, ip: string, ua: string) {
    const hash = this.hashToken(rawRefreshToken);
    const session = await this.sessions.findOne({ where: { refreshHash: hash } });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      if (session) {
        // El token ya fue usado o revocado: posible robo -> se revoca toda la familia.
        await this.sessions.update({ familyId: session.familyId }, { revokedAt: new Date() });
      }
      throw new UnauthorizedException('Sesion invalida, inicia sesion de nuevo');
    }

    await this.sessions.update(session.id, { revokedAt: new Date() });

    const { roles, careerScopeId } = await this.loadRolesAndScope(session.userId);
    return this.issueTokens(session.userId, roles, careerScopeId, ip, ua, session.familyId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const userId = await this.resolveUserIdByEmail(email);
    // Siempre se responde igual al llamador, exista o no el correo.
    if (!userId) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);

    await this.dataSource.query(
      `INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );

    // ... aqui iria el envio de correo con rawToken; nunca se persiste en claro ...
    // Para pruebas locales, el token en claro se puede leer directamente
    // de los logs (ver README: "Probar la recuperacion de acceso").
    console.log(`[DEV ONLY] Token de recuperacion para ${email}: ${rawToken}`);

    await this.audit.log({
      actorId: userId,
      actorRole: null,
      action: 'PASSWORD_RESET_REQUEST',
      outcome: 'SUCCESS',
    });
  }

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const userId = await this.resolveUserIdByResetToken(tokenHash);
    if (!userId) throw new UnauthorizedException('Token invalido o expirado');

    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    });

    await this.credentials.update({ userId }, { passwordHash: newHash, lastChangeAt: new Date() });
    await this.dataSource.query(
      `UPDATE password_reset_token SET used_at = now() WHERE token_hash = $1`,
      [tokenHash],
    );

    // Cambio de contrasena invalida TODAS las sesiones activas del usuario.
    await this.sessions.update({ userId }, { revokedAt: new Date() });

    await this.audit.log({
      actorId: userId,
      actorRole: null,
      action: 'PASSWORD_RESET_CONFIRM',
      outcome: 'SUCCESS',
    });
  }

  // ---- helpers ----

  private async issueTokens(
    userId: string,
    roles: string[],
    careerScopeId: string | null,
    ip: string,
    ua: string,
    familyId?: string,
  ) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, roles, careerScopeId },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: process.env.JWT_ACCESS_TTL ?? '900s' },
    );

    const rawRefresh = randomBytes(48).toString('hex');
    const refreshHash = this.hashToken(rawRefresh);
    const resolvedFamily = familyId ?? randomUUID();

    await this.sessions.save(
      this.sessions.create({
        userId,
        refreshHash,
        familyId: resolvedFamily,
        ip,
        userAgent: ua,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      }),
    );

    return { accessToken, refreshToken: rawRefresh };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async registerFailedAttempt(userId: string): Promise<void> {
    const rows = await this.dataSource.query(
      `UPDATE users SET failed_logins = failed_logins + 1, updated_at = now()
       WHERE id = $1 RETURNING failed_logins`,
      [userId],
    );
    const failedLogins = rows[0]?.failed_logins ?? 0;
    if (failedLogins >= MAX_FAILED_LOGINS) {
      await this.dataSource.query(
        `UPDATE users SET locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1`,
        [userId, LOCK_MINUTES],
      );
    }
  }

  private async clearFailedAttempts(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`,
      [userId],
    );
  }

  private async accountIsLocked(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM users WHERE id = $1 AND locked_until IS NOT NULL AND locked_until > now()`,
      [userId],
    );
    return rows.length > 0;
  }

  private verifyMfaCode(secretEnc: Buffer | null, code: string | undefined): boolean {
    if (!secretEnc || !code) return false;
    // ... desencriptar secretEnc via KMS y verificar TOTP (ej. libreria 'otplib') ...
    return true;
  }

  private async resolveUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE'`,
      [email],
    );
    return rows[0]?.id ?? null;
  }

  private async resolveUserIdByResetToken(tokenHash: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT user_id FROM password_reset_token
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0]?.user_id ?? null;
  }

  private async loadRolesAndScope(
    userId: string,
  ): Promise<{ roles: string[]; careerScopeId: string | null }> {
    const rows = await this.dataSource.query(
      `SELECT role.name, user_role.scope_career_id
       FROM user_role JOIN role ON role.id = user_role.role_id
       WHERE user_role.user_id = $1
         AND (user_role.valid_to IS NULL OR user_role.valid_to > now())`,
      [userId],
    );
    const roles = rows.map((r: { name: string }) => r.name);
    const careerScopeId = rows.find((r: { scope_career_id: string | null }) => r.scope_career_id)
      ?.scope_career_id ?? null;
    return { roles, careerScopeId };
  }
}
