import { Body, Controller, Get, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/security/jwt-auth.guard';
import { PolicyGuard, CheckPolicy } from '@shared/security/policy.guard';
import { CurrentUser, AuthenticatedUser } from '@shared/security/current-user.decorator';
import { GradesService } from './grades.service';
import { SubmitGradesDto, CorrectGradeDto } from './dto/submit-grade.dto';

@ApiTags('grades')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, PolicyGuard)
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  /** Profesor: captura de calificaciones (Fase A del flujo critico). */
  @Post('groups/grades')
  @ApiOperation({ summary: 'Profesor: capturar calificaciones de un grupo (requiere asignacion vigente)' })
  @CheckPolicy('grade', 'write')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitGradesDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.grades.submit(user, dto, ip, ua);
  }

  /** Profesor o Jefe de Carrera: publicacion (Fase B). */
  @Post('groups/grades/publish')
  @ApiOperation({ summary: 'Publicar las calificaciones capturadas de un grupo/componente' })
  @CheckPolicy('grade', 'write')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Body('groupId') groupId: string,
    @Body('component') component: string,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.grades.publish(user, groupId, component, ip, ua);
  }

  /** Jefe de Carrera: rectificacion de una calificacion ya publicada. */
  @Post('grades/correct')
  @ApiOperation({ summary: 'Rectificar una calificacion ya publicada (exige motivo)' })
  @CheckPolicy('grade', 'write')
  correct(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CorrectGradeDto,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.grades.correct(user, dto, ip, ua);
  }

  /** Estudiante: consulta segura de SUS calificaciones (Fase C). */
  @Get('me/grades')
  @ApiOperation({ summary: 'Consultar mis calificaciones publicadas' })
  @CheckPolicy('grade', 'read')
  myGrades(@CurrentUser() user: AuthenticatedUser) {
    return this.grades.getMyGrades(user);
  }
}
