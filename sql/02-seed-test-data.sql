-- =====================================================
-- SEED DE DATOS DE PRUEBA — SecureCampus
-- Ejecutar DESPUES del script de esquema (01-schema.sql).
-- Contrasena de los 4 usuarios de prueba: Test1234!
-- (hash Argon2id generado con los parametros de .env.example)
-- =====================================================

-- ---- Carrera ----
INSERT INTO career (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ingenieria en Sistemas');

-- ---- Usuarios base ----
INSERT INTO users (id, email, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@securecampus.test',      'ACTIVE'),
  ('a0000000-0000-0000-0000-000000000002', 'jefe.carrera@securecampus.test','ACTIVE'),
  ('a0000000-0000-0000-0000-000000000003', 'profesor@securecampus.test',   'ACTIVE'),
  ('a0000000-0000-0000-0000-000000000004', 'estudiante@securecampus.test', 'ACTIVE');

-- Vincular Jefe de Carrera a la carrera
UPDATE career SET head_user_id = 'a0000000-0000-0000-0000-000000000002'
WHERE id = '11111111-1111-1111-1111-111111111111';

-- ---- Credenciales (misma contrasena para los 4: Test1234!) ----
INSERT INTO credential (user_id, password_hash, mfa_enabled, last_change_at) VALUES
  ('a0000000-0000-0000-0000-000000000001',
   '$argon2id$v=19$m=19456,t=2,p=4$jxag4DRk5IZq55oz3C+CMg$qxyn+VBGzz0flHLsgxAl766aQTEvsfXftTGIufO6MZg',
   false, now()),
  ('a0000000-0000-0000-0000-000000000002',
   '$argon2id$v=19$m=19456,t=2,p=4$jxag4DRk5IZq55oz3C+CMg$qxyn+VBGzz0flHLsgxAl766aQTEvsfXftTGIufO6MZg',
   false, now()),
  ('a0000000-0000-0000-0000-000000000003',
   '$argon2id$v=19$m=19456,t=2,p=4$jxag4DRk5IZq55oz3C+CMg$qxyn+VBGzz0flHLsgxAl766aQTEvsfXftTGIufO6MZg',
   false, now()),
  ('a0000000-0000-0000-0000-000000000004',
   '$argon2id$v=19$m=19456,t=2,p=4$jxag4DRk5IZq55oz3C+CMg$qxyn+VBGzz0flHLsgxAl766aQTEvsfXftTGIufO6MZg',
   false, now());

-- ---- Perfiles ----
INSERT INTO person_profile (user_id, first_name, last_name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Ana',    'Administradora'),
  ('a0000000-0000-0000-0000-000000000002', 'Carlos', 'Jefe de Carrera'),
  ('a0000000-0000-0000-0000-000000000003', 'Laura',  'Profesora'),
  ('a0000000-0000-0000-0000-000000000004', 'Diego',  'Estudiante');

INSERT INTO staff_profile (user_id, staff_code, position) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ADM-001', 'Administrador de sistema');

INSERT INTO professor_profile (user_id, employee_code, career_id, status) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'PROF-001', '11111111-1111-1111-1111-111111111111', 'ACTIVE');

INSERT INTO student_profile (user_id, student_code, career_id, status) VALUES
  ('a0000000-0000-0000-0000-000000000004', 'EST-001', '11111111-1111-1111-1111-111111111111', 'ACTIVE');

-- ---- Roles (role/permission/role_permission ya vienen del script de esquema) ----
INSERT INTO user_role (user_id, role_id, scope_career_id)
SELECT 'a0000000-0000-0000-0000-000000000001', id, NULL FROM role WHERE name = 'ADMIN';
INSERT INTO user_role (user_id, role_id, scope_career_id)
SELECT 'a0000000-0000-0000-0000-000000000002', id, '11111111-1111-1111-1111-111111111111' FROM role WHERE name = 'CAREER_HEAD';
INSERT INTO user_role (user_id, role_id, scope_career_id)
SELECT 'a0000000-0000-0000-0000-000000000003', id, NULL FROM role WHERE name = 'PROFESSOR';
INSERT INTO user_role (user_id, role_id, scope_career_id)
SELECT 'a0000000-0000-0000-0000-000000000004', id, NULL FROM role WHERE name = 'STUDENT';

-- ---- Periodo con ventana de captura abierta AHORA ----
INSERT INTO term (id, name, starts_on, ends_on, grading_open_from, grading_open_to) VALUES
  ('22222222-2222-2222-2222-222222222222', '2026-2',
   '2026-08-01', '2026-12-15',
   now() - interval '1 day', now() + interval '30 day');

-- ---- Materia, grupo, asignacion e inscripcion ----
INSERT INTO course (id, career_id, code, name) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'ISW-301', 'Ingenieria de Software');

INSERT INTO course_group (id, course_id, term_id, code, capacity, status, created_by) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'A', 30, 'OPEN',
   'a0000000-0000-0000-0000-000000000002');

INSERT INTO teaching_assignment (id, group_id, professor_id, valid_from) VALUES
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
   'a0000000-0000-0000-0000-000000000003', now());

INSERT INTO enrollment (id, group_id, student_id, status, enrolled_by) VALUES
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
   'a0000000-0000-0000-0000-000000000004', 'ACTIVE',
   'a0000000-0000-0000-0000-000000000002');

-- =====================================================
-- Resumen de credenciales para pruebas manuales
-- =====================================================
-- admin@securecampus.test       / Test1234!  -> rol ADMIN
-- jefe.carrera@securecampus.test / Test1234! -> rol CAREER_HEAD (carrera 111...111)
-- profesor@securecampus.test    / Test1234!  -> rol PROFESSOR (asignado al grupo 444...444)
-- estudiante@securecampus.test  / Test1234!  -> rol STUDENT (inscrito en el grupo 444...444)
--
-- IDs utiles para las pruebas:
--   groupId      = 44444444-4444-4444-4444-444444444444
--   enrollmentId = 66666666-6666-6666-6666-666666666666
