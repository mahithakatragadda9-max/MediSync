/* ============================================================
   MediSync Admin Control Panel Controller
   ============================================================ */
(function () {
  'use strict';

  const { esc, apiFetch, requireAuthRole, notify, refreshIcons } = window.MediSync;
  let usageChart = null;

  function switchView(viewName) {
    document.querySelectorAll('.ms-view').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewName)?.classList.add('active');
    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-view') === viewName);
    });
    if (viewName === 'users') loadUsers();
    if (viewName === 'audits') loadAudits();
    refreshIcons();
  }

  async function loadOverview() {
    const data = await apiFetch('/api/admin/overview');
    const m = data.metrics;
    const h = data.system_health;

    document.getElementById('adminKpiGrid').innerHTML = `
      <div class="col-md-6 col-xl-3"><div class="ms-kpi-card"><small class="text-muted">Registered Patients</small><div class="h2 fw-bold text-navy mb-0 mt-1">${m.total_patients}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="ms-kpi-card"><small class="text-muted">Healthcare Professionals</small><div class="h2 fw-bold text-navy mb-0 mt-1">${m.total_professionals}</div><small class="text-success">${m.verified_professionals} verified</small></div></div>
      <div class="col-md-6 col-xl-3"><div class="ms-kpi-card"><small class="text-muted">Pending Verifications</small><div class="h2 fw-bold text-warning mb-0 mt-1">${m.pending_verifications}</div></div></div>
      <div class="col-md-6 col-xl-3"><div class="ms-kpi-card"><small class="text-muted">Active Patient Consents</small><div class="h2 fw-bold text-primary mb-0 mt-1">${m.active_consents}</div></div></div>
    `;

    if (usageChart) usageChart.destroy();
    usageChart = new Chart(document.getElementById('adminUsageChart'), {
      type: 'bar',
      data: {
        labels: ['Patients', 'Professionals', 'Documents (Count)', 'Wearable Days', 'AI Queries'],
        datasets: [{
          label: 'Platform Counts',
          data: [m.total_patients, m.total_professionals, m.documents_stored_count, m.wearable_observations_count, m.ai_queries_count],
          backgroundColor: ['#0d9488', '#0f2942', '#0284c7', '#14b8a6', '#f59e0b'],
          borderRadius: 6
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    document.getElementById('adminSystemHealthCard').innerHTML = `
      <div class="card-body row g-3">
        <div class="col-md-3"><small class="text-muted d-block">API Status</small><span class="badge bg-success">${esc(h.api_status)}</span></div>
        <div class="col-md-3"><small class="text-muted d-block">Database Engine</small><strong class="small">${esc(h.database_engine)}</strong></div>
        <div class="col-md-3"><small class="text-muted d-block">AI Engine</small><strong class="small">${esc(h.ai_provider)}</strong></div>
        <div class="col-md-3"><small class="text-muted d-block">Privacy Guard</small><strong class="small text-primary">${esc(h.privacy_guard)}</strong></div>
      </div>
    `;

    document.getElementById('adminDeviceMonitoringBody').innerHTML = data.device_monitoring.map(d => `
      <tr>
        <td class="fw-semibold small text-navy">${esc(d.display_name)}</td>
        <td class="small">${esc(d.integration_mode)}</td>
        <td><span class="badge ${d.status === 'unavailable' ? 'bg-secondary' : 'bg-teal-soft'}">${esc(d.status)}</span></td>
        <td class="small">${d.configured_users}</td>
        <td class="small">${d.total_records_imported}</td>
      </tr>
    `).join('');
  }

  async function loadUsers() {
    const data = await apiFetch('/api/admin/users');
    const pendingPros = data.users.filter(u => u.role === 'professional' && u.verification_status === 'pending');

    document.getElementById('adminPendingProsBox').innerHTML = pendingPros.length
      ? pendingPros.map(p => `
        <div class="p-3 border rounded mb-2 d-flex justify-content-between align-items-center bg-light">
          <div>
            <strong class="small text-navy">${esc(p.full_name)}</strong>
            <div class="small text-muted">${esc(p.specialty)} · Reg: ${esc(p.registration_number)}</div>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-primary" onclick="MediSyncAdmin.verifyPro('${esc(p.id)}','verified')">Verify</button>
            <button class="btn btn-sm btn-outline-danger" onclick="MediSyncAdmin.verifyPro('${esc(p.id)}','rejected')">Reject</button>
          </div>
        </div>
      `).join('')
      : '<p class="text-muted small mb-0">No pending professional verification requests.</p>';

    document.getElementById('adminUsersBody').innerHTML = data.users.map(u => {
      const cred = u.role === 'patient'
        ? (u.medisync_id ? `<span class="ms-id-pill" style="font-size:0.75rem;padding:2px 8px;">${esc(u.medisync_id)}</span>` : '—')
        : u.role === 'professional'
        ? `<small>${esc(u.specialty || '')} · ${esc(u.registration_number || '')}</small>`
        : '<small class="text-muted">Administrator</small>';

      const ver = u.role === 'professional'
        ? `<span class="badge ${u.verification_status === 'verified' ? 'bg-success' : u.verification_status === 'pending' ? 'bg-warning text-dark' : 'bg-danger'}">${esc(u.verification_status)}</span>`
        : '—';

      const st = `<span class="badge ${u.status === 'active' ? 'bg-success bg-opacity-10 text-success' : 'bg-danger bg-opacity-10 text-danger'}">${esc(u.status)}</span>`;

      let actions = '';
      if (u.role === 'professional' && u.verification_status !== 'verified') {
        actions += `<button class="btn btn-sm btn-primary me-1" onclick="MediSyncAdmin.verifyPro('${esc(u.id)}','verified')">Verify</button>`;
      }
      if (u.role !== 'admin') {
        actions += u.status === 'active'
          ? `<button class="btn btn-sm btn-outline-danger" onclick="MediSyncAdmin.setStatus('${esc(u.id)}','suspended')">Suspend</button>`
          : `<button class="btn btn-sm btn-outline-success" onclick="MediSyncAdmin.setStatus('${esc(u.id)}','active')">Activate</button>`;
      }

      return `
        <tr>
          <td><strong class="small text-navy">${esc(u.full_name)}</strong><br><small class="text-muted">${esc(u.email)}</small></td>
          <td><span class="badge bg-navy-soft">${esc(u.role)}</span></td>
          <td>${cred}</td>
          <td>${ver}</td>
          <td>${st}</td>
          <td>${actions || '<small class="text-muted">Protected</small>'}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadAudits() {
    const data = await apiFetch('/api/admin/audit-logs?limit=80');
    document.getElementById('adminAuditBody').innerHTML = data.audit_logs.map(a => `
      <tr>
        <td class="small text-muted">${esc(a.created_at.slice(0, 19).replace('T', ' '))}</td>
        <td class="small">${esc(a.actor_name || a.actor_email || 'System')}</td>
        <td class="small">${esc(a.actor_role || '—')}</td>
        <td><span class="badge bg-navy-soft">${esc(a.action)}</span></td>
        <td class="small">${esc(a.target_type || '')} ${esc(a.target_id ? a.target_id.slice(0, 18) : '')}</td>
        <td class="small text-muted">${esc(JSON.stringify(a.details))}</td>
      </tr>
    `).join('');
  }

  window.MediSyncAdmin = {
    switchView,
    verifyPro: async function (userId, decision) {
      try {
        await apiFetch(`/api/admin/professionals/${userId}/verify`, {
          method: 'POST',
          body: JSON.stringify({ decision })
        });
        notify(`Professional marked ${decision}.`);
        await Promise.all([loadOverview(), loadUsers()]);
      } catch (err) {
        notify(err.message, 'danger');
      }
    },
    setStatus: async function (userId, status) {
      try {
        await apiFetch(`/api/admin/users/${userId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status })
        });
        notify(`Account ${status}.`);
        await Promise.all([loadOverview(), loadUsers()]);
      } catch (err) {
        notify(err.message, 'danger');
      }
    }
  };

  (async function init() {
    const user = await requireAuthRole('admin');
    if (!user) return;
    document.getElementById('adminName').textContent = user.full_name;
    document.getElementById('adminDropName').textContent = user.full_name;
    document.getElementById('adminDropEmail').textContent = user.email;
    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        switchView(this.getAttribute('data-view'));
      });
    });
    await Promise.all([loadOverview(), loadUsers(), loadAudits()]);
    refreshIcons();
  })();
})();
