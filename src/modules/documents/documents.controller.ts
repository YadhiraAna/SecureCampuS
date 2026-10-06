import { Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/security/jwt-auth.guard';
import { PolicyGuard, CheckPolicy } from '@shared/security/policy.guard';
import { CurrentUser, AuthenticatedUser } from '@shared/security/current-user.decorator';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('documents')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Subir un documento propio (PDF, PNG o JPEG, maximo 10 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @CheckPolicy('document', 'upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(user, 'GENERIC', file.buffer, file.mimetype, file.originalname);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Listar mis propios documentos' })
  @CheckPolicy('document', 'read')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listMine(user);
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Obtener una URL de descarga de corta duracion para un documento' })
  @CheckPolicy('document', 'read')
  getDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documents.getDownloadUrl(user, id);
  }
}
