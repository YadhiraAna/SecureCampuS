# SecureCampus — Backend (NestJS)

Monolito modular con arquitectura hexagonal por módulo, RBAC+ABAC (Casbin),
auditoría append-only con hash encadenado, y calificaciones/documentos
versionados e inmutables.

## Vistas para probar el sistema

| Vista | URL | Para qué sirve |
|---|---|---|
| **Aplicación web** | `http://localhost:3000/app` | **La aplicación real**: login y panel de trabajo diario para cada actor (estudiante, profesor, jefe de carrera, administrador) |
| **Swagger UI** | `http://localhost:3000/api/docs` | Documentación interactiva de la API, para depuración o pruebas puntuales |
| **Adminer** | `http://localhost:8081` | Inspeccionar tablas y filas de PostgreSQL sin instalar nada |
| **MinIO Console** | `http://localhost:9001` | Ver el bucket de documentos subidos |

La aplicación web (`/app`) se sirve desde el **mismo servidor Nest** (sin
CORS, sin segundo proceso): es un frontend estático (HTML/CSS/JS sin
frameworks ni build step) en `frontend/`. El menú lateral se arma dinámicamente
según los roles del usuario autenticado — un usuario con un solo rol ve solo
lo que le corresponde; uno con varios roles ve todas las secciones
habilitadas. Ningún icono es un emoji: son SVG en línea, trazo simple.

### Qué puede hacer cada actor desde la aplicación web

| Actor | En el menú | Acciones |
|---|---|---|
| **Estudiante** | Mi perfil, Calificaciones, Documentos, Solicitudes | Ver/editar su perfil; ver calificaciones publicadas; subir y listar sus documentos; crear solicitudes y ver su historial |
| **Profesor** | Mi perfil, Mis grupos | Ver sus grupos asignados; abrir un grupo para ver la lista autorizada (roster) y capturar/publicar calificaciones |
| **Jefe de Carrera** | Mi perfil, Profesores, Grupos, Inscripciones | Dar de alta/baja profesores de su carrera; crear grupos y asignarles profesor; inscribir alumnos |
| **Administrador** | Mi perfil, Usuarios, Roles y permisos, Auditoría | Dar de alta usuarios; listar y desactivar cuentas; asignar/revocar roles; leer el log de auditoría |

Las acciones sensibles del Administrador (alta de usuario, desactivar
cuenta, asignar/revocar rol) piden una **reautenticación** en un modal
antes de ejecutarse — eso es la "operación condicionada" del análisis
original. El backend hoy solo exige que el valor llegue (no lo valida
criptográficamente todavía; ver sección de pendientes).

---

## Paso a paso para probar el sistema

### 1. Preparar el entorno

```bash
cp .env.example .env
docker compose up -d db redis minio adminer
npm install
```

### 2. Cargar el esquema y los datos de prueba

```bash
# Esquema (tablas, triggers, RLS, roles y permisos base)
docker compose exec -T db psql -U app_user -d securecampus < sql/01-schema.sql

# Datos de prueba: 1 carrera, 1 periodo con ventana de captura abierta,
# 1 materia, 1 grupo, y 4 usuarios (uno por actor)
docker compose exec -T db psql -U app_user -d securecampus < sql/02-seed-test-data.sql
```

Verifica en Adminer (`http://localhost:8081`, sistema PostgreSQL, servidor
`db`, usuario `app_user`, contraseña `change_me`, base `securecampus`) que
las tablas `users`, `course_group` y `enrollment` tengan datos.

### 3. Levantar la API

```bash
npm run start:dev
```

Abre `http://localhost:3000/api/docs`. Ahí verás los endpoints agrupados
por módulo: `auth`, `profiles`, `academic-structure`, `grades`, `documents`,
`requests`, `admin`.

### 4. Credenciales de prueba

Todas usan la misma contraseña: **`Test1234!`**

| Usuario | Rol | Correo |
|---|---|---|
| Administrador | ADMIN | `admin@securecampus.test` |
| Jefe de Carrera | CAREER_HEAD | `jefe.carrera@securecampus.test` |
| Profesor | PROFESSOR | `profesor@securecampus.test` |
| Estudiante | STUDENT | `estudiante@securecampus.test` |

El grupo de prueba ya tiene al profesor asignado y al estudiante inscrito:

```
groupId      = 44444444-4444-4444-4444-444444444444
enrollmentId = 66666666-6666-6666-6666-666666666666
```

### 5. Iniciar sesión y autorizar Swagger

1. En Swagger UI, expande **`POST /auth/login`** → **Try it out**.
2. Cuerpo:
   ```json
   { "email": "profesor@securecampus.test", "password": "Test1234!" }
   ```
3. Ejecuta. Copia el valor de `accessToken` de la respuesta.
4. Arriba a la derecha de Swagger UI, botón **Authorize** (icono de candado
   abierto/cerrado, no un emoji). Pega el token y confirma.
5. A partir de aquí, todas las peticiones que hagas desde Swagger incluyen
   el header `Authorization: Bearer <token>` automáticamente.

### 6. Probar el flujo crítico: captura → publicación → consulta

**Como profesor** (con el token obtenido en el paso 5):

1. `GET /me/groups` → confirma que aparece el grupo `44444444-...`.
2. `POST /groups/grades` → captura una calificación:
   ```json
   {
     "groupId": "44444444-4444-4444-4444-444444444444",
     "component": "PARCIAL1",
     "idempotencyKey": "prueba-001",
     "entries": [
       { "enrollmentId": "66666666-6666-6666-6666-666666666666", "value": 85 }
     ]
   }
   ```
3. `POST /groups/grades/publish`:
   ```json
   { "groupId": "44444444-4444-4444-4444-444444444444", "component": "PARCIAL1" }
   ```

**Como estudiante** (login con `estudiante@securecampus.test`, autoriza de
nuevo en Swagger con su token):

4. `GET /me/grades` → debe mostrar `PARCIAL1 = 85`. El estudiante **no**
   puede ver calificaciones en estado `SUBMITTED` sin publicar, ni las de
   otro alumno: la consulta filtra por `student_id` en el propio SQL, no
   en memoria.

### 7. Probar las restricciones de seguridad (lo interesante)

| Prueba | Cómo | Resultado esperado |
|---|---|---|
| Profesor sin asignación intenta capturar en otro grupo | `POST /groups/grades` con un `groupId` inventado | `403 Forbidden` |
| Estudiante intenta capturar calificaciones | Login como estudiante, llama `POST /groups/grades` | `403 Forbidden` (RBAC lo bloquea antes de llegar al service) |
| Capturar dos veces la misma `idempotencyKey` | Repetir el paso 6.2 exactamente igual | Error por restricción `UNIQUE` en `idempotency_key` |
| Rectificar sin motivo | `POST /grades/correct` sin el campo `reason` | `400 Bad Request` (DTO lo exige) |
| Revisar el rastro en auditoría | Login como admin, `GET /admin/audit-log` | Debe listar `LOGIN`, `GRADE_SUBMIT`, `GRADE_PUBLISH` con el `actor_id` correcto |
| Intentar leer auditoría sin ser admin | Llamar `/admin/audit-log` con el token del profesor | `403 Forbidden`, y ese intento denegado queda auditado también |
| 5 logins fallidos seguidos | `POST /auth/login` con contraseña incorrecta, 5 veces | Al sexto intento (aunque la contraseña sea correcta): `401` por cuenta bloqueada |

### 8. Probar recuperación de acceso

1. `POST /auth/password-reset/request` con cualquier correo (exista o no):
   la respuesta siempre es `202` con el mismo mensaje genérico.
2. Si el correo sí existe, el token en claro se imprime en la consola del
   servidor (`npm run start:dev`) con la marca `[DEV ONLY]` — en producción
   iría por correo, nunca se persiste en claro.
3. `POST /auth/password-reset/confirm` con ese token y una `newPassword`
   de al menos 12 caracteres.
4. El `refresh token` anterior queda revocado de inmediato: intenta
   `POST /auth/refresh` con el refresh de antes del cambio y debe fallar
   con `401`.

### 9. Verificar la cadena de hashes (integridad)

Desde Adminer, pestaña SQL, o por `psql`:

```sql
SELECT grade_id, version, value, status, prev_hash, row_hash
FROM grade_version
ORDER BY grade_id, version;
```

Cada `row_hash` depende del `prev_hash` de la fila anterior. Editar una
fila directamente ya está bloqueado por el trigger `trg_gv_immutable`; si
se hiciera de todos modos (ej. con permisos de superusuario), el hash
recalculado dejaría de coincidir — esa es la señal de manipulación que un
job de verificación periódica (pendiente de implementar) usaría.

---

## Estructura del proyecto

```
securecampus-backend/
├── Dockerfile
├── docker-compose.yml           # api, db (Postgres), redis, minio, adminer
├── sql/
│   ├── 01-schema.sql             # esquema completo (tablas, triggers, RLS, roles)
│   └── 02-seed-test-data.sql     # datos de prueba (ver paso 4)
│
└── src/
    ├── main.ts                   # bootstrap: helmet, validation pipe, CORS, Swagger
    ├── app.module.ts              # composition root: conecta todos los módulos
    │
    ├── shared-kernel/              # código transversal, sin reglas de negocio propias
    │   ├── domain/base.entity.ts
    │   ├── security/
    │   │   ├── jwt-auth.guard.ts     # "quién eres" (valida el JWT)
    │   │   ├── policy.guard.ts       # "qué puedes hacer" (RBAC vía Casbin)
    │   │   ├── policy.service.ts     # PolicyEnforcer, punto único de decisión
    │   │   ├── current-user.decorator.ts
    │   │   ├── roles.decorator.ts
    │   │   └── casbin/{model.conf,policy.csv}
    │   └── crypto/hash-chain.util.ts # hash encadenado (grade_version, audit_log)
    │
    └── modules/
        ├── auth/              # login, refresh, recuperación de contraseña, MFA
        ├── profiles/           # perfil propio de cada actor
        ├── academic-structure/ # carreras, grupos, teaching_assignment, enrollment
        ├── grades/             # captura, publicación, rectificación, consulta
        ├── documents/          # subida/descarga segura, versiones inmutables
        ├── requests/           # solicitudes con historial (workflow)
        ├── user-admin/         # alta/baja/roles, operaciones condicionadas (step-up)
        ├── access-control/     # PolicyService + gestión de roles
        └── audit/              # único punto de escritura de auditoría
```

## Regla de dependencias entre módulos

Cada módulo expone **solo** lo que pone en `exports` de su `*.module.ts`
(su "contrato público"). Nadie importa el repositorio interno de otro
módulo. `audit` y `access-control` son los únicos módulos transversales:
casi todos los demás los importan.

## Dónde está cada requisito de seguridad del análisis

| Requisito | Archivo |
|---|---|
| RBAC + ABAC | `shared-kernel/security/policy.*`, validaciones ABAC dentro de cada `*.service.ts` (ej. `professorIsAssignedToGroup` en `grades.service.ts`) |
| Calificaciones append-only + hash encadenado | `modules/grades/entities/grade-version.entity.ts`, `grades.service.ts` |
| Documentos cifrados, magic bytes, tamaño máx. | `modules/documents/documents.service.ts` |
| Auditoría append-only con cadena de hashes | `modules/audit/audit.service.ts` |
| Operaciones condicionadas (step-up) | `modules/user-admin/user-admin.controller.ts` (header `x-step-up-token`) |
| Recuperación de acceso sin enumeración de usuarios | `modules/auth/auth.service.ts` (`requestPasswordReset`) |
| Separación de funciones (admin no edita calificaciones, no se auto-eleva) | `access-control.service.ts`, `user-admin.service.ts` |
| Bloqueo por intentos fallidos | `auth.service.ts` (`registerFailedAttempt`, `accountIsLocked`) |

## Bugs reales corregidos en esta ronda (no solo features nuevas)

- **El build no copiaba la política de Casbin a `dist/`.** Nest CLI solo
  compila `.ts` por defecto; `model.conf` y `policy.csv` nunca llegaban a
  `dist/shared-kernel/security/casbin/`. Resultado: `PolicyService` habría
  fallado en la primera petición a cualquier endpoint protegido (que son
  todos excepto `/auth/*`). Corregido en `nest-cli.json` (`compilerOptions.assets`).
- **ADMIN no tenía permiso para ver su propio perfil.** `policy.csv` nunca
  le dio `profile:read-own` / `profile:update-own` a ese rol — un admin
  real habría recibido `403` en `GET /me/profile`. Corregido.

## Pendiente de implementar (marcado con comentarios `// ...` en el código)

- Integración real con KMS/Vault para cifrado de documentos y secreto MFA.
- `StepUpGuard` que valide criptográficamente el token de reautenticación
  (hoy el endpoint solo exige que el header `x-step-up-token` esté presente).
- Verificación TOTP real (librería `otplib`) en `verifyMfaCode`.
- Cliente de object storage (MinIO/S3) para subir/descargar el binario cifrado
  (hoy `documents.service.ts` calcula el hash y guarda metadatos, pero no
  sube el archivo a MinIO).
- Job periódico que recalcule y verifique la cadena de hashes de `audit_log`
  y `grade_version` (usa `verifyChain` de `hash-chain.util.ts`).
- Alta de usuarios y de profesores (`professor:create`) con flujo completo
  de invitación por correo.

Autenticación, carga de roles, bloqueo por intentos fallidos,
captura/publicación/rectificación de calificaciones, auditoría, estructura
académica y recuperación de acceso **sí están implementados contra la base
de datos real** (no son stubs) y se pueden probar de punta a punta
siguiendo la guía de arriba.
