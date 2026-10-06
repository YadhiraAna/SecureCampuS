import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PolicyService } from '@shared/security/policy.service';
import { AuditService } from '@modules/audit/audit.service';

/**
 * Operaciones de gestion de roles y permisos, reservadas a ADMIN.
 * Estas son las "operaciones condicionadas" del administrador: requieren
 * reautenticacion reciente (step-up) y quedan auditadas con el detalle
 * de que cambio (before/after).
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async assignRole(
    actorId: string,
    targetUserId: string,
    roleName: string,
    scopeCareerId: string | null,
  ): Promise<void> {
    // Regla de separacion de funciones: un admin no puede auto-elevarse.
    if (actorId === targetUserId) {
      throw new BadRequestException('Un administrador no puede modificar sus propios roles');
    }

    const role = await this.dataSource.query(`SELECT id FROM role WHERE name = $1`, [roleName]);
    if (role.length === 0) {
      throw new NotFoundException(`El rol ${roleName} no existe`);
    }

    await this.dataSource.query(
      `INSERT INTO user_role (user_id, role_id, scope_career_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id)
       DO UPDATE SET scope_career_id = EXCLUDED.scope_career_id, valid_to = NULL`,
      [targetUserId, role[0].id, scopeCareerId],
    );

    await this.audit.log({
      actorId,
      actorRole: 'ADMIN',
      action: 'ROLE_ASSIGN',
      resourceType: 'user',
      resourceId: targetUserId,
      outcome: 'SUCCESS',
      after: { role: roleName, scopeCareerId },
    });
  }

  async revokeRole(actorId: string, targetUserId: string, roleName: string): Promise<void> {
    if (actorId === targetUserId) {
      throw new BadRequestException('Un administrador no puede modificar sus propios roles');
    }

    const role = await this.dataSource.query(`SELECT id FROM role WHERE name = $1`, [roleName]);
    if (role.length === 0) {
      throw new NotFoundException(`El rol ${roleName} no existe`);
    }

    // Se cierra la vigencia en vez de borrar la fila: conserva el
    // historial de quien tuvo que rol y cuando (igual criterio que
    // teaching_assignment.valid_to).
    await this.dataSource.query(
      `UPDATE user_role SET valid_to = now()
       WHERE user_id = $1 AND role_id = $2 AND (valid_to IS NULL OR valid_to > now())`,
      [targetUserId, role[0].id],
    );

    await this.audit.log({
      actorId,
      actorRole: 'ADMIN',
      action: 'ROLE_REVOKE',
      resourceType: 'user',
      resourceId: targetUserId,
      outcome: 'SUCCESS',
      before: { role: roleName },
    });
  }
}
