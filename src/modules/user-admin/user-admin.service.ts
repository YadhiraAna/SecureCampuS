import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AuditService } from '@modules/audit/audit.service';
import { AccessControlService } from '@modules/access-control/access-control.service';
import { AuthenticatedUser } from '@shared/security/current-user.decorator';

/**
 * Administracion de usuarios, reservada a ADMIN. Estas son las
 * "operaciones condicionadas": en el controller se exige un header
 * `x-step-up-token` (reautenticacion reciente / MFA) antes de llegar
 * aqui para cualquier metodo de este servicio.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Alta de una cuenta de usuario (sin rol todavia: los roles se asignan
   * por separado con `assignRole`, para mantener la separacion de
   * funciones explicita en el flujo de pruebas).
   */
  async createUser(
    actor: AuthenticatedUser,
    email: string,
    firstName: string,
    lastName: string,
    temporaryPassword: string,
  ) {
    const existing = await this.dataSource.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
    if (existing.length > 0) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }

    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    });

    const rows = await this.dataSource.query(
      `INSERT INTO users (email, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [email],
    );
    const userId = rows[0].id;

    await this.dataSource.query(
      `INSERT INTO person_profile (user_id, first_name, last_name) VALUES ($1, $2, $3)`,
      [userId, firstName, lastName],
    );
    await this.dataSource.query(
      `INSERT INTO credential (user_id, password_hash, last_change_at) VALUES ($1, $2, now())`,
      [userId, passwordHash],
    );

    await this.audit.log({
      actorId: actor.id,
      actorRole: 'ADMIN',
      action: 'USER_CREATE',
      resourceType: 'user',
      resourceId: userId,
      outcome: 'SUCCESS',
      after: { email },
    });

    return { userId, email };
  }

  /** Listado de usuarios con sus roles vigentes (vista administrativa). */
  async listUsers(actor: AuthenticatedUser) {
    const rows = await this.dataSource.query(
      `SELECT u.id, u.email, u.status, pp.first_name, pp.last_name,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN person_profile pp ON pp.user_id = u.id
       LEFT JOIN user_role ur ON ur.user_id = u.id
            AND (ur.valid_to IS NULL OR ur.valid_to > now())
       LEFT JOIN role r ON r.id = ur.role_id
       GROUP BY u.id, u.email, u.status, pp.first_name, pp.last_name
       ORDER BY u.email`,
    );

    await this.audit.log({
      actorId: actor.id,
      actorRole: 'ADMIN',
      action: 'USER_LIST',
      resourceType: 'user',
      outcome: 'SUCCESS',
    });

    return rows;
  }

  async deactivateUser(actor: AuthenticatedUser, targetUserId: string, reason: string) {
    if (actor.id === targetUserId) {
      throw new BadRequestException('Un administrador no puede desactivarse a si mismo');
    }

    await this.dataSource.query(`UPDATE users SET status = 'DISABLED', updated_at = now() WHERE id = $1`, [
      targetUserId,
    ]);
    // Cerrar todas las sesiones activas del usuario desactivado.
    await this.dataSource.query(`UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      targetUserId,
    ]);

    await this.audit.log({
      actorId: actor.id,
      actorRole: 'ADMIN',
      action: 'USER_DEACTIVATE',
      resourceType: 'user',
      resourceId: targetUserId,
      outcome: 'SUCCESS',
      after: { reason },
    });
  }

  async assignRole(actor: AuthenticatedUser, targetUserId: string, roleName: string, scopeCareerId: string | null) {
    return this.accessControl.assignRole(actor.id, targetUserId, roleName, scopeCareerId);
  }

  async revokeRole(actor: AuthenticatedUser, targetUserId: string, roleName: string) {
    return this.accessControl.revokeRole(actor.id, targetUserId, roleName);
  }

  /** Catalogo de roles disponibles (para el formulario de asignacion). */
  async listRoles() {
    return this.dataSource.query(`SELECT id, name FROM role ORDER BY name`);
  }

  /** Lectura de auditoria por el Administrador: la lectura misma tambien se audita. */
  async readAuditLog(actor: AuthenticatedUser) {
    await this.audit.log({
      actorId: actor.id,
      actorRole: 'ADMIN',
      action: 'AUDIT_LOG_READ',
      resourceType: 'audit',
      outcome: 'SUCCESS',
    });
    return this.audit.findRecent(200);
  }
}
