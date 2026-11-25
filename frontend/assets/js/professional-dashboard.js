/* ============================================================
   MediSync Healthcare Professional Portal Controller
   ============================================================ */
(function () {
  'use strict';

  const { esc, apiFetch, requireAuthRole, notify, refreshIcons, formatDate } = window.MediSync;
  let proProfileData = null;
  let proChart = null;

  function switchView(viewName) {
    document.querySelectorAll('.ms-view').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewName)?.classList.add('active');
    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-view') === viewName);
    });
    refreshIcons();
  }

  async function loadProfile() {
    proProfileData = await apiFetch('/api/professional/profile');
    const u = proProfileData.user;
    const p = proProfileData.professional;

    document.getElementById('proName').textContent = u.full_name;
    document.getElementById('proDropName').textContent = u.full_name;
    document.getElementById('proDropEmail').textContent = u.email;
    document.getElementById('proAvatar').textContent = u.full_name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

    const badge = document.getElementById('proVerificationHeaderBadge');
    if (p.verification_status === 'verified') {
      badge.className = 'badge bg-success bg-opacity-10 text-success ms-2';
      badge.textContent = 'Verified Clinician · ' + p.specialty;
    } else if (p.verification_status === 'pending') {
      badge.className = 'badge bg-warning bg-opacity-10 text-warning ms-2';
      badge.textContent = 'Verification Pending (Admin Approval Required)';
    } else {
      badge.className = 'badge bg-danger bg-opacity-10 text-danger ms-2';
      badge.textContent = 'Verification Rejected';
    }

    document.getElementById('proProfileDetails').innerHTML = `
      <div class="row g-3">
        <div class="col-md-6"><small class="text-muted d-block">Full Name</small><strong>${esc(u.full_name)}</strong></div>
        <div class="col-md-6"><small class="text-muted d-block">Verification Status</small><span class="badge ${p.verification_status === 'verified' ? 'bg-success' : 'bg-warning'}">${esc(p.verification_status)}</span></div>
        <div class="col-md-4"><small class="text-muted d-block">Specialty</small><strong>${esc(p.specialty)}</strong></div>
        <div class="col-md-4"><small class="text-muted d-block">Registration #</small><strong>${esc(p.registration_number)}</strong></div>
        <div class="col-md-4"><small class="text-muted d-block">Facility</small><strong>${esc(p.facility_name || '—')}</strong></div>
      </div>
    `;

    const cList = document.getElementById('consentedPatientsList');
    const active = proProfileData.consented_patients.filter(x => x.consent_status === 'active');
    cList.innerHTML = active.length ? active.map(pt => `
      <div class="p-2 border rounded mb-2 d-flex justify-content-between align-items-center bg-light">
        <div>
          <strong class="small text-navy">${esc(pt.full_name)}</strong>
          <span class="ms-id-pill ms-2" style="font-size:0.75rem;padding:2px 8px;">${esc(pt.medisync_id)}</span>
          <div class="small text-muted mt-1">Scopes: ${pt.scopes.map(esc).join(', ')}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="MediSyncPro.openPatientChart('${esc(pt.medisync_id)}')">Open Chart</button>
      </div>
    `).join('') : '<p class="text-muted small mb-0">No active consented patients yet.</p>';

    const rList = document.getElementById('proRequestsList');
    rList.innerHTML = proProfileData.access_requests.length ? proProfileData.access_requests.map(r => `
      <div class="d-flex justify-content-between align-items-center py-2 border-bottom small">
        <div><strong>${esc(r.medisync_id)}</strong> — ${esc(r.purpose)}</div>
        <span class="badge ${r.status === 'approved' ? 'bg-success' : r.status === 'pending' ? 'bg-warning text-dark' : 'bg-secondary'}">${esc(r.status)}</span>
      </div>
    `).join('') : '<p class="text-muted small mb-0">No access requests submitted yet.</p>';
  }

  async function performLookup(query) {
    const box = document.getElementById('lookupResultBox');
    box.classList.remove('d-none');
    box.innerHTML = '<div class="small text-muted">Looking up MediSync ID...</div>';
    try {
      const res = await apiFetch('/api/professional/lookup?query=' + encodeURIComponent(query));
      if (res.consent_active) {
        box.innerHTML = `
          <div class="alert alert-success small mb-0">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <strong>Consent Active for ${esc(res.medisync_id)}</strong><br>
                <span>Permitted scopes: ${res.consented_scopes.map(esc).join(', ')}</span>
              </div>
              <button class="btn btn-sm btn-success" onclick="MediSyncPro.openPatientChart('${esc(res.medisync_id)}')">View Patient Context</button>
            </div>
          </div>
        `;
      } else {
        box.innerHTML = `
          <div class="p-3 rounded border bg-light">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong class="text-navy">${esc(res.medisync_id)}</strong>
              <span class="badge bg-warning text-dark">Consent Required</span>
            </div>
            <p class="small text-muted mb-3">${esc(res.privacy_notice)}</p>
            ${res.pending_request
              ? `<div class="alert alert-info py-2 small mb-0">Access request is currently <strong>pending</strong> patient approval (ID: ${esc(res.pending_request.id.slice(0, 8))}).</div>`
              : `<form id="accessReqForm">
                  <div class="mb-2">
                    <label class="form-label small fw-medium">Clinical Purpose</label>
                    <input type="text" class="form-control form-control-sm" id="reqPurpose" value="Outpatient consultation &amp; longitudinal history review" required>
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm" ${!res.professional_verified ? 'disabled' : ''}>Request Patient Consent</button>
                  ${!res.professional_verified ? '<div class="small text-danger mt-1">Admin verification required before requesting access.</div>' : ''}
                 </form>`
            }
          </div>
        `;
        const form = document.getElementById('accessReqForm');
        if (form) {
          form.addEventListener('submit', async e => {
            e.preventDefault();
            try {
              await apiFetch('/api/professional/access-requests', {
                method: 'POST',
                body: JSON.stringify({
                  medisync_id: res.medisync_id,
                  purpose: document.getElementById('reqPurpose').value,
                  scopes: ['records', 'wearables', 'baseline', 'timeline', 'ai_summary']
                })
              });
              notify('Consent request sent to patient ' + res.medisync_id);
              await loadProfile();
              await performLookup(res.medisync_id);
            } catch (err) {
              notify(err.message, 'danger');
            }
          });
        }
      }
    } catch (err) {
      box.innerHTML = `<div class="alert alert-danger py-2 small mb-0">${esc(err.message)}</div>`;
    }
  }

  async function openPatientChart(medisyncId) {
    try {
      const data = await apiFetch('/api/professional/patients/' + encodeURIComponent(medisyncId));
      document.getElementById('noPatientSelected').classList.add('d-none');
      document.getElementById('patientChartContent').classList.remove('d-none');
      switchView('patient-chart');

      document.getElementById('chartPatientName').textContent = data.patient.full_name;
      document.getElementById('chartMsId').textContent = data.medisync_id;
      document.getElementById('chartConsentMeta').textContent =
        `Consent active · Scopes: ${data.consent.scopes.join(', ')} · Expires: ${formatDate(data.consent.expires_at)}`;

      const ai = data.ai_contextual_summary;
      document.getElementById('chartAiSummary').innerHTML = ai ? `
        <p class="fw-medium text-navy">${esc(ai.summary)}</p>
        <div class="row g-3 small">
          <div class="col-md-6"><strong>From Medical Records:</strong><ul class="ps-3 mt-1">${(ai.from_medical_records || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="col-md-6"><strong>Baseline &amp; Wearable Context:</strong><ul class="ps-3 mt-1">${(ai.personal_baseline_comparison || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>
        <div class="ms-ai-disclaimer mt-2">${esc(ai.disclaimer)}</div>
      ` : '<p class="text-muted small mb-0">AI Summary scope not included in consent.</p>';

      const exBody = document.getElementById('chartExtractedBody');
      exBody.innerHTML = (data.extracted || []).map(e => `
        <tr>
          <td><span class="badge bg-navy-soft">${esc(e.category)}</span></td>
          <td class="small fw-semibold">${esc(e.name)}</td>
          <td class="small">${esc(e.value || '—')} ${esc(e.unit || '')}</td>
          <td class="small text-muted">${esc(e.source_reference || '—')}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">Not available in consented scopes.</td></tr>';

      const baseEl = document.getElementById('chartBaselinesBody');
      const baseHtml = (data.baselines || []).map(b =>
        `<div class="d-flex justify-content-between py-1 border-bottom small">
          <strong>${esc(b.metric)}</strong>
          <span>Mean: ${b.baseline_mean ?? '—'} (Band: ${b.baseline_low ?? '—'}–${b.baseline_high ?? '—'}, ${esc(b.confidence_level)})</span>
        </div>`
      ).join('');
      const insHtml = (data.insights || []).map(i =>
        `<div class="p-2 rounded border bg-light mt-2 small"><strong>${esc(i.title)}:</strong> ${esc(i.explanation)}</div>`
      ).join('');
      baseEl.innerHTML = (baseHtml || '<p class="small text-muted">No baseline data.</p>') + insHtml;

      const obs = data.wearables || [];
      if (proChart) proChart.destroy();
      proChart = new Chart(document.getElementById('proWearableChart'), {
        type: 'line',
        data: {
          labels: obs.map(o => o.observed_at.slice(5, 10)),
          datasets: [
            { label: 'Resting HR (bpm)', data: obs.map(o => o.resting_hr), borderColor: '#0d9488', yAxisID: 'y', tension: 0.3 },
            { label: 'Sleep (hrs)', data: obs.map(o => o.sleep_hours), borderColor: '#0f2942', yAxisID: 'y1', tension: 0.3 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { position: 'left' },
            y1: { position: 'right', grid: { drawOnChartArea: false } }
          }
        }
      });

      document.getElementById('chartTimelineBody').innerHTML = (data.timeline || []).map(t => `
        <div class="pb-2 mb-2 border-bottom small">
          <div class="d-flex justify-content-between"><span class="badge bg-teal-soft">${esc(t.badge)}</span><span class="text-muted">${esc(t.date)}</span></div>
          <div class="fw-semibold text-navy mt-1">${esc(t.title)}</div>
          <div class="text-muted">${esc(t.description)}</div>
        </div>
      `).join('') || '<p class="text-muted small">No timeline entries.</p>';
    } catch (err) {
      notify(err.message, 'danger');
    }
  }

  window.MediSyncPro = {
    switchView,
    openPatientChart,
    fillLookup: function (val) {
      document.getElementById('lookupQuery').value = val;
      performLookup(val);
    }
  };

  (async function init() {
    const user = await requireAuthRole('professional');
    if (!user) return;
    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        switchView(this.getAttribute('data-view'));
      });
    });
    document.getElementById('lookupForm').addEventListener('submit', function (e) {
      e.preventDefault();
      performLookup(document.getElementById('lookupQuery').value);
    });
    await loadProfile();
    refreshIcons();
  })();
})();
