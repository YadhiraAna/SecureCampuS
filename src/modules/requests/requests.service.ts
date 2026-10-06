import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestEntity, RequestStatus } from './entities/request.entity';
import { AuditService } from '@modules/audit/audit.service';
import { AuthenticatedUser } from '@shared/security/current-user.decorator';

/**
 * Workflow simple de solicitudes con historial inmutable (request_event,
 * ver script SQL). Cada transicion de estado se registra por separado del
 * `audit_log` general porque es el propio dominio del modulo (el alumno
 * necesita ver "su historial de solicitudes" sin ser Administrador).
 */
@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(RequestEntity) private readonly requests: Repository<RequestEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, type: string, description?: string) {
    const req = await this.requests.save(
      this.requests.create({ requesterId: user.id, type, description: description ?? null }),
    );

    await this.dataSource.query(
      `INSERT INTO request_event (request_id, from_status, to_status, actor_id, comment)
       VALUES ($1, NULL, 'CREATED', $2, 'Solicitud creada')`,
      [req.id, user.id],
    );

    await this.audit.log({
      actorId: user.id,
      actorRole: user.roles.join(','),
      action: 'REQUEST_CREATE',
      resourceType: 'request',
      resourceId: req.id,
      outcome: 'SUCCESS',
    });
    return req;
  }

  /** El solicitante solo ve SUS solicitudes; staff ve las que tiene asignadas. */
  async myRequests(user: AuthenticatedUser) {
    return this.requests.find({ where: { requesterId: user.id }, order: { createdAt: 'DESC' } });
  }

  /**
   * Historial completo de una solicitud (tabla append-only request_event).
   * Solo el solicitante original o un actor con rol distinto de STUDENT
   * (staff) pueden consultarlo — mismo criterio ABAC que `transition`.
   */
  async getHistory(actor: AuthenticatedUser, requestId: string) {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');

    const isOwner = req.requesterId === actor.id;
    const isStaff = actor.roles.some((r) => r !== 'STUDENT');
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('No autorizado para ver el historial de esta solicitud');
    }

    return this.dataSource.query(
      `SELECT from_status, to_status, actor_id, comment, at
       FROM request_event
       WHERE request_id = $1
       ORDER BY at ASC`,
      [requestId],
    );
  }

  async transition(actor: AuthenticatedUser, requestId: string, toStatus: RequestStatus, comment?: string) {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');

    if (req.requesterId === actor.id && !actor.roles.some((r) => r !== 'STUDENT')) {
      throw new ForbiddenException('No puedes cambiar el estado de tu propia solicitud');
    }

    const fromStatus = req.status;
    req.status = toStatus;
    await this.requests.save(req);

    await this.dataSource.query(
      `INSERT INTO request_event (request_id, from_status, to_status, actor_id, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, fromStatus, toStatus, actor.id, comment ?? null],
    );

    await this.audit.log({
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'REQUEST_TRANSITION',
      resourceType: 'request',
      resourceId: requestId,
      outcome: 'SUCCESS',
      before: { status: fromStatus },
      after: { status: toStatus, comment },
    });

    return req;
  }
}
