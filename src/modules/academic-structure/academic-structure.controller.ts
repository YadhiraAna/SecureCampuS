import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/security/jwt-auth.guard';
import { PolicyGuard, CheckPolicy } from '@shared/security/policy.guard';
import { CurrentUser, AuthenticatedUser } from '@shared/security/current-user.decorator';
import { AcademicStructureService } from './academic-structure.service';

@ApiTags('academic-structure')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, PolicyGuard)
export class AcademicStructureController {
  constructor(private readonly svc: AcademicStructureService) {}

  @Post('groups')
  @ApiOperation({ summary: 'Jefe de Carrera: crear un grupo dentro de su carrera' })
  @CheckPolicy('group', 'create')
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body('courseId') courseId: string,
    @Body('termId') termId: string,
    @Body('code') code: string,
    @Body('capacity') capacity: number,
  ) {
    return this.svc.createGroup(user, courseId, termId, code, capacity);
  }

  @Post('groups/assign-professor')
  @ApiOperation({ summary: 'Jefe de Carrera: asignar un profesor a un grupo' })
  @CheckPolicy('group', 'create')
  assignProfessor(
    @CurrentUser() user: AuthenticatedUser,
    @Body('groupId') groupId: string,
    @Body('professorId') professorId: string,
  ) {
    return this.svc.assignProfessor(user, groupId, professorId);
  }

  @Post('enrollments')
  @ApiOperation({ summary: 'Jefe de Carrera: inscribir un alumno a un grupo' })
  @CheckPolicy('enrollment', 'create')
  enroll(
    @CurrentUser() user: AuthenticatedUser,
    @Body('groupId') groupId: string,
    @Body('studentId') studentId: string,
  ) {
    return this.svc.enrollStudent(user, groupId, studentId);
  }

  @Post('professors/hire')
  @ApiOperation({ summary: 'Jefe de Carrera: dar de alta a un profesor dentro de su carrera' })
  @CheckPolicy('professor', 'create')
  hireProfessor(
    @CurrentUser() user: AuthenticatedUser,
    @Body('userId') userId: string,
    @Body('employeeCode') employeeCode: string,
  ) {
    return this.svc.hireProfessor(user, userId, employeeCode);
  }

  @Post('professors/:id/deactivate')
  @ApiOperation({ summary: 'Jefe de Carrera: dar de baja a un profesor de su carrera' })
  @CheckPolicy('professor', 'deactivate')
  deactivateProfessor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.svc.deactivateProfessor(user, id, reason);
  }

  @Get('me/groups')
  @ApiOperation({ summary: 'Profesor: listar mis grupos asignados vigentes' })
  @CheckPolicy('group', 'read')
  myGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.myGroups(user);
  }

  @Get('courses')
  @ApiOperation({ summary: 'Jefe de Carrera: catalogo de cursos de su carrera' })
  @CheckPolicy('course', 'read')
  listCourses(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listCourses(user);
  }

  @Get('terms')
  @ApiOperation({ summary: 'Catalogo de periodos disponibles' })
  @CheckPolicy('term', 'read')
  listTerms() {
    return this.svc.listTerms();
  }

  @Get('groups')
  @ApiOperation({ summary: 'Jefe de Carrera: listar los grupos de su carrera' })
  @CheckPolicy('group', 'read')
  listGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listGroups(user);
  }

  @Get('professors')
  @ApiOperation({ summary: 'Jefe de Carrera: listar profesores activos de su carrera' })
  @CheckPolicy('professor', 'read')
  listProfessors(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listProfessors(user);
  }

  @Get('students')
  @ApiOperation({ summary: 'Jefe de Carrera: listar estudiantes de su carrera' })
  @CheckPolicy('student', 'read')
  listStudents(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listStudents(user);
  }

  @Get('careers')
  @ApiOperation({ summary: 'Catalogo de carreras' })
  @CheckPolicy('career', 'read')
  listCareers() {
    return this.svc.listCareers();
  }

  @Get('groups/:id/roster')
  @ApiOperation({ summary: 'Profesor: lista autorizada (roster) de un grupo asignado' })
  @CheckPolicy('roster', 'read')
  roster(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getGroupRoster(user, id);
  }
}
