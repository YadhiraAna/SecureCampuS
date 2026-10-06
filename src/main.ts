import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Tema sobrio para la documentacion interactiva: sin logo por defecto de
// Swagger, sin emojis, tipografia estandar del sistema y una paleta
// neutra. Se inyecta como CSS adicional sobre swagger-ui-express.
const SWAGGER_CUSTOM_CSS = `
  .swagger-ui .topbar { background-color: #0f172a; }
  .swagger-ui .topbar .download-url-wrapper { display: none; }
  .swagger-ui .info .title { font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
  .swagger-ui .scheme-container { box-shadow: none; border-bottom: 1px solid #e2e8f0; }
`;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Cabeceras de seguridad basicas. El CSP por defecto de Helmet bloquea
  // el script inline que usa swagger-ui-express para inicializarse, asi
  // que se desactiva aqui (frecuente en apps que sirven Swagger UI). En
  // produccion sin Swagger expuesto, se recomienda reactivarlo con una
  // politica explicita (nonce por request) para el frontend estatico.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Rechaza cualquier campo no declarado en los DTOs (defensa en profundidad)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false, credentials: true });

  // Frontend estatico (login + paneles por rol). Se sirve desde ESTE mismo
  // servidor bajo /app, para que las llamadas a la API sean same-origin
  // (sin configurar CORS para desarrollo local, sin segundo proceso).
  app.useStaticAssets(join(__dirname, '..', 'frontend'), { prefix: '/app' });

  // Documentacion interactiva (solo activa fuera de produccion, o si se
  // fuerza explicitamente con SWAGGER_ENABLED=true). Sirve como "vista"
  // para probar cada endpoint sin necesitar Postman.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('SecureCampus API')
      .setDescription(
        'API del sistema de gestion academica SecureCampus. Documentacion ' +
          'organizada por modulo de negocio (autenticacion, perfiles, ' +
          'estructura academica, calificaciones, documentos, solicitudes, ' +
          'administracion y auditoria).',
      )
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('auth', 'Autenticacion y recuperacion de acceso')
      .addTag('profiles', 'Perfil propio de cada actor')
      .addTag('academic-structure', 'Carreras, grupos, asignaciones e inscripciones')
      .addTag('grades', 'Captura, publicacion y consulta de calificaciones')
      .addTag('documents', 'Subida y descarga segura de documentos')
      .addTag('requests', 'Solicitudes e historial')
      .addTag('admin', 'Administracion de usuarios, roles y auditoria')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'SecureCampus - Documentacion de API',
      customCss: SWAGGER_CUSTOM_CSS,
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
      },
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
