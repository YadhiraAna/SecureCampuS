import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/security/jwt-auth.guard';
import { PolicyGuard, CheckPolicy } from '@shared/security/policy.guard';
import { CurrentUser, AuthenticatedUser } from '@shared/security/current-user.decorator';
import { UserAdminService } from './user-admin.service';

/**
 * Todas las rutas aqui son "operaciones condicionadas": exigen un header
 * x-step-up-token valido, emitido tras una reautenticacion reciente
 * (password + MFA) con vida muy corta (ej. 5 min). La validacion real del
 * token de step-up se hace en un guard dedicado (StepUpGuard, omitido
 * aqui por brevedad) que se añadiria junto a JwtAuthGuard/PolicyGuard.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class UserAdminController {
  constructor(private readonly admin: UserAdminService) {}

  @Post('users')
  @ApiOperation({ summary: 'Dar de alta una cuenta de usuario (sin rol todavia)' })
  @CheckPolicy('user', 'manage')
  createUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body('email') email: string,
    @Body('firstName') firstName: string,
    @Body('lastName') lastName: string,
    @Body('temporaryPassword') temporaryPassword: string,
    @Headers('x-step-up-token') stepUp?: string,
  ) {
    if (!stepUp) throw new BadRequestException('Esta operacion requiere reautenticacion (step-up)');
    return this.admin.createUser(user, email, firstName, lastName, temporaryPassword);
  }

  @Get('users')
  @ApiOperation({ summary: 'Listar usuarios y sus roles vigentes' })
  @CheckPolicy('user', 'manage')
  listUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.listUsers(user);
  }

  @Post('users/:id/deactivate')
  @ApiOperation({ summary: 'Desactivar un usuario (requiere step-up)' })
  @CheckPolicy('user', 'manage')
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Headers('x-step-up-token') stepUp?: string,
  ) {
    if (!stepUp) throw new BadRequestException('Esta operacion requiere reautenticacion (step-up)');
    return this.admin.deactivateUser(user, id, reason);
  }

  @Post('users/:id/roles')
  @ApiOperation({ summary: 'Asignar un rol a un usuario (requiere step-up)' })
  @CheckPolicy('role', 'manage')
  assignRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('roleName') roleName: string,
    @Body('scopeCareerId') scopeCareerId: string | null,
    @Headers('x-step-up-token') stepUp?: string,
  ) {
    if (!stepUp) throw new BadRequestException('Esta operacion requiere reautenticacion (step-up)');
    return this.admin.assignRole(user, id, roleName, scopeCareerId);
  }

  @Delete('users/:id/roles/:roleName')
  @ApiOperation({ summary: 'Revocar un rol de un usuario (requiere step-up)' })
  @CheckPolicy('role', 'manage')
  revokeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('roleName') roleName: string,
    @Headers('x-step-up-token') stepUp?: string,
  ) {
    if (!stepUp) throw new BadRequestException('Esta operacion requiere reautenticacion (step-up)');
    return this.admin.revokeRole(user, id, roleName);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Catalogo de roles disponibles' })
  @CheckPolicy('role', 'manage')
  listRoles() {
    return this.admin.listRoles();
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Leer el registro de auditoria (la lectura tambien queda auditada)' })
  @CheckPolicy('audit', 'read')
  auditLog(@CurrentUser() user: AuthenticatedUser) {
    return this.admin.readAuditLog(user);
  }
}
