/* ============================================================
   MediSync Shared API Client, Session & UI Helpers
   ============================================================ */
(function (window) {
  'use strict';

  const DEFAULT_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:8000'
  : window.location.origin;


  const API_BASE = localStorage.getItem('medisync_api_base') || DEFAULT_API;
  const TOKEN_KEY = 'medisync_token';
  const USER_KEY = 'medisync_user';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function logout() {
    clearSession();
    window.location.href = 'auth-login.html';
  }

  function redirectByRole(role) {
    if (role === 'patient') window.location.href = 'patient-dashboard.html';
    else if (role === 'professional') window.location.href = 'professional-dashboard.html';
    else if (role === 'admin') window.location.href = 'admin-dashboard.html';
    else window.location.href = 'index.html';
  }

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    let response;
    try {
      response = await fetch(API_BASE + path, { ...options, headers });
    } catch (err) {
      throw new Error('Cannot reach MediSync backend at ' + (API_BASE || window.location.origin) + '. Make sure FastAPI is running on port 8000.');
    }

    if (response.status === 401 && !options.skipAuthRedirect) {
      clearSession();
      window.location.href = 'auth-login.html';
      throw new Error('Session expired. Please sign in again.');
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const detail = typeof data === 'object' && data && data.detail ? data.detail : 'Request failed (' + response.status + ')';
      throw new Error(detail);
    }
    return data;
  }

  async function requireAuthRole(expectedRole) {
    const token = getToken();
    if (!token) {
      window.location.href = 'auth-login.html';
      return null;
    }
    try {
      const me = await apiFetch('/api/auth/me');
      saveSession(token, me);
      if (expectedRole && me.role !== expectedRole) {
        redirectByRole(me.role);
        return null;
      }
      return me;
    } catch {
      clearSession();
      window.location.href = 'auth-login.html';
      return null;
    }
  }

  function notify(message, type = 'success') {
    let container = document.getElementById('msToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'msToastContainer';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.style.zIndex = '1090';
      document.body.appendChild(container);
    }
    const bgMap = {
      success: 'bg-success text-white',
      danger: 'bg-danger text-white',
      warning: 'bg-warning text-dark',
      info: 'bg-dark text-white',
    };
    const el = document.createElement('div');
    el.className = 'toast align-items-center border-0 show mb-2 ' + (bgMap[type] || bgMap.info);
    el.innerHTML =
      '<div class="d-flex"><div class="toast-body small fw-medium">' +
      esc(message) +
      '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest(\'.toast\').remove()"></button></div>';
    container.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  function refreshIcons() {
    if (typeof feather !== 'undefined') {
      feather.replace();
    }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return String(iso).slice(0, 10);
  }

  window.MediSync = {
    API_BASE,
    esc,
    getToken,
    getUser,
    saveSession,
    clearSession,
    logout,
    redirectByRole,
    apiFetch,
    requireAuthRole,
    notify,
    refreshIcons,
    formatDate,
  };
})(window);
