import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CourseGroupEntity } from './entities/course-group.entity';
import { TeachingAssignmentEntity } from './entities/teaching-assignment.entity';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { AuditService } from '@modules/audit/audit.service';
import { AuthenticatedUser } from '@shared/security/current-user.decorator';

/**
 * Estructura academica: grupos, asignaciones profesor-grupo e inscripciones,
 * y alta/baja de profesores dentro de la carrera del Jefe de Carrera.
 * Estas tablas son la FUENTE DE VERDAD que usan GradesService y
 * DocumentsService para decidir "quien puede ver/capturar que" (ABAC).
 *
 * Alcance: solo inscripcion individual/manual (ver nota de alcance:
 * la inscripcion/reinscripcion MASIVA queda fuera de este sistema).
 */
@Injectable()
export class AcademicStructureService {
  constructor(
    @InjectRepository(CourseGroupEntity) private readonly groups: Repository<CourseGroupEntity>,
    @InjectRepository(TeachingAssignmentEntity) private readonly assignments: Repository<TeachingAssignmentEntity>,
    @InjectRepository(EnrollmentEntity) private readonly enrollments: Repository<EnrollmentEntity>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Jefe de Carrera: crea un grupo (ABAC: solo dentro de su propia carrera). */
  async createGroup(headUser: AuthenticatedUser, courseId: string, termId: string, code: string, capacity: number) {
    const courseInScope = await this.courseBelongsToHeadsCareer(courseId, headUser.careerScopeId);
    if (!courseInScope) {
      throw new ForbiddenException('El curso no pertenece a tu carrera asignada');
    }

    const group = await this.groups.save(
      this.groups.create({ courseId, termId, code, capacity, status: 'OPEN', createdBy: headUser.id }),
    );

    await this.audit.log({
      actorId: headUser.id,
      actorRole: 'CAREER_HEAD',
      action: 'GROUP_CREATE',
      resourceType: 'group',
      resourceId: group.id,
      outcome: 'SUCCESS',
      after: { courseId, termId, code, capacity },
    });

    return group;
  }

  /** Jefe de Carrera: asigna un profesor a un grupo. */
  async assignProfessor(headUser: AuthenticatedUser, groupId: string, professorId: string) {
    const assignment = await this.assignments.save(
      this.assignments.create({ groupId, professorId, validFrom: new Date(), validTo: null }),
    );
    await this.audit.log({
      actorId: headUser.id,
      actorRole: 'CAREER_HEAD',
      action: 'TEACHING_ASSIGNMENT_CREATE',
      resourceType: 'group',
      resourceId: groupId,
      outcome: 'SUCCESS',
      after: { professorId },
    });
    return assignment;
  }

  /** Jefe de Carrera: inscribe un alumno a un grupo (manual, no masivo). */
  async enrollStudent(headUser: AuthenticatedUser, groupId: string, studentId: string) {
    const group = await this.groups.findOneOrFail({ where: { id: groupId } });
    const currentCount = await this.enrollments.count({ where: { groupId, status: 'ACTIVE' } });
    if (currentCount >= group.capacity) {
      throw new ForbiddenException('El grupo alcanzo su capacidad maxima');
    }

    const enrollment = await this.enrollments.save(
      this.enrollments.create({ groupId, studentId, status: 'ACTIVE', enrolledBy: headUser.id }),
    );

    await this.audit.log({
      actorId: headUser.id,
      actorRole: 'CAREER_HEAD',
      action: 'ENROLLMENT_CREATE',
      resourceType: 'enrollment',
      resourceId: enrollment.id,
      outcome: 'SUCCESS',
      after: { groupId, studentId },
    });

    return enrollment;
  }

  /**
   * Jefe de Carrera: da de alta a un profesor dentro de SU carrera.
   * Requiere que `targetUserId` ya exista como usuario del sistema (el
   * alta de la CUENTA es responsabilidad de Administracion, por
   * separacion de funciones); aqui se crea el perfil profesoral y se
   * asigna el rol PROFESSOR.
   */
  async hireProfessor(headUser: AuthenticatedUser, targetUserId: string, employeeCode: string) {
    if (!headUser.careerScopeId) {
      throw new ForbiddenException('Tu cuenta no tiene una carrera asignada (scope ABAC)');
    }

    const userExists = await this.dataSource.query(
      `SELECT 1 FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [targetUserId],
    );
    if (userExists.length === 0) {
      throw new NotFoundException('El usuario no existe o no esta activo');
    }

    const alreadyProfessor = await this.dataSource.query(
      `SELECT 1 FROM professor_profile WHERE user_id = $1`,
      [targetUserId],
    );
    if (alreadyProfessor.length > 0) {
      throw new ForbiddenException('El usuario ya tiene un perfil de profesor');
    }

    await this.dataSource.query(
      `INSERT INTO professor_profile (user_id, employee_code, career_id, status, hired_by)
       VALUES ($1, $2, $3, 'ACTIVE', $4)`,
      [targetUserId, employeeCode, headUser.careerScopeId, headUser.id],
    );

    await this.dataSource.query(
      `INSERT INTO user_role (user_id, role_id, scope_career_id)
       SELECT $1, id, NULL FROM role WHERE name = 'PROFESSOR'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [targetUserId],
    );

    await this.audit.log({
      actorId: headUser.id,
      actorRole: 'CAREER_HEAD',
      action: 'PROFESSOR_HIRE',
      resourceType: 'professor',
      resourceId: targetUserId,
      outcome: 'SUCCESS',
      after: { employeeCode, careerId: headUser.careerScopeId },
    });

    return { userId: targetUserId, employeeCode, careerId: headUser.careerScopeId };
  }

  /** Jefe de Carrera: da de baja a un profesor de SU carrera (no borra la cuenta, la inactiva). */
  async deactivateProfessor(headUser: AuthenticatedUser, professorId: string, reason: string) {
    const professor = await this.dataSource.query(
      `SELECT career_id FROM professor_profile WHERE user_id = $1 AND status = 'ACTIVE'`,
      [professorId],
    );
    if (professor.length === 0) {
      throw new NotFoundException('Profesor no encontrado o ya inactivo');
    }
    if (professor[0].career_id !== headUser.careerScopeId) {
      throw new ForbiddenException('Este profesor no pertenece a tu carrera');
    }

    await this.dataSource.query(
      `UPDATE professor_profile
       SET status = 'INACTIVE', deactivated_by = $2, deactivated_at = now()
       WHERE user_id = $1`,
      [professorId, headUser.id],
    );

    // Cierra todas sus asignaciones vigentes: un profesor dado de baja
    // no puede seguir capturando calificaciones en ningun grupo.
    await this.dataSource.query(
      `UPDATE teaching_assignment SET valid_to = now()
       WHERE professor_id = $1 AND (valid_to IS NULL OR valid_to > now())`,
      [professorId],
    );

    await this.audit.log({
      actorId: headUser.id,
      actorRole: 'CAREER_HEAD',
      action: 'PROFESSOR_DEACTIVATE',
      resourceType: 'professor',
      resourceId: professorId,
      outcome: 'SUCCESS',
      after: { reason },
    });
  }

  /** Profesor: lista solo SUS grupos asignados vigentes (fuente de verdad ABAC). */
  async myGroups(professor: AuthenticatedUser) {
    return this.groups
      .createQueryBuilder('g')
      .innerJoin(
        TeachingAssignmentEntity,
        'ta',
        'ta.group_id = g.id AND ta.professor_id = :pid AND ta.valid_from <= now() AND (ta.valid_to IS NULL OR ta.valid_to > now())',
        { pid: professor.id },
      )
      .getMany();
  }

  /**
   * Profesor: "lista autorizada" (roster) del grupo — solo si tiene
   * asignacion vigente ahi. Es el mismo chequeo ABAC que usa GradesService
   * antes de permitir capturar calificaciones.
   */
  async getGroupRoster(professor: AuthenticatedUser, groupId: string) {
    const isAssigned = await this.dataSource.query(
      `SELECT 1 FROM teaching_assignment
       WHERE professor_id = $1 AND group_id = $2
         AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
      [professor.id, groupId],
    );
    if (isAssigned.length === 0) {
      throw new ForbiddenException('No tienes asignacion vigente en este grupo');
    }

    return this.dataSource.query(
      `SELECT e.id AS enrollment_id, e.student_id, sp.student_code,
              pp.first_name, pp.last_name, e.status, e.enrolled_at
       FROM enrollment e
       JOIN student_profile sp ON sp.user_id = e.student_id
       JOIN person_profile pp ON pp.user_id = e.student_id
       WHERE e.group_id = $1
       ORDER BY pp.last_name, pp.first_name`,
      [groupId],
    );
  }

  /** Jefe de Carrera: catalogo de cursos de SU carrera (para crear grupos). */
  async listCourses(headUser: AuthenticatedUser) {
    if (!headUser.careerScopeId) return [];
    return this.dataSource.query(
      `SELECT id, code, name FROM course WHERE career_id = $1 ORDER BY code`,
      [headUser.careerScopeId],
    );
  }

  /** Catalogo de periodos disponibles (para crear grupos). */
  async listTerms() {
    return this.dataSource.query(
      `SELECT id, name, starts_on, ends_on, grading_open_from, grading_open_to
       FROM term ORDER BY starts_on DESC`,
    );
  }

  /** Jefe de Carrera: grupos de SU carrera, con su profesor y ocupacion actuales. */
  async listGroups(headUser: AuthenticatedUser) {
    if (!headUser.careerScopeId) return [];
    return this.dataSource.query(
      `SELECT g.id, g.code, g.capacity, g.status,
              c.code AS course_code, c.name AS course_name,
              t.name AS term_name,
              pp.first_name AS professor_first_name, pp.last_name AS professor_last_name,
              (SELECT count(*) FROM enrollment e WHERE e.group_id = g.id AND e.status = 'ACTIVE') AS enrolled_count
       FROM course_group g
       JOIN course c ON c.id = g.course_id
       JOIN term t ON t.id = g.term_id
       LEFT JOIN teaching_assignment ta ON ta.group_id = g.id
            AND ta.valid_from <= now() AND (ta.valid_to IS NULL OR ta.valid_to > now())
       LEFT JOIN person_profile pp ON pp.user_id = ta.professor_id
       WHERE c.career_id = $1
       ORDER BY t.starts_on DESC, c.code, g.code`,
      [headUser.careerScopeId],
    );
  }

  /** Jefe de Carrera: profesores ACTIVOS de SU carrera (para asignarlos a un grupo). */
  async listProfessors(headUser: AuthenticatedUser) {
    if (!headUser.careerScopeId) return [];
    return this.dataSource.query(
      `SELECT pf.user_id, pf.employee_code, pp.first_name, pp.last_name
       FROM professor_profile pf
       JOIN person_profile pp ON pp.user_id = pf.user_id
       WHERE pf.career_id = $1 AND pf.status = 'ACTIVE'
       ORDER BY pp.last_name`,
      [headUser.careerScopeId],
    );
  }

  /** Jefe de Carrera: estudiantes de SU carrera (para inscribirlos a un grupo). */
  async listStudents(headUser: AuthenticatedUser) {
    if (!headUser.careerScopeId) return [];
    return this.dataSource.query(
      `SELECT sp.user_id, sp.student_code, pp.first_name, pp.last_name
       FROM student_profile sp
       JOIN person_profile pp ON pp.user_id = sp.user_id
       WHERE sp.career_id = $1 AND sp.status = 'ACTIVE'
       ORDER BY pp.last_name`,
      [headUser.careerScopeId],
    );
  }

  /** Catalogo de carreras (Jefe de Carrera y Administrador). */
  async listCareers() {
    return this.dataSource.query(`SELECT id, name FROM career ORDER BY name`);
  }

  private async courseBelongsToHeadsCareer(courseId: string, careerScopeId?: string | null): Promise<boolean> {
    if (!careerScopeId) return false;
    const rows = await this.dataSource.query(
      `SELECT 1 FROM course WHERE id = $1 AND career_id = $2`,
      [courseId, careerScopeId],
    );
    return rows.length > 0;
  }
}
