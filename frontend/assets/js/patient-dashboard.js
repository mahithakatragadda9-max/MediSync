/* ============================================================
   MediSync Patient Intelligence Dashboard Controller
   ============================================================ */
(function () {
  'use strict';

  const { esc, apiFetch, requireAuthRole, notify, refreshIcons, formatDate, API_BASE } = window.MediSync;

  let currentUser = null;
  let overviewData = null;
  let recordsData = null;
  let wearablesData = null;
  let baselineData = null;
  let charts = {};

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function switchView(viewName) {
    document.querySelectorAll('.ms-view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('active');

    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-view') === viewName);
    });

    if (viewName === 'records') loadRecords();
    if (viewName === 'wearables') loadWearables();
    if (viewName === 'baseline') loadBaseline();
    if (viewName === 'assistant') loadAssistant();
    if (viewName === 'timeline') loadTimeline();
    if (viewName === 'consent') loadConsent();
    refreshIcons();
  }

  function bindNavigation() {
    document.querySelectorAll('.sidebar-menu .menu-link[data-view]').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        switchView(this.getAttribute('data-view'));
      });
    });
  }

  async function loadOverview() {
    overviewData = await apiFetch('/api/patient/overview');
    const p = overviewData.patient;
    const prof = p.profile || {};
    const c = overviewData.counts;

    document.getElementById('welcomeHeading').textContent = 'Welcome back, ' + p.full_name;
    document.getElementById('headerMsId').textContent = p.medisync_id;
    document.getElementById('overviewMsId').textContent = p.medisync_id;
    document.getElementById('overviewQrImg').src = p.qr_data_uri;
    document.getElementById('overviewQrPayload').textContent = p.qr_payload;
    document.getElementById('overviewQrPrivacyNote').textContent = p.qr_privacy_note;
    document.getElementById('headerUserName').textContent = p.full_name;
    document.getElementById('dropdownUserName').textContent = p.full_name;
    document.getElementById('dropdownUserEmail').textContent = p.email;

    const initials = p.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('headerAvatar').textContent = initials;

    if (p.is_synthetic) {
      document.getElementById('syntheticNoticeBar').classList.remove('d-none');
      document.getElementById('syntheticBadge').textContent = 'Synthetic Demo Patient';
    } else {
      document.getElementById('syntheticBadge').textContent = 'Patient Account';
    }

    document.getElementById('profAgeSex').textContent = (prof.age || '—') + ' / ' + (prof.sex || '—');
    document.getElementById('profBlood').textContent = prof.blood_group || '—';
    document.getElementById('profHw').textContent = (prof.height_cm ? prof.height_cm + ' cm' : '—') + ' / ' + (prof.weight_kg ? prof.weight_kg + ' kg' : '—');
    document.getElementById('profCounts').textContent = c.documents + ' docs / ' + c.wearable_days + ' days';

    // Pre-fill profile edit modal
    document.getElementById('editAge').value = prof.age || '';
    document.getElementById('editSex').value = prof.sex || '';
    document.getElementById('editBlood').value = prof.blood_group || '';
    document.getElementById('editHeight').value = prof.height_cm || '';
    document.getElementById('editWeight').value = prof.weight_kg || '';
    document.getElementById('editNote').value = prof.emergency_note || '';

    const badgePending = document.getElementById('sidebarPendingBadge');
    const alertConsent = document.getElementById('overviewConsentAlert');
    if (c.pending_access_requests > 0) {
      badgePending.textContent = c.pending_access_requests;
      badgePending.classList.remove('d-none');
      alertConsent.classList.remove('d-none');
      alertConsent.classList.add('d-flex');
    } else {
      badgePending.classList.add('d-none');
      alertConsent.classList.add('d-none');
      alertConsent.classList.remove('d-flex');
    }

    const renderPills = (elId, items, cls) => {
      const el = document.getElementById(elId);
      if (!items.length) {
        el.innerHTML = '<span class="text-muted small">None recorded</span>';
        return;
      }
      el.innerHTML = items.map(i => `<span class="badge ${cls}">${esc(i.name)}</span>`).join('');
    };
    renderPills('overviewConditions', overviewData.summary.conditions, 'bg-navy-soft');
    renderPills('overviewMeds', overviewData.summary.medications, 'bg-teal-soft');
    renderPills('overviewAllergies', overviewData.summary.allergies, 'bg-danger bg-opacity-10 text-danger');

    const latest = overviewData.latest_observation;
    const obsEl = document.getElementById('overviewLatestObs');
    if (!latest) {
      obsEl.innerHTML = '<div class="col-12 small text-muted">No wearable observations imported yet. Go to Wearable Intelligence to import CSV/JSON data.</div>';
    } else {
      obsEl.innerHTML = `
        <div class="col-6 col-sm-3"><div class="p-2 rounded border bg-white"><small class="text-muted d-block">Resting HR</small><strong>${esc(latest.resting_hr ?? '—')} bpm</strong></div></div>
        <div class="col-6 col-sm-3"><div class="p-2 rounded border bg-white"><small class="text-muted d-block">Sleep</small><strong>${esc(latest.sleep_hours ?? '—')} hrs</strong></div></div>
        <div class="col-6 col-sm-3"><div class="p-2 rounded border bg-white"><small class="text-muted d-block">SpO2</small><strong>${esc(latest.spo2 ?? '—')}%</strong></div></div>
        <div class="col-6 col-sm-3"><div class="p-2 rounded border bg-white"><small class="text-muted d-block">Steps (${formatDate(latest.observed_at)})</small><strong>${latest.steps ? Number(latest.steps).toLocaleString() : '—'}</strong></div></div>
      `;
    }

    const insEl = document.getElementById('overviewInsightsList');
    if (!overviewData.insights.length) {
      insEl.innerHTML = '<p class="text-muted small mb-0">No baseline insights generated yet. Import at least 7 days of wearable observations.</p>';
    } else {
      insEl.innerHTML = overviewData.insights.map(ins => {
        const badgeCls = ins.severity === 'persistent_shift' ? 'bg-danger bg-opacity-10 text-danger' : ins.severity === 'attention' ? 'bg-warning bg-opacity-10 text-warning' : 'bg-teal-soft';
        return `<div class="p-3 rounded-3 border mb-2 bg-light">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <strong class="small text-navy">${esc(ins.title)}</strong>
            <span class="badge ${badgeCls}">${esc(ins.severity.replace('_', ' '))}</span>
          </div>
          <p class="small text-secondary mb-0">${esc(ins.explanation)}</p>
        </div>`;
      }).join('');
    }

    const devEl = document.getElementById('overviewDevicesList');
    devEl.innerHTML = overviewData.devices.map(d => {
      const stBadge = d.status === 'active_import'
        ? '<span class="badge bg-success bg-opacity-10 text-success">Imported (' + d.records_imported + ')</span>'
        : d.status === 'ready'
        ? '<span class="badge bg-teal-soft">Ready for Import</span>'
        : '<span class="badge bg-secondary bg-opacity-10 text-secondary">Unavailable in Web MVP</span>';
      return `<div class="d-flex justify-content-between align-items-center py-1 border-bottom small">
        <span>${esc(d.display_name)}</span>${stBadge}
      </div>`;
    }).join('');

    // Mini timeline
    const tlData = await apiFetch('/api/patient/timeline');
    const miniEl = document.getElementById('overviewTimelineMini');
    miniEl.innerHTML = '<h6 class="fw-semibold small text-navy mb-2">Recent Timeline</h6>' +
      tlData.timeline.slice(0, 4).map(t => `<div class="d-flex justify-content-between small py-1">
        <span class="text-truncate me-2"><strong>${esc(t.badge)}:</strong> ${esc(t.title)}</span>
        <span class="text-muted flex-shrink-0">${esc(t.date)}</span>
      </div>`).join('');

    // Load healthcare scheme guidance card after overview data is ready
    loadSchemeGuidance(overviewData);
  }

  /* ============================================================
   * INDIA HEALTHCARE SCHEME GUIDANCE
   * Pure front-end matching — zero API call, zero PHI transmitted
   * ============================================================ */
  const HEALTH_SCHEMES = [
    {
      id: 'pm_jay',
      name: 'Ayushman Bharat – PM-JAY',
      type: 'Central (All India)',
      typeColor: '#164975',
      description: 'Cashless secondary &amp; tertiary hospitalization coverage up to <strong>₹5 lakh/year</strong> for eligible BPL families. The <em>Vay Vandana</em> component extends coverage to all citizens aged <strong>70+</strong>, regardless of income.',
      states: ['all'],
      ageNote: age => age >= 70 ? '🔵 Senior Citizen (70+): Vay Vandana component may apply regardless of income category.' : null,
      conditionKeywords: [],
      portal: 'https://pmjay.gov.in',
      portalLabel: 'pmjay.gov.in'
    },
    {
      id: 'ntr_vaidya',
      name: 'Dr. NTR Vaidya Seva',
      type: 'Andhra Pradesh State',
      typeColor: '#0d9488',
      description: 'Cashless secondary and tertiary care at empanelled hospitals for eligible families in <strong>Andhra Pradesh</strong> (formerly YSR Aarogyasri). Covers a wide range of surgical procedures and treatments.',
      states: ['Andhra Pradesh'],
      ageNote: () => null,
      conditionKeywords: [],
      portal: 'https://ntrvaidyaseva.ap.gov.in',
      portalLabel: 'ntrvaidyaseva.ap.gov.in'
    },
    {
      id: 'aarogyasri',
      name: 'Rajiv Aarogyasri Health Care Trust',
      type: 'Telangana State',
      typeColor: '#0d9488',
      description: 'Tertiary hospitalization coverage for eligible BPL families in <strong>Telangana</strong> at government and empanelled private hospitals. Covers major surgeries, cancer treatment, cardiac procedures, and more.',
      states: ['Telangana'],
      ageNote: () => null,
      conditionKeywords: [],
      portal: 'https://aarogyasri.telangana.gov.in',
      portalLabel: 'aarogyasri.telangana.gov.in'
    },
    {
      id: 'np_ncd',
      name: 'NP-NCD – National Programme for Non-Communicable Diseases',
      type: 'Central – Condition-Specific',
      typeColor: '#6366f1',
      description: 'Free screening, monitoring, and management support for <strong>diabetes, hypertension, thyroid disorders, and cardiovascular disease</strong> at government Health &amp; Wellness Centres (HWCs) across India.',
      states: ['all'],
      ageNote: () => null,
      conditionKeywords: ['diabetes', 'hypertension', 'thyroid', 'cardiovascular', 'heart', 'glucose', 'blood pressure', 'hypothyroid', 'hyperthyroid', 'ldl', 'cholesterol', 'bp', 'cardiac', 'hba1c', 'triglyceride'],
      portal: 'https://main.mohfw.gov.in/Major-Programmes/non-communicable-diseases-injury-trauma/Non-Communicable-Disease-II/NP-NCD',
      portalLabel: 'mohfw.gov.in'
    }
  ];

  function schemeMatchesState(scheme, selectedState) {
    if (scheme.states.includes('all')) return true;
    return scheme.states.includes(selectedState);
  }

  function schemeMatchesConditions(scheme, conditionNames) {
    if (!scheme.conditionKeywords.length) return true; // universal — always show
    const lower = conditionNames.join(' ').toLowerCase();
    return scheme.conditionKeywords.some(kw => lower.includes(kw));
  }

  function renderSchemeCard(scheme, age) {
    const ageHint = scheme.ageNote(age);
    return `
      <div class="col-md-6 col-xl-3">
        <div class="p-3 rounded-3 h-100 d-flex flex-column" style="border:1px solid #e2e8f0;background:#f8fafc;">
          <div class="d-flex align-items-start gap-2 mb-2">
            <span class="badge text-white flex-shrink-0" style="background:${esc(scheme.typeColor)};font-size:.68rem;white-space:normal;text-align:left;">
              ${esc(scheme.type)}
            </span>
          </div>
          <h6 class="fw-bold mb-1 text-navy" style="font-size:.82rem;line-height:1.3;">${esc(scheme.name)}</h6>
          <p class="small text-secondary mb-2 flex-grow-1" style="font-size:.78rem;line-height:1.5;">${scheme.description}</p>
          ${ageHint ? `<p class="small mb-2" style="font-size:.74rem;color:#0d9488;">${esc(ageHint)}</p>` : ''}
          <div class="mb-2">
            <span class="badge w-100 text-center py-1" style="background:#fef3c7;color:#92400e;font-size:.68rem;white-space:normal;">
              ⚠ Potentially Eligible — Informational Guidance Only
            </span>
          </div>
          <a href="${scheme.portal}" target="_blank" rel="noopener noreferrer"
             class="btn btn-sm w-100 mt-auto"
             style="background:#0f2942;color:#fff;font-size:.74rem;padding:.3rem .6rem;">
            <i data-feather="external-link" style="width:12px;height:12px;" class="me-1"></i>
            Official Portal: ${esc(scheme.portalLabel)}
          </a>
        </div>
      </div>`;
  }

  function loadSchemeGuidance(data) {
    const container = document.getElementById('schemeGuidanceResults');
    if (!container) return;

    // Restore saved state preference
    const savedState = localStorage.getItem('medisync_state_pref') || 'Andhra Pradesh';
    const sel = document.getElementById('schemeStateSelect');
    if (sel) sel.value = savedState;

    // Extract conditions and age from overview data
    const conditions = (data && data.summary && data.summary.conditions) || [];
    const conditionNames = conditions.map(c => c.name || '');
    const age = (data && data.patient && data.patient.profile && data.patient.profile.age) || 0;

    _renderSchemes(container, savedState, conditionNames, age);
    // Re-init feather icons for newly injected SVGs
    if (window.feather) feather.replace();
  }

  function _renderSchemes(container, selectedState, conditionNames, age) {
    const matched = HEALTH_SCHEMES.filter(s =>
      schemeMatchesState(s, selectedState) && schemeMatchesConditions(s, conditionNames)
    );

    if (!matched.length) {
      container.innerHTML = '<div class="col-12 text-muted small">No specific schemes matched for the selected state and conditions. <a href="https://pmjay.gov.in" target="_blank" rel="noopener noreferrer">Visit PM-JAY portal</a> for general coverage information.</div>';
      return;
    }

    container.innerHTML = matched.map(s => renderSchemeCard(s, age)).join('');
    if (window.feather) feather.replace();
  }

  function onSchemeStateChange(val) {
    localStorage.setItem('medisync_state_pref', val);
    if (!overviewData) return;
    const conditions = (overviewData.summary && overviewData.summary.conditions) || [];
    const conditionNames = conditions.map(c => c.name || '');
    const age = (overviewData.patient && overviewData.patient.profile && overviewData.patient.profile.age) || 0;
    const container = document.getElementById('schemeGuidanceResults');
    if (container) {
      _renderSchemes(container, val, conditionNames, age);
    }
  }

  function toggleSchemeCard(btn) {
    const body = document.getElementById('schemeGuidanceBody');
    if (!body) return;
    const isVisible = body.style.display !== 'none';
    body.style.display = isVisible ? 'none' : '';
    const icon = btn.querySelector('[data-feather]');
    if (icon) {
      icon.setAttribute('data-feather', isVisible ? 'chevron-down' : 'chevron-up');
      if (window.feather) feather.replace();
    }
    btn.setAttribute('aria-expanded', String(!isVisible));
  }

  async function loadRecords() {
    recordsData = await apiFetch('/api/patient/records');
    document.getElementById('docCountBadge').textContent = recordsData.documents.length + ' documents';
    document.getElementById('downloadSampleLabBtn').href = API_BASE + '/api/samples/lab-report.pdf';

    const docTbody = document.getElementById('documentsTableBody');
    if (!recordsData.documents.length) {
      docTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No medical documents uploaded yet.</td></tr>';
    } else {
      docTbody.innerHTML = recordsData.documents.map(d => `
        <tr>
          <td><div class="fw-semibold small text-navy">${esc(d.title)}</div><small class="text-muted">${esc(d.filename)}</small></td>
          <td><span class="badge bg-navy-soft">${esc(d.document_type.replace('_', ' '))}</span></td>
          <td class="small">${esc(d.document_date || '—')}</td>
          <td><span class="badge ${d.extraction_status === 'reviewed' ? 'bg-success bg-opacity-10 text-success' : 'bg-teal-soft'}">${esc(d.extraction_status)}</span></td>
          <td class="text-nowrap">
            <button class="btn btn-sm btn-soft-primary me-1" onclick="MediSyncPatient.viewRawDoc('${esc(d.id)}')">View Source</button>
            <button class="btn btn-sm btn-outline-secondary" onclick="MediSyncPatient.reextractDoc('${esc(d.id)}')">Re-extract AI</button>
          </td>
        </tr>
      `).join('');
    }
    renderExtractedTable();
  }

  function renderExtractedTable() {
    if (!recordsData) return;
    const filter = document.getElementById('entityCategoryFilter').value;
    const items = recordsData.extracted.filter(i => filter === 'all' || i.category === filter);
    const tbody = document.getElementById('extractedTableBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No extracted entities match this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(e => `
      <tr>
        <td><span class="badge bg-navy-soft">${esc(e.category)}</span></td>
        <td class="fw-semibold small text-navy">${esc(e.name)} ${e.user_verified ? '<span class="badge bg-success bg-opacity-10 text-success ms-1">Verified</span>' : ''}</td>
        <td class="small">${esc(e.value || '—')} ${esc(e.unit || '')} ${e.reference_range ? '<br><small class="text-muted">Ref: ' + esc(e.reference_range) + '</small>' : ''}</td>
        <td class="small">${esc(e.flag || '—')}</td>
        <td class="small text-muted">${esc(e.source_reference || '—')}</td>
        <td class="small">${Math.round((e.confidence || 0.85) * 100)}%</td>
        <td><button class="btn btn-sm btn-outline-primary" onclick="MediSyncPatient.openEditEntity('${esc(e.id)}')">Review / Edit</button></td>
      </tr>
    `).join('');
  }

  async function loadWearables() {
    wearablesData = await apiFetch('/api/patient/wearables');
    document.getElementById('downloadSampleCsvLink').href = API_BASE + '/api/samples/wearable-30d.csv';
    document.getElementById('downloadSampleJsonLink').href = API_BASE + '/api/samples/wearable-7d.json';

    const grid = document.getElementById('deviceConnectorsGrid');
    grid.innerHTML = wearablesData.connectors.map(c => {
      const isAvail = c.integration_mode !== 'api_unavailable';
      const badge = c.status === 'active_import'
        ? '<span class="badge bg-success bg-opacity-10 text-success">Active (' + c.records_imported + ' readings)</span>'
        : isAvail
        ? '<span class="badge bg-teal-soft">Ready for Import</span>'
        : '<span class="badge bg-secondary bg-opacity-10 text-secondary">Unavailable in Web MVP</span>';
      return `<div class="col-md-6 col-xl-4">
        <div class="ms-kpi-card">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <strong class="small text-navy">${esc(c.display_name)}</strong>
            ${badge}
          </div>
          <p class="text-muted mb-2" style="font-size:0.78rem;">${esc(c.honest_note)}</p>
          <small class="text-muted">Last sync: ${c.last_sync_at ? esc(c.last_sync_at.slice(0, 16).replace('T', ' ')) : 'Never'}</small>
        </div>
      </div>`;
    }).join('');

    const obs = wearablesData.observations;
    const labels = obs.map(o => o.observed_at.slice(5, 10));

    destroyChart('hrTrendChart');
    charts.hrTrendChart = new Chart(document.getElementById('hrTrendChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Resting HR (bpm)', data: obs.map(o => o.resting_hr), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,0.08)', fill: true, tension: 0.3 },
          { label: 'Average HR (bpm)', data: obs.map(o => o.avg_hr), borderColor: '#0f2942', borderDash: [4, 4], tension: 0.3 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    destroyChart('sleepTrendChart');
    charts.sleepTrendChart = new Chart(document.getElementById('sleepTrendChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Total Sleep (hrs)', data: obs.map(o => o.sleep_hours), backgroundColor: '#0d9488', borderRadius: 4 },
          { label: 'Deep Sleep (hrs)', data: obs.map(o => o.deep_sleep_hours), backgroundColor: '#0f2942', borderRadius: 4 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    destroyChart('activitySpo2Chart');
    charts.activitySpo2Chart = new Chart(document.getElementById('activitySpo2Chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'SpO2 (%)', data: obs.map(o => o.spo2), borderColor: '#0284c7', yAxisID: 'y', tension: 0.3 },
          { label: 'Daily Steps', data: obs.map(o => o.steps), borderColor: '#f59e0b', yAxisID: 'y1', tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 92, max: 100, position: 'left' },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  async function loadBaseline() {
    baselineData = await apiFetch('/api/patient/baseline');
    const period = baselineData.observation_period || {};
    document.getElementById('baselinePeriodLabel').textContent = period.first_obs
      ? `Observation window: ${formatDate(period.first_obs)} to ${formatDate(period.last_obs)}`
      : 'No observations imported yet.';
    document.getElementById('baselineDaysBadge').textContent = (period.total_days || 0) + ' days observed';
    document.getElementById('baselineMethodologyNote').textContent = baselineData.methodology_note;

    const metricMeta = {
      resting_hr: { name: 'Resting Heart Rate', unit: 'bpm' },
      sleep_hours: { name: 'Sleep Duration', unit: 'hrs' },
      spo2: { name: 'Blood Oxygen (SpO2)', unit: '%' },
      hrv_ms: { name: 'Heart Rate Variability', unit: 'ms' },
      steps: { name: 'Daily Steps', unit: 'steps' }
    };

    document.getElementById('baselineMetricsGrid').innerHTML = baselineData.baselines.map(b => {
      const m = metricMeta[b.metric] || { name: b.metric, unit: '' };
      const confBadge = b.confidence_level === 'high' ? 'bg-success bg-opacity-10 text-success'
        : b.confidence_level === 'moderate' ? 'bg-warning bg-opacity-10 text-warning'
        : 'bg-secondary bg-opacity-10 text-secondary';
      return `<div class="col-md-6 col-xl">
        <div class="ms-kpi-card">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <small class="fw-bold text-navy">${esc(m.name)}</small>
            <span class="badge ${confBadge}">${esc(b.confidence_level)}</span>
          </div>
          <div class="h4 fw-bold text-navy mb-1">${b.baseline_mean !== null ? esc(b.baseline_mean) + ' ' + m.unit : 'Insufficient'}</div>
          <small class="text-muted d-block">${b.baseline_low !== null ? 'Personal range: ' + b.baseline_low + '–' + b.baseline_high + ' ' + m.unit : 'Requires 7+ days'}</small>
        </div>
      </div>`;
    }).join('');

    document.getElementById('baselineInsightsContainer').innerHTML = baselineData.insights.map(ins => {
      const cls = ins.severity === 'persistent_shift' ? 'border-danger bg-danger bg-opacity-10' : ins.severity === 'attention' ? 'border-warning bg-warning bg-opacity-10' : 'border-info bg-light';
      return `<div class="p-3 rounded-3 border ${cls} mb-3">
        <h6 class="fw-bold small text-navy mb-1">${esc(ins.title)}</h6>
        <p class="small mb-0 text-secondary">${esc(ins.explanation)}</p>
      </div>`;
    }).join('') || '<p class="text-muted small">No deviations detected.</p>';

    // Baseline band chart for sleep_hours & resting_hr
    const wData = wearablesData || await apiFetch('/api/patient/wearables');
    const obs = wData.observations;
    const sleepB = baselineData.baselines.find(b => b.metric === 'sleep_hours');
    destroyChart('baselineComparisonChart');
    if (obs.length) {
      charts.baselineComparisonChart = new Chart(document.getElementById('baselineComparisonChart'), {
        type: 'line',
        data: {
          labels: obs.map(o => o.observed_at.slice(5, 10)),
          datasets: [
            { label: 'Observed Sleep (hrs)', data: obs.map(o => o.sleep_hours), borderColor: '#0f2942', tension: 0.3, borderWidth: 2 },
            { label: 'Personal Baseline Mean', data: obs.map(() => sleepB ? sleepB.baseline_mean : null), borderColor: '#0d9488', borderDash: [6, 4], pointRadius: 0 },
            { label: 'Personal Lower Threshold', data: obs.map(() => sleepB ? sleepB.baseline_low : null), borderColor: '#f59e0b', borderDash: [3, 3], pointRadius: 0 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }

  function renderAiStructuredAnswer(ans) {
    const listHtml = items => (items && items.length)
      ? '<ul class="mb-0 ps-3 small">' + items.map(x => `<li class="mb-1">${esc(x)}</li>`).join('') + '</ul>'
      : '<p class="small text-muted mb-0">None noted.</p>';

    const providerBadge = ans.llm_provider && ans.llm_provider.startsWith('groq:')
      ? `<span class="badge bg-teal-soft mb-2">${esc(ans.llm_provider)}</span>`
      : ans.llm_provider === 'deterministic_fallback'
      ? `<span class="badge bg-warning bg-opacity-10 text-warning mb-2">Fallback Mode${ans.llm_error ? ' (' + esc(ans.llm_error.split(':')[0]) + ')' : ''}</span>`
      : '';

    return `
      <div class="ms-ai-structured">
        ${providerBadge}
        <p class="fw-medium text-navy mb-2">${esc(ans.summary)}</p>
        <div class="ms-ai-section"><h6>From Your Medical Records</h6>${listHtml(ans.from_medical_records)}</div>
        <div class="ms-ai-section"><h6>Wearable Observations</h6>${listHtml(ans.wearable_observations)}</div>
        <div class="ms-ai-section"><h6>Personal Baseline Comparison</h6>${listHtml(ans.personal_baseline_comparison)}</div>
        <div class="ms-ai-section"><h6>Possible Explanations (Non-Diagnostic)</h6>${listHtml(ans.possible_explanations)}</div>
        <div class="ms-ai-section ms-ai-missing"><h6>Missing Information &amp; Limitations</h6>${listHtml(ans.missing_information)}</div>
        ${ans.source_references && ans.source_references.length ? `<div class="mt-2 small text-muted"><strong>Sources:</strong> ${ans.source_references.map(esc).join(' · ')}</div>` : ''}
        <div class="ms-ai-disclaimer">${esc(ans.disclaimer)}</div>
      </div>
    `;
  }

  async function loadAssistant() {
    if (overviewData) {
      const c = overviewData.counts;
      document.getElementById('aiContextStats').textContent = `${c.documents} docs · ${c.wearable_days} wearable days · ${c.conditions} conditions`;
    }
    const hist = await apiFetch('/api/patient/assistant/history');
    const box = document.getElementById('aiChatMessages');
    if (!hist.conversations.length) {
      box.innerHTML = `<div class="chat-message received">
        <div class="ms-ai-structured">
          <p class="mb-1 fw-semibold text-navy">Hello! I have your permitted medical records, wearable history, and personal baseline ready.</p>
          <p class="small text-muted mb-0">Try asking: <em>"Why have I been experiencing headaches recently?"</em></p>
        </div>
      </div>`;
    } else {
      box.innerHTML = hist.conversations.map(c => `
        <div class="chat-message sent"><div class="chat-bubble">${esc(c.question)}<span class="chat-time">${esc(c.created_at.slice(0, 16).replace('T', ' '))}</span></div></div>
        <div class="chat-message received">${renderAiStructuredAnswer(c.answer)}</div>
      `).join('');
      box.scrollTop = box.scrollHeight;
    }
  }

  async function askQuestion(question) {
    const box = document.getElementById('aiChatMessages');
    const sendBtn = document.getElementById('aiSendBtn');
    sendBtn.disabled = true;
    box.insertAdjacentHTML('beforeend', `<div class="chat-message sent"><div class="chat-bubble">${esc(question)}</div></div>`);
    box.scrollTop = box.scrollHeight;
    try {
      const res = await apiFetch('/api/patient/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question })
      });
      box.insertAdjacentHTML('beforeend', `<div class="chat-message received">${renderAiStructuredAnswer(res.answer)}</div>`);
      box.scrollTop = box.scrollHeight;
    } catch (err) {
      notify(err.message, 'danger');
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function loadTimeline() {
    const data = await apiFetch('/api/patient/timeline');
    const el = document.getElementById('patientTimelineContainer');
    if (!data.timeline.length) {
      el.innerHTML = '<p class="text-muted small mb-0">No health timeline events yet.</p>';
      return;
    }
    el.innerHTML = data.timeline.map(t => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="d-flex justify-content-between flex-wrap gap-2 mb-1">
          <span class="badge bg-teal-soft">${esc(t.badge)}</span>
          <small class="text-muted">${esc(t.date)}</small>
        </div>
        <h6 class="fw-bold text-navy mb-1">${esc(t.title)}</h6>
        <p class="small text-secondary mb-0">${esc(t.description)}</p>
      </div>
    `).join('');
  }

  async function loadConsent() {
    const data = await apiFetch('/api/patient/consent');
    const reqEl = document.getElementById('consentRequestsList');
    const pending = data.requests.filter(r => r.status === 'pending');

    if (!data.requests.length) {
      reqEl.innerHTML = '<p class="text-muted small mb-0">No professional access requests received.</p>';
    } else {
      reqEl.innerHTML = data.requests.map(r => `
        <div class="p-3 rounded-3 border mb-2 ${r.status === 'pending' ? 'bg-light border-warning' : ''}">
          <div class="d-flex flex-wrap justify-content-between align-items-start gap-2">
            <div>
              <strong class="text-navy">${esc(r.professional_name)}</strong>
              <span class="badge bg-teal-soft ms-1">${esc(r.specialty || 'Clinician')}</span>
              <div class="small text-muted">Reg #: ${esc(r.registration_number || '—')} · ${esc(r.facility_name || '')}</div>
              <p class="small mb-1 mt-2"><strong>Purpose:</strong> ${esc(r.purpose)}</p>
              <div class="small text-muted">Requested scopes: ${r.requested_scopes.map(s => `<span class="badge bg-navy-soft me-1">${esc(s)}</span>`).join('')}</div>
            </div>
            <div class="d-flex gap-2">
              ${r.status === 'pending'
                ? `<button class="btn btn-sm btn-primary" onclick="MediSyncPatient.respondConsent('${esc(r.id)}','approve')">Approve (30d)</button>
                   <button class="btn btn-sm btn-outline-danger" onclick="MediSyncPatient.respondConsent('${esc(r.id)}','deny')">Deny</button>`
                : `<span class="badge bg-secondary">${esc(r.status)}</span>`
              }
            </div>
          </div>
        </div>
      `).join('');
    }

    const cBody = document.getElementById('consentsTableBody');
    cBody.innerHTML = data.consents.length ? data.consents.map(c => `
      <tr>
        <td><strong class="small text-navy">${esc(c.professional_name)}</strong><br><small class="text-muted">${esc(c.specialty || '')}</small></td>
        <td>${c.scopes.map(s => `<span class="badge bg-navy-soft me-1">${esc(s)}</span>`).join('')}</td>
        <td><span class="badge ${c.status === 'active' ? 'bg-success bg-opacity-10 text-success' : 'bg-secondary bg-opacity-10 text-secondary'}">${esc(c.status)}</span></td>
        <td class="small">${formatDate(c.granted_at)}</td>
        <td class="small">${formatDate(c.expires_at)}</td>
        <td>${c.status === 'active' ? `<button class="btn btn-sm btn-outline-danger" onclick="MediSyncPatient.revokeConsent('${esc(c.id)}')">Revoke</button>` : '—'}</td>
      </tr>
    `).join('') : '<tr><td colspan="6" class="text-center text-muted py-3">No consent grants yet.</td></tr>';

    const aBody = document.getElementById('patientAuditBody');
    aBody.innerHTML = data.access_history.map(a => `
      <tr>
        <td class="small text-muted">${esc(a.created_at.slice(0, 19).replace('T', ' '))}</td>
        <td class="small">${esc(a.actor_name || a.actor_role || 'System')}</td>
        <td><span class="badge bg-navy-soft">${esc(a.action)}</span></td>
        <td class="small text-muted">${esc(JSON.stringify(a.details))}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="text-center text-muted py-3">No audit entries yet.</td></tr>';
  }

  function bindActions() {
    document.getElementById('copyMsIdBtn').addEventListener('click', () => {
      if (overviewData) {
        navigator.clipboard?.writeText(overviewData.patient.medisync_id);
        notify('MediSync ID copied to clipboard.');
      }
    });

    document.getElementById('downloadQrBtn').addEventListener('click', () => {
      if (!overviewData) return;
      const a = document.createElement('a');
      a.href = overviewData.patient.qr_data_uri;
      a.download = overviewData.patient.medisync_id + '-qr.png';
      a.click();
    });

    document.getElementById('editProfileForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await apiFetch('/api/patient/profile', {
          method: 'PUT',
          body: JSON.stringify({
            age: document.getElementById('editAge').value ? parseInt(document.getElementById('editAge').value, 10) : null,
            sex: document.getElementById('editSex').value || null,
            blood_group: document.getElementById('editBlood').value || null,
            height_cm: document.getElementById('editHeight').value ? parseFloat(document.getElementById('editHeight').value) : null,
            weight_kg: document.getElementById('editWeight').value ? parseFloat(document.getElementById('editWeight').value) : null,
            emergency_note: document.getElementById('editNote').value || null,
          })
        });
        bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
        notify('Profile updated.');
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    // Dropzone wiring for PDF
    const pdfZone = document.getElementById('pdfDropzone');
    const pdfInput = document.getElementById('pdfFileInput');
    pdfZone.addEventListener('click', () => pdfInput.click());
    pdfZone.addEventListener('dragover', e => { e.preventDefault(); pdfZone.classList.add('dragover'); });
    pdfZone.addEventListener('dragleave', () => pdfZone.classList.remove('dragover'));
    pdfZone.addEventListener('drop', e => {
      e.preventDefault();
      pdfZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        pdfInput.files = e.dataTransfer.files;
        document.getElementById('pdfFileLabel').textContent = e.dataTransfer.files[0].name;
      }
    });
    pdfInput.addEventListener('change', () => {
      if (pdfInput.files.length) document.getElementById('pdfFileLabel').textContent = pdfInput.files[0].name;
    });

    document.getElementById('recordUploadForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!pdfInput.files.length) return notify('Please select a PDF or TXT medical file.', 'warning');
      const btn = document.getElementById('uploadDocBtn');
      btn.disabled = true;
      btn.textContent = 'Extracting...';
      try {
        const fd = new FormData();
        fd.append('file', pdfInput.files[0]);
        fd.append('title', document.getElementById('docTitle').value);
        fd.append('document_type', document.getElementById('docType').value);
        fd.append('document_date', document.getElementById('docDate').value);
        const res = await apiFetch('/api/patient/records/upload', { method: 'POST', body: fd });
        notify(`Uploaded and extracted ${res.extracted_count} clinical item(s).`);
        document.getElementById('recordUploadForm').reset();
        document.getElementById('pdfFileLabel').textContent = 'Drop PDF/TXT here or click to browse';
        await loadRecords();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Upload & Extract Information';
      }
    });

    document.getElementById('entityCategoryFilter').addEventListener('change', renderExtractedTable);

    document.getElementById('editEntityForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = document.getElementById('editEntId').value;
      try {
        await apiFetch('/api/patient/extracted/' + id, {
          method: 'PUT',
          body: JSON.stringify({
            category: document.getElementById('editEntCategory').value,
            name: document.getElementById('editEntName').value,
            value: document.getElementById('editEntValue').value,
            unit: document.getElementById('editEntUnit').value,
            flag: document.getElementById('editEntFlag').value,
            reference_range: document.getElementById('editEntRef').value,
            user_verified: true
          })
        });
        bootstrap.Modal.getInstance(document.getElementById('editEntityModal')).hide();
        notify('Extracted medical item verified and updated.');
        await loadRecords();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    document.getElementById('addEntityForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await apiFetch('/api/patient/extracted', {
          method: 'POST',
          body: JSON.stringify({
            category: document.getElementById('addEntCategory').value,
            name: document.getElementById('addEntName').value,
            value: document.getElementById('addEntValue').value || null,
            unit: document.getElementById('addEntUnit').value || null,
            observed_date: document.getElementById('addEntDate').value || null
          })
        });
        bootstrap.Modal.getInstance(document.getElementById('addEntityModal')).hide();
        document.getElementById('addEntityForm').reset();
        notify('Added manual medical history entry.');
        await loadRecords();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    // Wearable dropzone
    const wZone = document.getElementById('wearableDropzone');
    const wInput = document.getElementById('wearableFileInput');
    wZone.addEventListener('click', () => wInput.click());
    wZone.addEventListener('dragover', e => { e.preventDefault(); wZone.classList.add('dragover'); });
    wZone.addEventListener('dragleave', () => wZone.classList.remove('dragover'));
    wZone.addEventListener('drop', e => {
      e.preventDefault();
      wZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        wInput.files = e.dataTransfer.files;
        document.getElementById('wearableFileLabel').textContent = e.dataTransfer.files[0].name;
      }
    });
    wInput.addEventListener('change', () => {
      if (wInput.files.length) document.getElementById('wearableFileLabel').textContent = wInput.files[0].name;
    });

    document.getElementById('wearableUploadForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!wInput.files.length) return notify('Select a CSV or JSON wearable file first.', 'warning');
      const fd = new FormData();
      fd.append('file', wInput.files[0]);
      try {
        const res = await apiFetch('/api/patient/wearables/import', { method: 'POST', body: fd });
        notify(`Imported ${res.imported_count} wearable readings and updated your personal baseline.`);
        await loadWearables();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    document.getElementById('importSampleJsonBtn').addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/patient/wearables/import-sample?format_type=json', { method: 'POST' });
        notify(`Imported ${res.imported_count} synthetic JSON readings.`);
        await loadWearables();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    document.getElementById('importSampleCsvBtn').addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/patient/wearables/import-sample?format_type=csv', { method: 'POST' });
        notify(`Imported ${res.imported_count} synthetic CSV readings.`);
        await loadWearables();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });

    document.getElementById('aiChatForm').addEventListener('submit', async e => {
      e.preventDefault();
      const inp = document.getElementById('aiQuestionInput');
      const q = inp.value.trim();
      if (!q) return;
      inp.value = '';
      await askQuestion(q);
    });

    document.getElementById('addEventForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await apiFetch('/api/patient/events', {
          method: 'POST',
          body: JSON.stringify({
            event_type: document.getElementById('evType').value,
            title: document.getElementById('evTitle').value,
            event_date: document.getElementById('evDate').value,
            description: document.getElementById('evDesc').value,
          })
        });
        bootstrap.Modal.getInstance(document.getElementById('addEventModal')).hide();
        document.getElementById('addEventForm').reset();
        notify('Health event added to timeline.');
        await loadTimeline();
      } catch (err) {
        notify(err.message, 'danger');
      }
    });
  }

  window.MediSyncPatient = {
    switchView,
    viewRawDoc: async function (docId) {
      try {
        const doc = await apiFetch('/api/patient/records/' + docId + '/raw');
        document.getElementById('rawDocTitle').textContent = doc.title + ' (' + doc.filename + ')';
        document.getElementById('rawDocContent').textContent = doc.raw_text || '';
        new bootstrap.Modal(document.getElementById('rawDocModal')).show();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },
    reextractDoc: async function (docId) {
      try {
        const res = await apiFetch('/api/patient/records/' + docId + '/reextract', { method: 'POST' });
        notify(`Re-extracted ${res.extracted_count} structured medical item(s).`);
        await loadRecords();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },
    openEditEntity: function (itemId) {
      const item = recordsData.extracted.find(x => x.id === itemId);
      if (!item) return;
      document.getElementById('editEntId').value = item.id;
      document.getElementById('editEntCategory').value = item.category;
      document.getElementById('editEntName').value = item.name;
      document.getElementById('editEntValue').value = item.value || '';
      document.getElementById('editEntUnit').value = item.unit || '';
      document.getElementById('editEntFlag').value = item.flag || '';
      document.getElementById('editEntRef').value = item.reference_range || '';
      new bootstrap.Modal(document.getElementById('editEntityModal')).show();
    },
    askQuickPrompt: function (q) {
      document.getElementById('aiQuestionInput').value = q;
      askQuestion(q);
    },
    respondConsent: async function (requestId, decision) {
      try {
        await apiFetch('/api/patient/consent/respond', {
          method: 'POST',
          body: JSON.stringify({ request_id: requestId, decision, expires_days: 30 })
        });
        notify('Access request ' + (decision === 'approve' ? 'approved' : 'denied') + '.');
        await loadConsent();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },
    revokeConsent: async function (consentId) {
      try {
        await apiFetch('/api/patient/consent/' + consentId + '/revoke', { method: 'POST' });
        notify('Professional access revoked immediately.');
        await loadConsent();
        await loadOverview();
      } catch (err) {
        notify(err.message, 'danger');
      }
    },
    onSchemeStateChange,
    toggleSchemeCard
  };

  (async function init() {
    currentUser = await requireAuthRole('patient');
    if (!currentUser) return;
    bindNavigation();
    bindActions();
    await loadOverview();
    refreshIcons();
  })();
})();
