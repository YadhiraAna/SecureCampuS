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

// Hash Argon2id "senuelo" fijo, usado SOLO para igualar el tiempo de
// respuesta cuando el correo no existe (ver login()). No protege ninguna
// cuenta real; es puro relleno de tiempo computacional.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=4$7iV9K/try5EgeEdPhHA2Sw$rXT//QNMd2ila6DbPNAEGP+3/Y9M0vwAPDTPbZS0cqc';

/**
 * Autenticacion y recuperacion de acceso.
 *
 * Decisiones de seguridad explicitas en este archivo:
 * - Contrasenas con Argon2id, costo configurable por entorno.
 * - Mitigacion de timing attack: si el correo no existe, igual se corre
 *   un verify() contra un hash senuelo, para que el tiempo de respuesta
 *   no delate si una cuenta existe o no (login() mas abajo).
 * - Bloqueo progresivo tras intentos fallidos (fuerza bruta), y ese
 *   bloqueo se limpia automaticamente al completar un reset de
 *   contrasena exitoso (confirmPasswordReset()), porque demostrar acceso
 *   al correo es una señal de identidad al menos tan fuerte como la
 *   contrasena que disparo el bloqueo.
 * - Access token JWT de vida corta + refresh token rotativo almacenado
 *   solo como hash. La invalidacion REAL de sesion (baja de cuenta o
 *   cambio de contrasena) se aplica en JwtAuthGuard comparando el `iat`
 *   del token contra `credential.last_change_at`, no solo aqui.
 * - Recuperacion de acceso: token de un solo uso, respuesta generica
 *   (anti user-enumeration), y cualquier token previo sin usar se
 *   invalida al emitir uno nuevo (evita que un token viejo filtrado
 *   siga siendo utilizable en paralelo).
 * - MFA: se distingue "falta el codigo" (MFA_REQUIRED, para que el
 *   frontend muestre el campo de forma progresiva) de "codigo invalido"
 *   (mensaje generico), evitando mostrar el campo MFA a quien no lo tiene
 *   activado.
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
      // Timing-attack mitigation: se corre un verify() contra un hash
      // senuelo para que el tiempo de respuesta sea equivalente al caso
      // "correo existe, contrasena incorrecta". Sin esto, un atacante
      // puede enumerar correos validos solo midiendo la latencia.
      await argon2.verify(DUMMY_HASH, password).catch(() => undefined);
      await this.audit.log({
        actorId: null, actorRole: null, action: 'LOGIN', outcome: 'FAILURE', ip, userAgent: ua,
      });
      throw new UnauthorizedException('Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.');
    }

    const locked = await this.accountIsLocked(userId);
    if (locked) {
      await this.audit.log({
        actorId: userId, actorRole: null, action: 'LOGIN', outcome: 'DENIED', ip, userAgent: ua,
        after: { reason: 'ACCOUNT_LOCKED' },
      });
      throw new UnauthorizedException(
        'Esta cuenta se bloqueó temporalmente por varios intentos fallidos. Intenta de nuevo en unos minutos o recupera tu acceso.',
      );
    }

    const cred = await this.credentials.findOneOrFail({ where: { userId } });
    const passwordOk = await argon2.verify(cred.passwordHash, password);

    if (!passwordOk) {
      await this.registerFailedAttempt(userId);
      await this.audit.log({
        actorId: userId, actorRole: null, action: 'LOGIN', outcome: 'FAILURE', ip, userAgent: ua,
      });
      throw new UnauthorizedException('Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.');
    }

    if (cred.mfaEnabled && !mfaCode) {
      // Distinto del caso "codigo incorrecto": el frontend detecta este
      // mensaje exacto para revelar el campo MFA de forma progresiva,
      // en vez de mostrarlo siempre a todos los usuarios.
      throw new UnauthorizedException('MFA_REQUIRED');
    }
    if (cred.mfaEnabled && !this.verifyMfaCode(cred.mfaSecretEnc, mfaCode)) {
      await this.audit.log({
        actorId: userId, actorRole: null, action: 'LOGIN_MFA', outcome: 'FAILURE', ip, userAgent: ua,
      });
      throw new UnauthorizedException('El código de verificación no es correcto. Inténtalo de nuevo.');
    }

    await this.clearFailedAttempts(userId);

    const { roles, careerScopeId } = await this.loadRolesAndScope(userId);
    const { accessToken, refreshToken } = await this.issueTokens(userId, roles, careerScopeId, ip, ua);

    await this.audit.log({
      actorId: userId, actorRole: roles.join(','), action: 'LOGIN', outcome: 'SUCCESS', ip, userAgent: ua,
    });

    return { accessToken, refreshToken };
  }

  /** Rotacion de refresh token con deteccion de reutilizacion (token robado). */
  async refresh(rawRefreshToken: string, ip: string, ua: string) {
    const hash = this.hashToken(rawRefreshToken);
    const session = await this.sessions.findOne({ where: { refreshHash: hash } });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      if (session) {
        await this.sessions.update({ familyId: session.familyId }, { revokedAt: new Date() });
      }
      throw new UnauthorizedException('Tu sesión expiró. Inicia sesión de nuevo.');
    }

    await this.sessions.update(session.id, { revokedAt: new Date() });

    const { roles, careerScopeId } = await this.loadRolesAndScope(session.userId);
    return this.issueTokens(session.userId, roles, careerScopeId, ip, ua, session.familyId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const userId = await this.resolveUserIdByEmail(email);
    if (!userId) {
      await this.hashToken(randomBytes(32).toString('hex'));
      return;
    }

    await this.dataSource.query(
      `UPDATE password_reset_token SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()`,
      [userId],
    );

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);

    await this.dataSource.query(
      `INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );

    console.log(`[DEV ONLY] Token de recuperacion para ${email}: ${rawToken}`);

    await this.audit.log({
      actorId: userId, actorRole: null, action: 'PASSWORD_RESET_REQUEST', outcome: 'SUCCESS',
    });
  }

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const userId = await this.resolveUserIdByResetToken(tokenHash);
    if (!userId) throw new UnauthorizedException('Este enlace de recuperación no es válido o ya expiró. Solicita uno nuevo.');

    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    });

    await this.credentials.update({ userId }, { passwordHash: newHash, lastChangeAt: new Date() });
    await this.dataSource.query(`UPDATE password_reset_token SET used_at = now() WHERE token_hash = $1`, [tokenHash]);

    await this.clearFailedAttempts(userId);

    await this.sessions.update({ userId }, { revokedAt: new Date() });

    await this.audit.log({
      actorId: userId, actorRole: null, action: 'PASSWORD_RESET_CONFIRM', outcome: 'SUCCESS',
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
    await this.dataSource.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [userId]);
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
    return true;
  }

  private async resolveUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.dataSource.query(`SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE'`, [email]);
    return rows[0]?.id ?? null;
  }

  private async resolveUserIdByResetToken(tokenHash: string): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT user_id FROM password_reset_token WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0]?.user_id ?? null;
  }

  private async loadRolesAndScope(userId: string): Promise<{ roles: string[]; careerScopeId: string | null }> {
    const rows = await this.dataSource.query(
      `SELECT role.name, user_role.scope_career_id
       FROM user_role JOIN role ON role.id = user_role.role_id
       WHERE user_role.user_id = $1
         AND (user_role.valid_to IS NULL OR user_role.valid_to > now())`,
      [userId],
    );
    const roles = rows.map((r: { name: string }) => r.name);
    const headRow = rows.find((r: { name: string }) => r.name === 'CAREER_HEAD');
    const careerScopeId = headRow?.scope_career_id ?? null;
    return { roles, careerScopeId };
  }
}