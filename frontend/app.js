/* =====================================================
   SecureCampus — Frontend (vanilla JS, sin dependencias externas)
   Un solo archivo, organizado por secciones:
     1. Iconos SVG en linea
     2. Utilidades de DOM / formato
     3. Capa de API (fetch + refresh automatico de sesion)
     4. Autenticacion (login, logout, recuperacion de acceso)
     5. Navegacion (arma el menu segun los roles del usuario)
     6. Vistas por actor: perfil, estudiante, profesor, jefe de carrera, admin
     7. Arranque
   ===================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------
  // 1. Iconos (SVG outline, sin dependencias externas)
  // ---------------------------------------------------
  const ICONS = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.5-4 5-5.5 7.5-5.5s6 1.5 7.5 5.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l2.5 2.5L16 9"/></svg>',
    document: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 13h5M9.5 16.5h5"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-4 3.5V16H4z"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c1-3.2 3.5-4.6 5.5-4.6s4.5 1.4 5.5 4.6"/><path d="M15 15c2 .2 3.6 1.5 4.4 4"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="3.3"/><path d="M10.3 12.7L19 4"/><path d="M15.3 7.7L18 10.4M18.3 5.2L21 7.9"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.5l7 2.6V11c0 4.6-3 7.8-7 9-4-1.2-7-4.4-7-9V6.1z"/><path d="M9 12l2 2 4-4.2"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4H5v16h4"/><path d="M13 12h8M18 8l3 4-3 4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M12 16V5M8 8.5L12 4.5l4 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4.5h8a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M19 20V7.5a3 3 0 0 0-3-3h-1"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  };
  function icon(name) { return ICONS[name] || ''; }

  // ---------------------------------------------------
  // 2. Utilidades
  // ---------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fullName(obj) {
    if (!obj) return '';
    const first = obj.first_name || obj.firstName || '';
    const last = obj.last_name || obj.lastName || '';
    return `${first} ${last}`.trim();
  }

  function toast(message, type) {
    const container = $('#toast-container');
    const node = document.createElement('div');
    node.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    node.textContent = message;
    container.appendChild(node);
    setTimeout(() => node.remove(), 4500);
  }

  function badge(text, kind) {
    return `<span class="badge badge-${kind || 'neutral'}">${escapeHtml(text)}</span>`;
  }

  function statusBadgeKind(status) {
    const map = {
      ACTIVE: 'success', SUCCESS: 'success', PUBLISHED: 'success', CLEAN: 'success', APPROVED: 'success',
      PENDING: 'warning', DRAFT: 'warning', SUBMITTED: 'warning', IN_REVIEW: 'warning',
      DENIED: 'danger', FAILURE: 'danger', REJECTED: 'danger', INACTIVE: 'danger', DISABLED: 'danger', INFECTED: 'danger', DROPPED: 'danger',
      CREATED: 'info', CORRECTED: 'info',
    };
    return map[status] || 'neutral';
  }

  /** Modal simple de confirmacion con reautenticacion (para operaciones condicionadas de ADMIN). */
  function promptStepUp(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card">
          <h3>Confirmar operación</h3>
          <p>${escapeHtml(message)}</p>
          <div class="field">
            <label>Vuelve a escribir tu contraseña</label>
            <input type="password" id="stepup-input" autocomplete="current-password" />
          </div>
          <p class="modal-note">Esta operación requiere reautenticación por ser una acción sensible (operación condicionada).</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancelar</button>
            <button type="button" class="btn btn-primary" data-action="confirm">Confirmar</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const input = $('#stepup-input', overlay);
      input.focus();

      function close(value) {
        overlay.remove();
        resolve(value);
      }
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(input.value || 'confirmed'));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(input.value || 'confirmed');
        if (e.key === 'Escape') close(null);
      });
    });
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card">
          <h3>Confirmar</h3>
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel">Cancelar</button>
            <button type="button" class="btn btn-danger" data-action="confirm">Sí, continuar</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      function close(value) { overlay.remove(); resolve(value); }
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    });
  }

  // ---------------------------------------------------
  // 3. Capa de API
  // ---------------------------------------------------
  const state = {
    accessToken: sessionStorage.getItem('sc_access_token') || null,
    refreshToken: sessionStorage.getItem('sc_refresh_token') || null,
    user: null,
    profile: null,
  };

  function setTokens(accessToken, refreshToken) {
    state.accessToken = accessToken;
    state.refreshToken = refreshToken;
    sessionStorage.setItem('sc_access_token', accessToken);
    sessionStorage.setItem('sc_refresh_token', refreshToken);
  }

  function clearTokens() {
    state.accessToken = null;
    state.refreshToken = null;
    sessionStorage.removeItem('sc_access_token');
    sessionStorage.removeItem('sc_refresh_token');
  }

  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(normalized)
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join(''),
      );
      return JSON.parse(json);
    } catch (_err) {
      return null;
    }
  }

  async function apiFetch(path, options) {
    options = options || {};
    const headers = Object.assign({}, options.headers || {});
    const isFormData = options.body instanceof FormData;
    if (!isFormData && options.body && typeof options.body !== 'string') {
      options.body = JSON.stringify(options.body);
    }
    if (!isFormData && options.body) headers['Content-Type'] = 'application/json';
    if (state.accessToken) headers['Authorization'] = 'Bearer ' + state.accessToken;

    let res = await fetch(path, Object.assign({}, options, { headers }));

    if (res.status === 401 && state.refreshToken && path !== '/auth/refresh') {
      const refreshed = await tryRefresh();
      if (refreshed) {
        headers['Authorization'] = 'Bearer ' + state.accessToken;
        res = await fetch(path, Object.assign({}, options, { headers }));
      }
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_e) { data = text; }
    }

    if (!res.ok) {
      const message = data && data.message
        ? (Array.isArray(data.message) ? data.message.join(', ') : data.message)
        : `Error ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function tryRefresh() {
    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });
      if (!res.ok) throw new Error('refresh failed');
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch (_err) {
      doLogout();
      return false;
    }
  }

  // ---------------------------------------------------
  // 4. Autenticacion
  // ---------------------------------------------------
  function showAuthScreen(which) {
    $('#view-app').classList.add('hidden');
    $('#view-login').classList.toggle('hidden', which !== 'login');
    $('#view-forgot').classList.toggle('hidden', which !== 'forgot');
  }

  function doLogout() {
    clearTokens();
    state.user = null;
    state.profile = null;
    showAuthScreen('login');
  }

  async function loadSession() {
    const payload = decodeJwt(state.accessToken);
    if (!payload) { doLogout(); return; }
    state.user = {
      id: payload.sub,
      roles: payload.roles || [],
      careerScopeId: payload.careerScopeId || null,
    };
    try {
      state.profile = await apiFetch('/me/profile');
    } catch (_err) {
      state.profile = null;
    }
    renderApp();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const mfaCode = $('#login-mfa').value.trim();
    const errorEl = $('#login-error');
    errorEl.classList.add('hidden');

    try {
      const body = { email, password };
      if (mfaCode) body.mfaCode = mfaCode;
      const data = await apiFetch('/auth/login', { method: 'POST', body });
      setTokens(data.accessToken, data.refreshToken);
      await loadSession();
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudo iniciar sesión.';
      errorEl.classList.remove('hidden');
    }
  });

  $('#goto-forgot').addEventListener('click', () => showAuthScreen('forgot'));
  $('#back-to-login').addEventListener('click', () => showAuthScreen('login'));

  $('#forgot-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgot-email').value.trim();
    try {
      await apiFetch('/auth/password-reset/request', { method: 'POST', body: { email } });
      $('#forgot-request-form').classList.add('hidden');
      $('#forgot-confirm-form').classList.remove('hidden');
      const note = $('#forgot-message');
      note.textContent = 'Si el correo existe, se generó un token (revisa la consola del servidor en este entorno de pruebas).';
      note.classList.remove('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#forgot-confirm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('#forgot-token').value.trim();
    const newPassword = $('#forgot-newpassword').value;
    try {
      await apiFetch('/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword } });
      toast('Contraseña actualizada. Inicia sesión con tu nueva contraseña.', 'success');
      showAuthScreen('login');
      $('#forgot-request-form').classList.remove('hidden');
      $('#forgot-confirm-form').classList.add('hidden');
      $('#forgot-message').classList.add('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#logout-btn').addEventListener('click', doLogout);

  // ---------------------------------------------------
  // 5. Navegacion
  // ---------------------------------------------------
  let navItems = [];
  let activeViewId = 'profile';

  function buildNav() {
    const roles = state.user.roles;
    const items = [{ id: 'profile', label: 'Mi perfil', icon: 'user', group: null, render: renderProfileView }];

    if (roles.includes('STUDENT')) {
      items.push({ id: 'student-grades', label: 'Calificaciones', icon: 'check', group: 'Estudiante', render: renderStudentGrades });
      items.push({ id: 'student-documents', label: 'Documentos', icon: 'document', group: 'Estudiante', render: renderStudentDocuments });
      items.push({ id: 'student-requests', label: 'Solicitudes', icon: 'message', group: 'Estudiante', render: renderStudentRequests });
    }
    if (roles.includes('PROFESSOR')) {
      items.push({ id: 'professor-groups', label: 'Mis grupos', icon: 'grid', group: 'Profesor', render: renderProfessorGroups });
    }
    if (roles.includes('CAREER_HEAD')) {
      items.push({ id: 'head-professors', label: 'Profesores', icon: 'people', group: 'Jefe de Carrera', render: renderHeadProfessors });
      items.push({ id: 'head-groups', label: 'Grupos', icon: 'grid', group: 'Jefe de Carrera', render: renderHeadGroups });
      items.push({ id: 'head-enrollments', label: 'Inscripciones', icon: 'book', group: 'Jefe de Carrera', render: renderHeadEnrollments });
    }
    if (roles.includes('ADMIN')) {
      items.push({ id: 'admin-users', label: 'Usuarios', icon: 'grid', group: 'Administrador', render: renderAdminUsers });
      items.push({ id: 'admin-roles', label: 'Roles y permisos', icon: 'key', group: 'Administrador', render: renderAdminRoles });
      items.push({ id: 'admin-audit', label: 'Auditoría', icon: 'shield', group: 'Administrador', render: renderAdminAudit });
    }
    return items;
  }

  function renderSidebarNav() {
    const nav = $('#sidebar-nav');
    let html = '';
    let lastGroup = '__none__';
    navItems.forEach((item) => {
      if (item.group !== lastGroup) {
        html += `<div class="nav-group-label">${escapeHtml(item.group || 'General')}</div>`;
        lastGroup = item.group;
      }
      html += `<button type="button" class="nav-item" data-view="${item.id}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></button>`;
    });
    nav.innerHTML = html;
    $$('.nav-item', nav).forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  function switchView(viewId) {
    const item = navItems.find((i) => i.id === viewId) || navItems[0];
    activeViewId = item.id;
    $$('.nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === item.id));
    $('#content-title').textContent = item.label;
    const body = $('#content-body');
    body.innerHTML = '<p class="muted">Cargando…</p>';
    Promise.resolve(item.render(body)).catch((err) => {
      body.innerHTML = `<div class="panel"><div class="panel-body"><p class="form-error">${escapeHtml(err.message || 'Ocurrió un error al cargar esta sección.')}</p></div></div>`;
    });
  }

  function renderApp() {
    showAuthScreen('none');
    $('#view-app').classList.remove('hidden');

    navItems = buildNav();

    const name = fullName(state.profile) || state.user.id.slice(0, 8);
    $('#user-chip-name').textContent = name;
    $('#user-chip-role').textContent = state.user.roles.join(' · ') || 'Sin rol asignado';
    $('#user-chip-initial').textContent = (name.charAt(0) || '?').toUpperCase();

    renderSidebarNav();
    switchView(navItems.some((i) => i.id === activeViewId) ? activeViewId : 'profile');
  }

  // ---------------------------------------------------
  // 6. Vistas
  // ---------------------------------------------------

  // ---- Perfil (todos los actores) ----
  async function renderProfileView(container) {
    const profile = state.profile || {};
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3>Datos personales</h3>
            <p>Visible solo para ti. Solo tú puedes editarlo.</p>
          </div>
          ${badge(state.user.roles.join(', ') || 'Sin rol', 'info')}
        </div>
        <div class="panel-body">
          <form id="profile-form" class="field-grid">
            <div class="field">
              <label>Nombre(s)</label>
              <input type="text" name="firstName" value="${escapeHtml(profile.first_name || '')}" required />
            </div>
            <div class="field">
              <label>Apellido(s)</label>
              <input type="text" name="lastName" value="${escapeHtml(profile.last_name || '')}" required />
            </div>
            <div class="field">
              <label>Teléfono</label>
              <input type="text" name="phone" value="${escapeHtml(profile.phone || '')}" placeholder="Opcional" />
            </div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="profile-form" class="btn btn-primary">Guardar cambios</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Información de la cuenta</h3></div>
        <div class="panel-body field-grid">
          <div class="field"><label>Identificador de usuario</label><p><code class="inline-code">${escapeHtml(state.user.id)}</code></p></div>
          <div class="field"><label>Roles asignados</label><p>${state.user.roles.map((r) => badge(r, 'info')).join(' ') || '—'}</p></div>
        </div>
      </div>`;

    $('#profile-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { firstName: fd.get('firstName'), lastName: fd.get('lastName'), phone: fd.get('phone') };
      try {
        await apiFetch('/me/profile', { method: 'PUT', body: payload });
        state.profile = await apiFetch('/me/profile');
        toast('Perfil actualizado.', 'success');
        renderApp();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---- Estudiante: calificaciones ----
  async function renderStudentGrades(container) {
    const grades = await apiFetch('/me/grades');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div><h3>Mis calificaciones</h3><p>Solo se muestran calificaciones publicadas.</p></div>
        </div>
        <div class="panel-body table-wrap">
          ${grades.length === 0 ? '<p class="empty-state">Aún no tienes calificaciones publicadas.</p>' : `
          <table class="data-table">
            <thead><tr><th>Componente</th><th>Calificación</th><th>Publicada</th></tr></thead>
            <tbody>
              ${grades.map((g) => `
                <tr>
                  <td>${escapeHtml(g.component)}</td>
                  <td><strong>${escapeHtml(g.value)}</strong></td>
                  <td>${fmtDate(g.entered_at)}</td>
                </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>`;
  }

  // ---- Estudiante: documentos ----
  async function renderStudentDocuments(container) {
    const docs = await apiFetch('/documents/mine');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Subir documento</h3><p>PDF, PNG o JPEG, máximo 10&nbsp;MB.</p></div></div>
        <div class="panel-body">
          <form id="upload-form" class="row">
            <input type="file" name="file" id="upload-file" accept=".pdf,.png,.jpg,.jpeg" required />
            <button type="submit" class="btn btn-primary">${icon('upload')} Subir</button>
          </form>
          <p class="field-hint" style="margin-top:8px;">Nota: en este entorno de pruebas el archivo se valida y se registra, pero el almacenamiento definitivo (MinIO) aún no está conectado.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Mis documentos</h3></div>
        <div class="panel-body table-wrap">
          ${docs.length === 0 ? '<p class="empty-state">No has subido documentos todavía.</p>' : `
          <table class="data-table">
            <thead><tr><th>Tipo</th><th>Estado</th><th>Subido</th><th></th></tr></thead>
            <tbody>
              ${docs.map((d) => `
                <tr>
                  <td>${escapeHtml(d.docType)}</td>
                  <td>${badge(d.status, statusBadgeKind(d.status))}</td>
                  <td>${fmtDate(d.createdAt)}</td>
                  <td><button class="btn btn-secondary btn-sm" data-download="${d.id}">Obtener enlace</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>`;

    $('#upload-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = $('#upload-file', container);
      if (!fileInput.files[0]) return;
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      try {
        await apiFetch('/documents/upload', { method: 'POST', body: fd });
        toast('Documento subido.', 'success');
        renderStudentDocuments(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-download]', container).forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const url = await apiFetch(`/documents/${btn.dataset.download}/download-url`);
          toast('Enlace (simulado): ' + url, 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Estudiante: solicitudes ----
  async function renderStudentRequests(container) {
    const requests = await apiFetch('/requests/mine');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Nueva solicitud</h3></div></div>
        <div class="panel-body">
          <form id="request-form" class="field-grid">
            <div class="field">
              <label>Tipo</label>
              <select name="type" required>
                <option value="CONSTANCIA">Constancia de estudios</option>
                <option value="KARDEX">Kardex</option>
                <option value="CAMBIO_GRUPO">Cambio de grupo</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            <div class="field" style="grid-column: 1 / -1;">
              <label>Descripción</label>
              <textarea name="description" rows="2" placeholder="Detalla tu solicitud (opcional)"></textarea>
            </div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="request-form" class="btn btn-primary">${icon('plus')} Crear solicitud</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Mis solicitudes</h3></div>
        <div class="panel-body table-wrap">
          ${requests.length === 0 ? '<p class="empty-state">No has creado solicitudes todavía.</p>' : `
          <table class="data-table">
            <thead><tr><th>Tipo</th><th>Estado</th><th>Creada</th><th></th></tr></thead>
            <tbody>
              ${requests.map((r) => `
                <tr>
                  <td>${escapeHtml(r.type)}</td>
                  <td>${badge(r.status, statusBadgeKind(r.status))}</td>
                  <td>${fmtDate(r.createdAt)}</td>
                  <td><button class="btn btn-secondary btn-sm" data-history="${r.id}">Ver historial</button></td>
                </tr>
                <tr class="history-row hidden" data-history-row="${r.id}"><td colspan="4"></td></tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>`;

    $('#request-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch('/requests', { method: 'POST', body: { type: fd.get('type'), description: fd.get('description') || undefined } });
        toast('Solicitud creada.', 'success');
        renderStudentRequests(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-history]', container).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = $(`[data-history-row="${btn.dataset.history}"]`, container);
        const isOpen = !row.classList.contains('hidden');
        $$('.history-row', container).forEach((r) => r.classList.add('hidden'));
        if (isOpen) return;
        try {
          const events = await apiFetch(`/requests/${btn.dataset.history}/history`);
          row.querySelector('td').innerHTML = events.length === 0 ? '<span class="muted">Sin eventos.</span>' : `
            <div class="stack">
              ${events.map((ev) => `
                <div class="row-between" style="font-size:12.5px;">
                  <span>${badge(ev.from_status || 'INICIO', 'neutral')} → ${badge(ev.to_status, statusBadgeKind(ev.to_status))} ${ev.comment ? '— ' + escapeHtml(ev.comment) : ''}</span>
                  <span class="muted">${fmtDate(ev.at)}</span>
                </div>`).join('')}
            </div>`;
          row.classList.remove('hidden');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Profesor: grupos, roster y captura de calificaciones ----
  async function renderProfessorGroups(container) {
    const groups = await apiFetch('/me/groups');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Mis grupos asignados</h3><p>Solo se listan grupos con asignación vigente.</p></div></div>
        <div class="panel-body table-wrap">
          ${groups.length === 0 ? '<p class="empty-state">No tienes grupos asignados todavía.</p>' : `
          <table class="data-table">
            <thead><tr><th>Código</th><th>Cupo</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${groups.map((g) => `
                <tr>
                  <td>${escapeHtml(g.code)}</td>
                  <td>${escapeHtml(g.capacity)}</td>
                  <td>${badge(g.status, statusBadgeKind(g.status))}</td>
                  <td><button class="btn btn-secondary btn-sm" data-open-group="${g.id}">Abrir</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>
      <div id="group-detail"></div>`;

    $$('[data-open-group]', container).forEach((btn) => {
      btn.addEventListener('click', () => renderGroupDetail(container, btn.dataset.openGroup));
    });
  }

  async function renderGroupDetail(container, groupId) {
    const detail = $('#group-detail', container);
    detail.innerHTML = '<p class="muted">Cargando lista del grupo…</p>';
    const roster = await apiFetch(`/groups/${groupId}/roster`);

    detail.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Lista autorizada</h3><p>Alumnos inscritos en este grupo.</p></div></div>
        <div class="panel-body table-wrap">
          ${roster.length === 0 ? '<p class="empty-state">Sin alumnos inscritos.</p>' : `
          <table class="data-table">
            <thead><tr><th>Matrícula</th><th>Nombre</th><th>Estado</th></tr></thead>
            <tbody>
              ${roster.map((s) => `<tr><td>${escapeHtml(s.student_code)}</td><td>${escapeHtml(fullName(s))}</td><td>${badge(s.status, statusBadgeKind(s.status))}</td></tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><div><h3>Captura de calificaciones</h3><p>Ingresa valores de 0 a 100. Se guardan como nueva versión (no se sobrescriben).</p></div></div>
        <div class="panel-body">
          <form id="capture-form" class="stack">
            <div class="field" style="max-width:220px;">
              <label>Componente</label>
              <select name="component" required>
                <option value="PARCIAL1">Parcial 1</option>
                <option value="PARCIAL2">Parcial 2</option>
                <option value="FINAL">Final</option>
              </select>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Matrícula</th><th>Nombre</th><th style="width:140px;">Calificación</th></tr></thead>
                <tbody>
                  ${roster.map((s) => `
                    <tr>
                      <td>${escapeHtml(s.student_code)}</td>
                      <td>${escapeHtml(fullName(s))}</td>
                      <td><input type="number" min="0" max="100" step="0.01" data-enrollment="${s.enrollment_id}" placeholder="—" /></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="row" style="justify-content:flex-end;">
              <button type="submit" class="btn btn-secondary">Guardar calificaciones</button>
              <button type="button" id="publish-btn" class="btn btn-primary">Publicar componente</button>
            </div>
          </form>
        </div>
      </div>`;

    $('#capture-form', detail).addEventListener('submit', async (e) => {
      e.preventDefault();
      const component = $('select[name="component"]', detail).value;
      const entries = $$('input[data-enrollment]', detail)
        .filter((inp) => inp.value !== '')
        .map((inp) => ({ enrollmentId: inp.dataset.enrollment, value: Number(inp.value) }));
      if (entries.length === 0) { toast('Ingresa al menos una calificación.', 'error'); return; }
      try {
        await apiFetch('/groups/grades', {
          method: 'POST',
          body: { groupId, component, idempotencyKey: crypto.randomUUID(), entries },
        });
        toast('Calificaciones guardadas (estado: SUBMITTED). Publícalas para que el estudiante las vea.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('#publish-btn', detail).addEventListener('click', async () => {
      const component = $('select[name="component"]', detail).value;
      const ok = await confirmDialog(`¿Publicar las calificaciones de ${component}? Una vez publicadas, cualquier cambio requerirá una rectificación formal.`);
      if (!ok) return;
      try {
        await apiFetch('/groups/grades/publish', { method: 'POST', body: { groupId, component } });
        toast('Calificaciones publicadas.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---- Jefe de Carrera: profesores ----
  async function renderHeadProfessors(container) {
    const [professors, careers] = await Promise.all([
      apiFetch('/professors'),
      apiFetch('/careers'),
    ]);
    const myCareer = careers.find((c) => c.id === state.user.careerScopeId);

    container.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div><h3>Dar de alta a un profesor</h3><p>El usuario debe existir previamente (lo crea Administración).</p></div>
          ${myCareer ? badge(myCareer.name, 'info') : ''}
        </div>
        <div class="panel-body">
          <form id="hire-form" class="field-grid">
            <div class="field">
              <label>ID de usuario</label>
              <input type="text" name="userId" placeholder="UUID del usuario" required />
            </div>
            <div class="field">
              <label>Número de empleado</label>
              <input type="text" name="employeeCode" placeholder="PROF-002" required />
            </div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="hire-form" class="btn btn-primary">Dar de alta</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Profesores de mi carrera</h3></div>
        <div class="panel-body table-wrap">
          ${professors.length === 0 ? '<p class="empty-state">Aún no hay profesores activos.</p>' : `
          <table class="data-table">
            <thead><tr><th>No. empleado</th><th>Nombre</th><th></th></tr></thead>
            <tbody>
              ${professors.map((p) => `
                <tr>
                  <td>${escapeHtml(p.employee_code)}</td>
                  <td>${escapeHtml(fullName(p))}</td>
                  <td><button class="btn btn-danger btn-sm" data-deactivate="${p.user_id}">${icon('trash')} Dar de baja</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>`;

    $('#hire-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch('/professors/hire', { method: 'POST', body: { userId: fd.get('userId'), employeeCode: fd.get('employeeCode') } });
        toast('Profesor dado de alta.', 'success');
        renderHeadProfessors(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-deactivate]', container).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await confirmDialog('¿Dar de baja a este profesor? Se cerrarán todas sus asignaciones vigentes.');
        if (!ok) return;
        try {
          await apiFetch(`/professors/${btn.dataset.deactivate}/deactivate`, { method: 'POST', body: { reason: 'Baja desde el panel de Jefe de Carrera' } });
          toast('Profesor dado de baja.', 'success');
          renderHeadProfessors(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Jefe de Carrera: grupos ----
  async function renderHeadGroups(container) {
    const [groups, courses, terms, professors] = await Promise.all([
      apiFetch('/groups'), apiFetch('/courses'), apiFetch('/terms'), apiFetch('/professors'),
    ]);

    const courseOptions = courses.map((c) => `<option value="${c.id}">${escapeHtml(c.code)} — ${escapeHtml(c.name)}</option>`).join('');
    const termOptions = terms.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    const groupOptions = groups.map((g) => `<option value="${g.id}">${escapeHtml(g.course_code)}-${escapeHtml(g.code)} (${escapeHtml(g.term_name)})</option>`).join('');
    const professorOptions = professors.map((p) => `<option value="${p.user_id}">${escapeHtml(fullName(p))}</option>`).join('');

    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><h3>Crear grupo</h3></div>
        <div class="panel-body">
          <form id="create-group-form" class="field-grid">
            <div class="field"><label>Curso</label><select name="courseId" required><option value="">Selecciona…</option>${courseOptions}</select></div>
            <div class="field"><label>Periodo</label><select name="termId" required><option value="">Selecciona…</option>${termOptions}</select></div>
            <div class="field"><label>Código de grupo</label><input type="text" name="code" placeholder="B" required /></div>
            <div class="field"><label>Cupo</label><input type="number" name="capacity" min="1" value="30" required /></div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="create-group-form" class="btn btn-primary">${icon('plus')} Crear grupo</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Asignar profesor a un grupo</h3></div>
        <div class="panel-body">
          <form id="assign-form" class="field-grid">
            <div class="field"><label>Grupo</label><select name="groupId" required><option value="">Selecciona…</option>${groupOptions}</select></div>
            <div class="field"><label>Profesor</label><select name="professorId" required><option value="">Selecciona…</option>${professorOptions}</select></div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="assign-form" class="btn btn-primary">Asignar</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Grupos de mi carrera</h3></div>
        <div class="panel-body table-wrap">
          ${groups.length === 0 ? '<p class="empty-state">Aún no hay grupos creados.</p>' : `
          <table class="data-table">
            <thead><tr><th>Curso</th><th>Grupo</th><th>Periodo</th><th>Profesor</th><th>Inscritos</th><th>Estado</th></tr></thead>
            <tbody>
              ${groups.map((g) => `
                <tr>
                  <td>${escapeHtml(g.course_code)} — ${escapeHtml(g.course_name)}</td>
                  <td>${escapeHtml(g.code)}</td>
                  <td>${escapeHtml(g.term_name)}</td>
                  <td>${g.professor_first_name ? escapeHtml(g.professor_first_name + ' ' + g.professor_last_name) : '<span class="muted">Sin asignar</span>'}</td>
                  <td>${escapeHtml(g.enrolled_count)} / ${escapeHtml(g.capacity)}</td>
                  <td>${badge(g.status, statusBadgeKind(g.status))}</td>
                </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      </div>`;

    $('#create-group-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch('/groups', {
          method: 'POST',
          body: { courseId: fd.get('courseId'), termId: fd.get('termId'), code: fd.get('code'), capacity: Number(fd.get('capacity')) },
        });
        toast('Grupo creado.', 'success');
        renderHeadGroups(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('#assign-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch('/groups/assign-professor', { method: 'POST', body: { groupId: fd.get('groupId'), professorId: fd.get('professorId') } });
        toast('Profesor asignado.', 'success');
        renderHeadGroups(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---- Jefe de Carrera: inscripciones ----
  async function renderHeadEnrollments(container) {
    const [groups, students] = await Promise.all([apiFetch('/groups'), apiFetch('/students')]);
    const groupOptions = groups.map((g) => `<option value="${g.id}">${escapeHtml(g.course_code)}-${escapeHtml(g.code)} (${escapeHtml(g.term_name)}) — ${escapeHtml(g.enrolled_count)}/${escapeHtml(g.capacity)}</option>`).join('');
    const studentOptions = students.map((s) => `<option value="${s.user_id}">${escapeHtml(s.student_code)} — ${escapeHtml(fullName(s))}</option>`).join('');

    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Inscribir alumno a un grupo</h3><p>Inscripción individual (la carga masiva queda fuera del alcance del sistema).</p></div></div>
        <div class="panel-body">
          <form id="enroll-form" class="field-grid">
            <div class="field"><label>Grupo</label><select name="groupId" required><option value="">Selecciona…</option>${groupOptions}</select></div>
            <div class="field"><label>Estudiante</label><select name="studentId" required><option value="">Selecciona…</option>${studentOptions}</select></div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="enroll-form" class="btn btn-primary">${icon('plus')} Inscribir</button>
        </div>
      </div>`;

    $('#enroll-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiFetch('/enrollments', { method: 'POST', body: { groupId: fd.get('groupId'), studentId: fd.get('studentId') } });
        toast('Alumno inscrito.', 'success');
        renderHeadEnrollments(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---- Administrador: usuarios ----
  async function renderAdminUsers(container) {
    const users = await apiFetch('/admin/users');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Dar de alta un usuario</h3><p>Se crea sin rol. Asígnalo desde "Roles y permisos".</p></div></div>
        <div class="panel-body">
          <form id="create-user-form" class="field-grid">
            <div class="field"><label>Correo</label><input type="email" name="email" required /></div>
            <div class="field"><label>Nombre(s)</label><input type="text" name="firstName" required /></div>
            <div class="field"><label>Apellido(s)</label><input type="text" name="lastName" required /></div>
            <div class="field"><label>Contraseña temporal</label><input type="text" name="temporaryPassword" minlength="12" required /></div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="create-user-form" class="btn btn-primary">${icon('plus')} Dar de alta</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Usuarios del sistema</h3></div>
        <div class="panel-body table-wrap">
          <table class="data-table">
            <thead><tr><th>Correo</th><th>Nombre</th><th>Estado</th><th>Roles</th><th></th></tr></thead>
            <tbody>
              ${users.map((u) => `
                <tr>
                  <td>${escapeHtml(u.email)}</td>
                  <td>${escapeHtml(fullName(u)) || '<span class="muted">—</span>'}</td>
                  <td>${badge(u.status, statusBadgeKind(u.status))}</td>
                  <td>${(u.roles || []).filter(Boolean).map((r) => badge(r, 'info')).join(' ') || '<span class="muted">Sin rol</span>'}</td>
                  <td>${u.status === 'ACTIVE' ? `<button class="btn btn-danger btn-sm" data-deactivate-user="${u.id}">Desactivar</button>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    $('#create-user-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const stepUp = await promptStepUp('Vas a dar de alta una nueva cuenta de usuario.');
      if (!stepUp) return;
      try {
        await apiFetch('/admin/users', {
          method: 'POST',
          headers: { 'x-step-up-token': stepUp },
          body: { email: fd.get('email'), firstName: fd.get('firstName'), lastName: fd.get('lastName'), temporaryPassword: fd.get('temporaryPassword') },
        });
        toast('Usuario creado.', 'success');
        renderAdminUsers(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-deactivate-user]', container).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stepUp = await promptStepUp('Vas a desactivar esta cuenta. Se cerrarán todas sus sesiones activas.');
        if (!stepUp) return;
        try {
          await apiFetch(`/admin/users/${btn.dataset.deactivateUser}/deactivate`, {
            method: 'POST',
            headers: { 'x-step-up-token': stepUp },
            body: { reason: 'Desactivado desde el panel de administración' },
          });
          toast('Usuario desactivado.', 'success');
          renderAdminUsers(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Administrador: roles y permisos ----
  async function renderAdminRoles(container) {
    const [users, roles, careers] = await Promise.all([
      apiFetch('/admin/users'), apiFetch('/admin/roles'), apiFetch('/careers'),
    ]);
    const userOptions = users.map((u) => `<option value="${u.id}">${escapeHtml(u.email)}</option>`).join('');
    const roleOptions = roles.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
    const careerOptions = careers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Asignar rol</h3><p>El alcance de carrera solo aplica para el rol Jefe de Carrera.</p></div></div>
        <div class="panel-body">
          <form id="assign-role-form" class="field-grid">
            <div class="field"><label>Usuario</label><select name="userId" required><option value="">Selecciona…</option>${userOptions}</select></div>
            <div class="field"><label>Rol</label><select name="roleName" required><option value="">Selecciona…</option>${roleOptions}</select></div>
            <div class="field"><label>Carrera (opcional)</label><select name="scopeCareerId"><option value="">—</option>${careerOptions}</select></div>
          </form>
        </div>
        <div class="panel-body" style="padding-top:0; display:flex; justify-content:flex-end;">
          <button type="submit" form="assign-role-form" class="btn btn-primary">Asignar</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h3>Roles vigentes por usuario</h3></div>
        <div class="panel-body table-wrap">
          <table class="data-table">
            <thead><tr><th>Correo</th><th>Roles</th><th>Revocar</th></tr></thead>
            <tbody>
              ${users.map((u) => `
                <tr>
                  <td>${escapeHtml(u.email)}</td>
                  <td>${(u.roles || []).filter(Boolean).map((r) => badge(r, 'info')).join(' ') || '<span class="muted">Sin rol</span>'}</td>
                  <td>${(u.roles || []).filter(Boolean).map((r) => `<button class="btn btn-ghost btn-sm" data-revoke-user="${u.id}" data-revoke-role="${escapeHtml(r)}">Revocar ${escapeHtml(r)}</button>`).join(' ')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    $('#assign-role-form', container).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const stepUp = await promptStepUp('Vas a modificar los roles de un usuario.');
      if (!stepUp) return;
      try {
        await apiFetch(`/admin/users/${fd.get('userId')}/roles`, {
          method: 'POST',
          headers: { 'x-step-up-token': stepUp },
          body: { roleName: fd.get('roleName'), scopeCareerId: fd.get('scopeCareerId') || null },
        });
        toast('Rol asignado.', 'success');
        renderAdminRoles(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-revoke-user]', container).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stepUp = await promptStepUp(`Vas a revocar el rol ${btn.dataset.revokeRole}.`);
        if (!stepUp) return;
        try {
          await apiFetch(`/admin/users/${btn.dataset.revokeUser}/roles/${btn.dataset.revokeRole}`, {
            method: 'DELETE',
            headers: { 'x-step-up-token': stepUp },
          });
          toast('Rol revocado.', 'success');
          renderAdminRoles(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  }

  // ---- Administrador: auditoria ----
  async function renderAdminAudit(container) {
    const logs = await apiFetch('/admin/audit-log');
    container.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div><h3>Registro de auditoría</h3><p>Últimos 200 eventos. Esta misma lectura también queda auditada.</p></div></div>
        <div class="panel-body table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Acción</th><th>Recurso</th><th>Resultado</th><th>Actor</th></tr></thead>
            <tbody>
              ${logs.map((l) => `
                <tr>
                  <td>${fmtDate(l.ts)}</td>
                  <td>${escapeHtml(l.action)}</td>
                  <td>${escapeHtml(l.resourceType || '—')}${l.resourceId ? ' · <code class="inline-code">' + escapeHtml(String(l.resourceId).slice(0, 8)) + '…</code>' : ''}</td>
                  <td>${badge(l.outcome, statusBadgeKind(l.outcome))}</td>
                  <td>${l.actorId ? '<code class="inline-code">' + escapeHtml(String(l.actorId).slice(0, 8)) + '…</code>' : '<span class="muted">—</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ---------------------------------------------------
  // 7. Arranque
  // ---------------------------------------------------
  if (state.accessToken) {
    loadSession();
  } else {
    showAuthScreen('login');
  }
})();
