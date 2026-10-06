-- =====================================================
-- SecureCampus — Esquema de base de datos (PostgreSQL 14+)
-- Ejecutar una sola vez para crear el esquema completo.
-- =====================================================

-- =====================================================
-- 0. EXTENSIONES Y UTILIDADES
-- =====================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION fn_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only: % no permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 1. IDENTIDAD Y ACCESO
-- =====================================================
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','LOCKED','DISABLED')),
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credential (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash  TEXT NOT NULL,
  mfa_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc BYTEA,
  last_change_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  family_id    UUID NOT NULL,
  ip           INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX idx_session_user ON session(user_id);

CREATE TABLE password_reset_token (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role (
  id   SMALLSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE permission (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE role_permission (
  role_id       SMALLINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- =====================================================
-- 2. ESTRUCTURA ACADEMICA
-- =====================================================
CREATE TABLE career (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  head_user_id UUID REFERENCES users(id)
);

CREATE TABLE user_role (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id         SMALLINT NOT NULL REFERENCES role(id),
  scope_career_id UUID REFERENCES career(id),
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);

-- =====================================================
-- 3. PERFILES
-- =====================================================
CREATE TABLE person_profile (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  phone      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE student_profile (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  student_code TEXT NOT NULL UNIQUE,
  career_id    UUID NOT NULL REFERENCES career(id),
  status       TEXT NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE','INACTIVE','GRADUATED'))
);

CREATE TABLE professor_profile (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  employee_code TEXT NOT NULL UNIQUE,
  career_id     UUID REFERENCES career(id),
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','INACTIVE')),
  hired_by      UUID REFERENCES users(id),
  deactivated_by UUID REFERENCES users(id),
  deactivated_at TIMESTAMPTZ
);

CREATE TABLE staff_profile (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  staff_code TEXT UNIQUE,
  position   TEXT
);

CREATE INDEX idx_student_career ON student_profile(career_id);

-- =====================================================
-- 4. GRUPOS, PERIODOS E INSCRIPCIONES
-- =====================================================
CREATE TABLE term (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  grading_open_from TIMESTAMPTZ NOT NULL,
  grading_open_to   TIMESTAMPTZ NOT NULL,
  CHECK (ends_on > starts_on),
  CHECK (grading_open_to > grading_open_from)
);

CREATE TABLE course (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  career_id UUID NOT NULL REFERENCES career(id),
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  UNIQUE (career_id, code)
);

CREATE TABLE course_group (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES course(id),
  term_id    UUID NOT NULL REFERENCES term(id),
  code       TEXT NOT NULL,
  capacity   INT NOT NULL CHECK (capacity > 0),
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, term_id, code)
);

CREATE TABLE teaching_assignment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES course_group(id),
  professor_id UUID NOT NULL REFERENCES professor_profile(user_id),
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to     TIMESTAMPTZ,
  UNIQUE (group_id, professor_id, valid_from)
);
CREATE INDEX idx_ta_professor ON teaching_assignment(professor_id);

CREATE TABLE enrollment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES course_group(id),
  student_id  UUID NOT NULL REFERENCES student_profile(user_id),
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','DROPPED')),
  enrolled_by UUID NOT NULL REFERENCES users(id),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_id)
);
CREATE INDEX idx_enroll_student ON enrollment(student_id);

-- =====================================================
-- 5. CALIFICACIONES (append-only, versionadas, hash encadenado)
-- =====================================================
CREATE TABLE grade (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES enrollment(id),
  component     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, component)
);

CREATE TABLE grade_version (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id      UUID NOT NULL REFERENCES grade(id),
  version       INT NOT NULL CHECK (version >= 1),
  value         NUMERIC(5,2) NOT NULL CHECK (value >= 0 AND value <= 100),
  status        TEXT NOT NULL
                CHECK (status IN ('DRAFT','SUBMITTED','PUBLISHED','CORRECTED')),
  entered_by    UUID NOT NULL REFERENCES users(id),
  approved_by   UUID REFERENCES users(id),
  reason        TEXT,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_id UUID REFERENCES grade_version(id),
  idempotency_key TEXT,
  prev_hash     TEXT,
  row_hash      TEXT,
  UNIQUE (grade_id, version),
  UNIQUE (idempotency_key),
  CHECK (version = 1 OR reason IS NOT NULL)
);
CREATE INDEX idx_gv_grade ON grade_version(grade_id, version DESC);

CREATE OR REPLACE FUNCTION fn_grade_version_chain() RETURNS trigger AS $$
BEGIN
  SELECT row_hash INTO NEW.prev_hash
    FROM grade_version WHERE grade_id = NEW.grade_id
    ORDER BY version DESC LIMIT 1;
  NEW.row_hash := encode(digest(
      coalesce(NEW.prev_hash,'') || NEW.grade_id::text || NEW.version::text ||
      NEW.value::text || NEW.status || NEW.entered_by::text ||
      NEW.entered_at::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gv_chain BEFORE INSERT ON grade_version
  FOR EACH ROW EXECUTE FUNCTION fn_grade_version_chain();
CREATE TRIGGER trg_gv_immutable BEFORE UPDATE OR DELETE ON grade_version
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

CREATE VIEW v_grade_current AS
SELECT DISTINCT ON (gv.grade_id)
       gv.grade_id, g.enrollment_id, g.component,
       gv.value, gv.status, gv.version, gv.entered_at
FROM grade_version gv JOIN grade g ON g.id = gv.grade_id
ORDER BY gv.grade_id, gv.version DESC;

-- =====================================================
-- 6. DOCUMENTOS (versiones inmutables)
-- =====================================================
CREATE TABLE document (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      UUID NOT NULL REFERENCES users(id),
  doc_type           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','ARCHIVED','LEGAL_HOLD')),
  current_version_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_version (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES document(id),
  version     INT NOT NULL CHECK (version >= 1),
  storage_key TEXT NOT NULL UNIQUE,
  sha256      CHAR(64) NOT NULL,
  size_bytes  BIGINT NOT NULL CHECK (size_bytes > 0),
  mime_type   TEXT NOT NULL,
  enc_key_ref TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (scan_status IN ('PENDING','CLEAN','INFECTED')),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

ALTER TABLE document
  ADD CONSTRAINT fk_doc_current FOREIGN KEY (current_version_id)
  REFERENCES document_version(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_doc_owner ON document(owner_user_id);

CREATE OR REPLACE FUNCTION fn_docver_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_version no admite DELETE';
  END IF;
  IF (NEW.document_id, NEW.version, NEW.storage_key, NEW.sha256, NEW.size_bytes,
      NEW.mime_type, NEW.enc_key_ref, NEW.uploaded_by, NEW.uploaded_at)
     IS DISTINCT FROM
     (OLD.document_id, OLD.version, OLD.storage_key, OLD.sha256, OLD.size_bytes,
      OLD.mime_type, OLD.enc_key_ref, OLD.uploaded_by, OLD.uploaded_at) THEN
    RAISE EXCEPTION 'document_version es inmutable (solo scan_status)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_docver_guard BEFORE UPDATE OR DELETE ON document_version
  FOR EACH ROW EXECUTE FUNCTION fn_docver_guard();

-- =====================================================
-- 7. SOLICITUDES
-- =====================================================
CREATE TABLE request (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'CREATED'
               CHECK (status IN ('CREATED','IN_REVIEW','APPROVED','REJECTED','CLOSED')),
  assigned_to  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_request_requester ON request(requester_id);

CREATE TABLE request_event (
  id          BIGSERIAL PRIMARY KEY,
  request_id  UUID NOT NULL REFERENCES request(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES users(id),
  comment     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reqevt_request ON request_event(request_id, at);
CREATE TRIGGER trg_reqevt_immutable BEFORE UPDATE OR DELETE ON request_event
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

CREATE TABLE request_document (
  request_id  UUID NOT NULL REFERENCES request(id),
  document_id UUID NOT NULL REFERENCES document(id),
  PRIMARY KEY (request_id, document_id)
);

-- =====================================================
-- 8. AUDITORIA (append-only, hash encadenado global)
-- =====================================================
CREATE TABLE audit_log (
  id             BIGSERIAL PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id       UUID,
  actor_role     TEXT,
  action         TEXT NOT NULL,
  resource_type  TEXT,
  resource_id    TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  ip             INET,
  user_agent     TEXT,
  correlation_id UUID,
  reason         TEXT,
  before_json    JSONB,
  after_json     JSONB,
  prev_hash      TEXT,
  row_hash       TEXT
);
CREATE INDEX idx_audit_ts       ON audit_log(ts);
CREATE INDEX idx_audit_actor    ON audit_log(actor_id, ts);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

CREATE OR REPLACE FUNCTION fn_audit_chain() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(884422);
  SELECT row_hash INTO NEW.prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.row_hash := encode(digest(
      coalesce(NEW.prev_hash,'') || NEW.ts::text ||
      coalesce(NEW.actor_id::text,'') || NEW.action ||
      coalesce(NEW.resource_type,'') || coalesce(NEW.resource_id,'') ||
      NEW.outcome || coalesce(NEW.after_json::text,''), 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_chain();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- =====================================================
-- 9. DATOS SEMILLA: ROLES Y PERMISOS
-- =====================================================
INSERT INTO role(name) VALUES
  ('STUDENT'),('PROFESSOR'),('ADMIN'),('CAREER_HEAD');

INSERT INTO permission(code) VALUES
  ('profile:read-own'),('profile:update-own'),
  ('grade:read'),('grade:write'),
  ('document:read'),('document:upload'),
  ('request:create'),('request:read'),
  ('group:read'),('group:create'),('roster:read'),
  ('professor:create'),('professor:deactivate'),('enrollment:create'),
  ('user:manage'),('role:manage'),('permission:manage'),('audit:read');

INSERT INTO role_permission(role_id, permission_id)
SELECT r.id, p.id FROM role r JOIN permission p ON
  (r.name='STUDENT'     AND p.code IN ('profile:read-own','profile:update-own','grade:read',
                                       'document:read','document:upload','request:create','request:read'))
 OR (r.name='PROFESSOR' AND p.code IN ('profile:read-own','profile:update-own','group:read',
                                       'grade:read','grade:write','roster:read'))
 OR (r.name='CAREER_HEAD' AND p.code IN ('profile:read-own','profile:update-own',
                                       'professor:create','professor:deactivate',
                                       'group:create','group:read','enrollment:create'))
 OR (r.name='ADMIN'    AND p.code IN ('profile:read-own','profile:update-own','user:manage',
                                       'role:manage','permission:manage','audit:read'));

-- =====================================================
-- 10. ROW-LEVEL SECURITY (segunda barrera; ejemplo)
-- =====================================================
ALTER TABLE enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment FORCE ROW LEVEL SECURITY;

CREATE POLICY p_enroll_student ON enrollment FOR SELECT
  USING (student_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY p_enroll_professor ON enrollment FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM teaching_assignment ta
    WHERE ta.group_id = enrollment.group_id
      AND ta.professor_id = current_setting('app.user_id', true)::uuid
      AND ta.valid_from <= now()
      AND (ta.valid_to IS NULL OR ta.valid_to > now())
  ));

ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
CREATE POLICY p_doc_owner ON document FOR SELECT
  USING (owner_user_id = current_setting('app.user_id', true)::uuid);

-- NOTA: para pruebas locales con un solo rol de conexion (app_user con
-- privilegios amplios), RLS puede no filtrar como se espera si ese rol es
-- el dueno de las tablas. Para probar RLS de verdad, conecta la app con un
-- rol SIN BYPASSRLS y que no sea el dueno (ver seccion de RLS del README).
