/* ============================================================
   BootUI - Admin Dashboard JavaScript v1.1.0
   ============================================================ */

(function () {
  'use strict';

  const sidebar = document.querySelector('.sidebar');
  const appWrapper = document.querySelector('.app-wrapper');
  const backdrop = document.querySelector('.backdrop-overlay');

  /* ============================================================
     1. SIDEBAR TOGGLE
     ============================================================ */
  const sidebarToggle = document.querySelector('.sidebar-toggle');

  var scrollPos = 0;
  function lockBodyScroll(lock) {
    if (lock) {
      scrollPos = window.pageYOffset;
      document.body.classList.add('sidebar-open');
      document.body.style.top = -scrollPos + 'px';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.classList.remove('sidebar-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollPos);
    }
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      if (window.innerWidth < 992) {
        sidebar?.classList.toggle('show');
        backdrop?.classList.toggle('show');
        lockBodyScroll(sidebar?.classList.contains('show'));
      } else {
        appWrapper?.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', appWrapper.classList.contains('sidebar-collapsed'));
      }
    });

    // Restore sidebar state on desktop
    if (window.innerWidth >= 992 && localStorage.getItem('sidebar-collapsed') === 'true') {
      appWrapper?.classList.add('sidebar-collapsed');
    }
  }

  /* ============================================================
     2. SIDEBAR SUBMENU (Expanded mode)
     ============================================================ */
  document.querySelectorAll('.menu-item.has-submenu > .menu-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      // Only toggle in expanded mode
      if (appWrapper?.classList.contains('sidebar-collapsed') && window.innerWidth >= 992) return;

      const parent = this.parentElement;
      // Close sibling submenus
      parent.parentElement.querySelectorAll(':scope > .menu-item.open').forEach(function (item) {
        if (item !== parent) item.classList.remove('open');
      });
      parent.classList.toggle('open');
    });
  });

  // Auto-open active submenu
  document.querySelectorAll('.submenu .menu-link.active').forEach(function (link) {
    let parent = link.closest('.menu-item.has-submenu');
    while (parent) {
      parent.classList.add('open');
      parent = parent.parentElement.closest('.menu-item.has-submenu');
    }
  });

  /* ============================================================
     2B. COLLAPSED SIDEBAR FLYOUT POSITIONING
     ============================================================ */
  document.querySelectorAll('.menu-item.has-submenu').forEach(function (item) {
    item.addEventListener('mouseenter', function () {
      if (!appWrapper?.classList.contains('sidebar-collapsed') || window.innerWidth < 992) return;
      const submenu = this.querySelector(':scope > .submenu');
      if (!submenu) return;
      const rect = this.getBoundingClientRect();
      submenu.style.top = Math.min(rect.top, window.innerHeight - submenu.offsetHeight - 10) + 'px';
    });
  });

  /* ============================================================
     3. BACKDROP CLOSE
     ============================================================ */
  backdrop?.addEventListener('click', function () {
    sidebar?.classList.remove('show');
    backdrop.classList.remove('show');
    lockBodyScroll(false);
    // Close all header dropdowns
    document.querySelectorAll('.header-dropdown .dropdown-menu.show').forEach(function (m) {
      m.classList.remove('show');
    });
  });

  /* ============================================================
     3B. CLOSE SIDEBAR ON MOBILE MENU CLICK
     ============================================================ */
  if (sidebar) {
    sidebar.addEventListener('click', function (e) {
      if (window.innerWidth >= 992) return;
      var link = e.target.closest('a.menu-link[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      // Only close for real page links, not "#" submenu toggles
      if (href && href !== '#') {
        e.preventDefault();
        sidebar.classList.remove('show');
        backdrop?.classList.remove('show');
        lockBodyScroll(false);
        setTimeout(function () {
          window.location.href = href;
        }, 300);
      }
    });
  }

  /* ============================================================
     4. HEADER DROPDOWNS
     ============================================================ */
  document.querySelectorAll('.header-dropdown > .header-btn, .header-dropdown > .header-user').forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const menu = this.parentElement.querySelector('.dropdown-menu');
      const isOpen = menu?.classList.contains('show');

      // Close all open dropdowns
      document.querySelectorAll('.header-dropdown .dropdown-menu.show').forEach(function (m) {
        m.classList.remove('show');
      });

      if (!isOpen && menu) {
        menu.classList.add('show');
      }
    });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.header-dropdown')) {
      document.querySelectorAll('.header-dropdown .dropdown-menu.show').forEach(function (m) {
        m.classList.remove('show');
      });
    }
  });

  /* ============================================================
     5. TOOLTIPS & POPOVERS (Bootstrap)
     ============================================================ */
  if (typeof bootstrap !== 'undefined') {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
      new bootstrap.Tooltip(el);
    });
    document.querySelectorAll('[data-bs-toggle="popover"]').forEach(function (el) {
      new bootstrap.Popover(el);
    });
  }

  /* ============================================================
     7. COUNTER ANIMATION
     ============================================================ */
  function animateCounter(element) {
    const target = parseInt(element.getAttribute('data-count'));
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(target * eased);
      element.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(update);
      else element.textContent = target.toLocaleString();
    }
    requestAnimationFrame(update);
  }

  const counterObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  });
  document.querySelectorAll('[data-count]').forEach(function (el) {
    counterObserver.observe(el);
  });

  /* ============================================================
     8. SEARCH SHORTCUT (Ctrl+K)
     ============================================================ */
  const searchInput = document.querySelector('.header-search input');
  if (searchInput) {
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === 'Escape') searchInput.blur();
    });
  }

  /* ============================================================
     9. TABLE SELECT ALL
     ============================================================ */
  document.querySelectorAll('.select-all').forEach(function (selectAll) {
    selectAll.addEventListener('change', function () {
      const table = this.closest('table');
      table?.querySelectorAll('.select-row').forEach(function (cb) {
        cb.checked = selectAll.checked;
      });
    });
  });

  /* ============================================================
     10. FORM VALIDATION
     ============================================================ */
  document.querySelectorAll('.needs-validation').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!form.checkValidity()) {
        e.preventDefault();
        e.stopPropagation();
      }
      form.classList.add('was-validated');
    });
  });

  /* ============================================================
     11. WINDOW RESIZE
     ============================================================ */
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (window.innerWidth >= 992) {
        sidebar?.classList.remove('show');
        backdrop?.classList.remove('show');
        lockBodyScroll(false);
      }
    }, 250);
  });

  /* ============================================================
     12. INIT
     ============================================================ */
  /* ============================================================
     12. FEATHER ICONS
     ============================================================ */
  if (typeof feather !== 'undefined') {
    feather.replace();
    // Re-run on offcanvas show
    document.querySelectorAll('.offcanvas').forEach(function (el) {
      el.addEventListener('shown.bs.offcanvas', function () { feather.replace(); });
    });
  }

  /* ============================================================
     13. INIT
     ============================================================ */
  console.log('%c BootUI Admin %c v1.1.0 ', 'background:#4f46e5;color:#fff;border-radius:3px 0 0 3px;padding:2px 6px;', 'background:#1e293b;color:#fff;border-radius:0 3px 3px 0;padding:2px 6px;');


  /* ============================================================
     PAGE-SPECIFIC SCRIPTS
     ============================================================ */

  /* --- auth-2fa --- */
  if (document.querySelector('.otp-inputs')) {
    const otpInputs = document.querySelectorAll('.otp-inputs input');
            otpInputs.forEach((input, index) => {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[^0-9]/g, '');
                    if (this.value && index < otpInputs.length - 1) {
                        otpInputs[index + 1].focus();
                    }
                });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Backspace' && !this.value && index > 0) {
                        otpInputs[index - 1].focus();
                    }
                });
                input.addEventListener('paste', function(e) {
                    e.preventDefault();
                    const paste = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
                    paste.split('').forEach((char, i) => {
                        if (otpInputs[index + i]) {
                            otpInputs[index + i].value = char;
                        }
                    });
                    const nextIndex = Math.min(index + paste.length, otpInputs.length - 1);
                    otpInputs[nextIndex].focus();
                });
            });
  }

  /* --- auth-login --- */
  if (document.querySelector('#login-password')) {
    function togglePassword(inputId, btn) {
                const input = document.getElementById(inputId);
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
                } else {
                    input.type = 'password';
                    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                }
            }
  }

  /* --- auth-reset --- */
  if (document.querySelector('#new-password')) {
    const passwordInput = document.getElementById('new-password');
            const requirements = document.querySelectorAll('.password-req li');
            const checks = [
                value => value.length >= 8,
                value => /[A-Z]/.test(value),
                value => /[0-9]/.test(value),
                value => /[^A-Za-z0-9]/.test(value)
            ];
            passwordInput.addEventListener('input', function() {
                checks.forEach((check, i) => {
                    requirements[i].classList.toggle('valid', check(this.value));
                });
            });
  }

  /* --- chart-bar --- */
  if (document.querySelector('#barVertical')) {
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    new Chart(document.getElementById('barVertical'),{type:'bar',data:{labels:months,datasets:[{label:'Sales ($)',data:[18500,22100,19800,25200,28900,32100,29800,34500,38200,35800,41500,46200],backgroundColor:'rgba(79,70,229,0.8)',borderRadius:6}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
    new Chart(document.getElementById('barHorizontal'),{type:'bar',data:{labels:['MacBook Pro','iPhone 15','iPad Air','AirPods Pro','Apple Watch'],datasets:[{label:'Units Sold',data:[4520,8900,3200,12400,5600],backgroundColor:['#4f46e5','#22c55e','#f59e0b','#ef4444','#8b5cf6'],borderRadius:6}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});
    new Chart(document.getElementById('barStacked'),{type:'bar',data:{labels:['Q1','Q2','Q3','Q4'],datasets:[{label:'North America',data:[45000,52000,48000,62000],backgroundColor:'#4f46e5',borderRadius:4},{label:'Europe',data:[32000,38000,35000,41000],backgroundColor:'#22c55e',borderRadius:4},{label:'Asia Pacific',data:[28000,34000,31000,38000],backgroundColor:'#f59e0b',borderRadius:4},{label:'Other',data:[12000,15000,13000,18000],backgroundColor:'#8b5cf6',borderRadius:4}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{x:{stacked:true},y:{stacked:true,ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
    new Chart(document.getElementById('barGrouped'),{type:'bar',data:{labels:months,datasets:[{label:'2025',data:[15000,18000,16000,22000,25000,28000,26000,30000,34000,31000,36000,40000],backgroundColor:'rgba(79,70,229,0.7)',borderRadius:4},{label:'2026',data:[18500,22100,19800,25200,28900,32100,29800,34500,38200,35800,41500,46200],backgroundColor:'rgba(34,197,94,0.7)',borderRadius:4}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
  }

  /* --- chart-line --- */
  if (document.querySelector('#lineBasic')) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    new Chart(document.getElementById('lineBasic'),{type:'line',data:{labels:months,datasets:[{label:'Revenue ($)',data:[28500,32100,29800,35200,38900,42100,39800,44500,48200,45800,51500,56200],borderColor:'#4f46e5',backgroundColor:'rgba(79,70,229,0.05)',tension:0.4,borderWidth:2,pointRadius:4,pointBackgroundColor:'#4f46e5'}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
    new Chart(document.getElementById('lineMulti'),{type:'line',data:{labels:months,datasets:[{label:'Revenue',data:[45000,52000,48000,62000,59000,71000,68000,75000,82000,78000,85000,92000],borderColor:'#4f46e5',tension:0.4,borderWidth:2},{label:'Expenses',data:[32000,35000,33000,38000,36000,42000,40000,43000,45000,42000,47000,49000],borderColor:'#ef4444',tension:0.4,borderWidth:2},{label:'Profit',data:[13000,17000,15000,24000,23000,29000,28000,32000,37000,36000,38000,43000],borderColor:'#22c55e',tension:0.4,borderWidth:2}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
    new Chart(document.getElementById('lineArea'),{type:'line',data:{labels:months,datasets:[{label:'Sessions',data:[12400,14200,13100,16800,18500,21200,19800,22400,25100,23500,27800,31200],borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.15)',fill:true,tension:0.4,borderWidth:2}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}});
    new Chart(document.getElementById('lineStepped'),{type:'line',data:{labels:months,datasets:[{label:'Active Users',data:[1200,1200,1450,1450,1800,1800,1800,2100,2100,2400,2400,2800],borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,0.1)',fill:true,stepped:true,borderWidth:2}]},options:{responsive:true,plugins:{legend:{position:'bottom'}}}});
  }

  /* --- chart-mixed --- */
  if (document.querySelector('#mixedBarLine')) {
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    new Chart(document.getElementById('mixedBarLine'),{data:{labels:months,datasets:[{type:'bar',label:'Revenue',data:[28500,32100,29800,35200,38900,42100,39800,44500,48200,45800,51500,56200],backgroundColor:'rgba(79,70,229,0.6)',borderRadius:6,order:2},{type:'line',label:'Trend',data:[27000,30000,31000,34000,37000,40000,41000,43000,46000,47000,50000,54000],borderColor:'#ef4444',borderWidth:2,tension:0.4,pointRadius:3,order:1}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v.toLocaleString()}}}}});
    new Chart(document.getElementById('mixedMultiAxis'),{data:{labels:months,datasets:[{type:'bar',label:'Orders',data:[156,189,172,215,234,267,248,289,312,295,334,365],backgroundColor:'rgba(34,197,94,0.6)',borderRadius:4,yAxisID:'y'},{type:'line',label:'Avg Order Value ($)',data:[182,170,173,164,166,158,161,154,155,155,154,154],borderColor:'#f59e0b',borderWidth:2,tension:0.4,yAxisID:'y1'}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{y:{type:'linear',position:'left',beginAtZero:true},y1:{type:'linear',position:'right',grid:{drawOnChartArea:false}}}}});
    new Chart(document.getElementById('scatterPlot'),{type:'scatter',data:{datasets:[{label:'Electronics',data:[{x:29,y:4.5},{x:49,y:4.2},{x:99,y:4.7},{x:149,y:4.3},{x:199,y:4.6},{x:299,y:4.8},{x:499,y:4.4},{x:799,y:4.9}],backgroundColor:'#4f46e5',pointRadius:8},{label:'Clothing',data:[{x:19,y:3.8},{x:35,y:4.0},{x:59,y:4.1},{x:89,y:4.3},{x:129,y:4.5},{x:179,y:4.2}],backgroundColor:'#22c55e',pointRadius:8},{label:'Books',data:[{x:9,y:4.0},{x:15,y:4.3},{x:25,y:4.5},{x:35,y:4.1},{x:45,y:4.6}],backgroundColor:'#f59e0b',pointRadius:8}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{x:{title:{display:true,text:'Price ($)'}},y:{title:{display:true,text:'Rating'},min:3,max:5}}}});
    new Chart(document.getElementById('bubbleChart'),{type:'bubble',data:{datasets:[{label:'North America',data:[{x:15,y:45,r:25},{x:22,y:38,r:18},{x:8,y:52,r:30}],backgroundColor:'rgba(79,70,229,0.6)'},{label:'Europe',data:[{x:28,y:35,r:20},{x:18,y:42,r:15},{x:35,y:28,r:22}],backgroundColor:'rgba(34,197,94,0.6)'},{label:'Asia',data:[{x:12,y:55,r:35},{x:30,y:48,r:28},{x:25,y:32,r:16}],backgroundColor:'rgba(245,158,11,0.6)'}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},scales:{x:{title:{display:true,text:'Market Maturity'}},y:{title:{display:true,text:'Growth Rate (%)'}}}}});
  }

  /* --- chart-pie --- */
  if (document.querySelector('#pieBasic')) {
    new Chart(document.getElementById('pieBasic'),{type:'pie',data:{labels:['Organic Search','Direct','Social Media','Referral','Email','Paid Ads'],datasets:[{data:[35,25,18,12,6,4],backgroundColor:['#4f46e5','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4'],borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,plugins:{legend:{position:'bottom'}}}});
    new Chart(document.getElementById('pieDoughnut'),{type:'doughnut',data:{labels:['Desktop','Mobile','Tablet','Smart TV','Other'],datasets:[{data:[45,35,12,5,3],backgroundColor:['#4f46e5','#22c55e','#f59e0b','#ef4444','#8b5cf6'],borderWidth:3,borderColor:'#fff'}]},options:{responsive:true,plugins:{legend:{position:'bottom'}},cutout:'60%'}});
    new Chart(document.getElementById('piePolar'),{type:'polarArea',data:{labels:['Engineering','Marketing','Sales','Design','Support','HR'],datasets:[{data:[120000,85000,95000,65000,55000,45000],backgroundColor:['rgba(79,70,229,0.7)','rgba(34,197,94,0.7)','rgba(245,158,11,0.7)','rgba(239,68,68,0.7)','rgba(139,92,246,0.7)','rgba(6,182,212,0.7)']}]},options:{responsive:true,plugins:{legend:{position:'bottom'}}}});
    new Chart(document.getElementById('pieHalf'),{type:'doughnut',data:{labels:['Achieved','Remaining'],datasets:[{data:[78,22],backgroundColor:['#4f46e5','#e5e7eb'],borderWidth:0}]},options:{responsive:true,rotation:-90,circumference:180,cutout:'75%',plugins:{legend:{display:false}}}});
  }

  /* --- coming-soon --- */
  if (document.querySelector('#days')) {
    // Countdown Timer - set target 42 days from now
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 42);
    
    function updateCountdown() {
        const now = new Date().getTime();
        const distance = targetDate.getTime() - now;
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        document.getElementById('days').textContent = String(days).padStart(2, '0');
        document.getElementById('hours').textContent = String(hours).padStart(2, '0');
        document.getElementById('minutes').textContent = String(minutes).padStart(2, '0');
        document.getElementById('seconds').textContent = String(seconds).padStart(2, '0');
    }
    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  /* --- crm-deals --- */
  if (document.querySelector('#dealStageChart')) {
    new Chart(document.getElementById('dealStageChart'), {
          type: 'doughnut',
          data: {
            labels: ['Discovery', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
            datasets: [{ data: [15, 18, 12, 14, 8], backgroundColor: ['#4f46e5','#06b6d4','#f59e0b','#22c55e','#ef4444'], borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });

        new Chart(document.getElementById('revenueChart'), {
          type: 'line',
          data: {
            labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
            datasets: [{
              label: 'Revenue',
              data: [85000,92000,78000,125000,145000,112000,98000,156000,134000,168000,142000,180000],
              borderColor: '#4f46e5',
              backgroundColor: 'rgba(79,70,229,0.1)',
              fill: true,
              tension: 0.4,
              borderWidth: 2
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + (v/1000) + 'K' } } } }
        });
  }

  /* --- crm-leads --- */
  if (document.querySelector('#leadSourceChart')) {
    // Lead Source Chart
        new Chart(document.getElementById('leadSourceChart'), {
          type: 'doughnut',
          data: {
            labels: ['Website', 'Social Media', 'Referral', 'Cold Call'],
            datasets: [{
              data: [120, 85, 92, 45],
              backgroundColor: ['#4f46e5', '#06b6d4', '#22c55e', '#64748b'],
              borderWidth: 0
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });

        // Lead Funnel Chart
        new Chart(document.getElementById('leadFunnelChart'), {
          type: 'bar',
          data: {
            labels: ['Total Leads', 'Contacted', 'Qualified', 'Proposal', 'Converted'],
            datasets: [{
              label: 'Leads',
              data: [342, 245, 128, 76, 45],
              backgroundColor: ['#4f46e5', '#818cf8', '#06b6d4', '#22c55e', '#f59e0b'],
              borderRadius: 8
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
  }

  /* --- dashboard-analytics --- */
  if (document.querySelector('#audienceChart')) {
    // Audience Chart
    const audCtx = document.getElementById('audienceChart');
    if (audCtx) {
        new Chart(audCtx, {
            type: 'line',
            data: {
                labels: Array.from({length: 31}, (_, i) => i + 1),
                datasets: [{
                    label: 'Users',
                    data: [700,680,720,750,710,690,730,720,680,700,730,710,690,720,700,680,710,750,780,800,820,850,830,860,840,870,890,900,880,910,930],
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.05)',
                    fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0
                }, {
                    label: 'Sessions',
                    data: [500,520,540,560,580,550,530,510,520,540,560,550,530,520,540,560,570,580,590,600,580,590,610,620,600,610,630,640,620,630,650],
                    borderColor: '#8b5cf6',
                    borderDash: [5, 5],
                    backgroundColor: 'rgba(139,92,246,0.05)',
                    fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' }, maxTicksLimit: 16 } },
                    y: { grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false }, ticks: { font: { size: 11, family: 'Inter' } } }
                }
            }
        });
    }
    
    // Bounce Rate Sparkline
    const brCtx = document.getElementById('bounceSparkline');
    if (brCtx) {
        new Chart(brCtx, {
            type: 'line',
            data: { labels: ['','','','','','',''], datasets: [{ data: [35,33,36,32,34,33,33.5], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
    }
    
    // Users Bar Sparkline
    const ubCtx = document.getElementById('usersBarSparkline');
    if (ubCtx) {
        new Chart(ubCtx, {
            type: 'bar',
            data: { labels: ['','','','','','',''], datasets: [{ data: [12,15,11,14,16,13,14], backgroundColor: '#f97316', borderRadius: 2, barPercentage: 0.6 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
    }
    
    // Sessions Stacked Bar Sparkline
    const sbCtx = document.getElementById('sessionsBarSparkline');
    if (sbCtx) {
        new Chart(sbCtx, {
            type: 'bar',
            data: { labels: ['','','','','','',''], datasets: [{ data: [8,12,10,14,11,9,13], backgroundColor: '#8b5cf6', borderRadius: 2, barPercentage: 0.5 }, { data: [5,7,6,8,7,5,8], backgroundColor: '#f97316', borderRadius: 2, barPercentage: 0.5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, stacked: true } }, interaction: { intersect: false } }
        });
    }
    
    // Website Traffic - Line Chart (2 datasets, 12 months)
    new Chart(document.getElementById('trafficChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
            datasets: [{
                label: 'Users',
                data: [12400,14200,13800,15600,16900,18200,17400,19800,21200,20600,22400,24100],
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.08)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            },{
                label: 'Sessions',
                data: [18600,20100,19400,22300,24500,26800,25200,28400,30100,29200,31800,34200],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.06)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#10b981',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                borderDash: [5,3]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 20, font: { size: 11 } } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 } } },
                y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 11 } } }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Traffic Sources - Doughnut Chart
    new Chart(document.getElementById('sourceChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Direct','Organic','Referral','Social'],
            datasets: [{
                data: [35, 40, 15, 10],
                backgroundColor: ['#4f46e5','#10b981','#f59e0b','#ef4444'],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: { legend: { display: false } }
        }
    });
    
    // Session by Device - Horizontal Bar Chart
    new Chart(document.getElementById('deviceChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Desktop','Mobile','Tablet'],
            datasets: [{
                label: 'Sessions',
                data: [58, 34, 8],
                backgroundColor: ['rgba(79,70,229,0.7)','rgba(16,185,129,0.7)','rgba(245,158,11,0.7)'],
                borderColor: ['#4f46e5','#10b981','#f59e0b'],
                borderWidth: 1.5,
                borderRadius: 6,
                barThickness: 28
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: function(v){ return v + '%'; }, font: { size: 11 } } },
                y: { grid: { display: false }, ticks: { font: { size: 11, weight: 500 } } }
            }
        }
    });
    
    // Browser Stats - Pie Chart
    new Chart(document.getElementById('browserChart').getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Chrome','Safari','Firefox','Edge'],
            datasets: [{
                data: [52, 22, 15, 11],
                backgroundColor: ['#4f46e5','#06b6d4','#f59e0b','#ef4444'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11 } } } }
        }
    });
  }

  /* --- dashboard-crm --- */
  if (document.querySelector('#pipelineChart')) {
    // Pipeline Stages - Bar Chart
    new Chart(document.getElementById('pipelineChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Discovery','Qualification','Proposal','Negotiation','Closed Won'],
            datasets: [{
                label: 'Deal Value ($K)',
                data: [180, 245, 320, 195, 284],
                backgroundColor: ['#06b6d4','#4f46e5','#f59e0b','#8b5cf6','#10b981'],
                borderRadius: 8,
                borderSkipped: false,
                barThickness: 24
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: function(v){ return '$' + v + 'K'; } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
    
    // Revenue Trend - Line Chart with Fill
    new Chart(document.getElementById('revenueTrend').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
            datasets: [{
                label: 'Revenue',
                data: [42, 58, 65, 72, 68, 85, 92, 88, 95, 102, 110, 124],
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.08)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: function(v){ return '$' + v + 'K'; } } },
                x: { grid: { display: false } }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Lead Sources - Doughnut Chart
    new Chart(document.getElementById('leadSource').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Website','Referral','Social','Email'],
            datasets: [{
                data: [38, 28, 20, 14],
                backgroundColor: ['#4f46e5','#10b981','#f59e0b','#ef4444'],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: { legend: { display: false } }
        }
    });
  }

  /* --- dashboard-education --- */
  if (document.querySelector('#enrollmentChart')) {
    // Enrollment Chart - Bar
    const enCtx = document.getElementById('enrollmentChart');
    if (enCtx) {
        new Chart(enCtx, {
            type: 'bar',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [
                    { label: 'New', data: [120,150,180,220,250,280,310,290,260,300,340,380], backgroundColor: '#4f46e5', borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.7 },
                    { label: 'Returning', data: [80,100,120,140,160,180,200,190,170,200,220,250], backgroundColor: '#f97316', borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.7 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } },
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } }
                }
            }
        });
    }
    
    // Enrollment Trend (row 3) - second chart with same data, larger
    var enTrendCtx = document.getElementById('enrollmentTrendChart');
    if (enTrendCtx) {
        new Chart(enTrendCtx, {
            type: 'line',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [
                    { label: 'New Enrollments', data: [120,150,180,220,250,280,310,290,260,300,340,380], borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3 },
                    { label: 'Returning Students', data: [80,100,120,140,160,180,200,190,170,200,220,250], borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } },
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } }
                }
            }
        });
    }

    // Course Categories - Donut chart
    new Chart(document.getElementById('categoryChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Web Dev','Data Science','Design','Business','Other'],
            datasets: [{ data: [35,25,20,12,8], backgroundColor: ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6'], borderWidth: 0 }]
        },
        options: { responsive:true, maintainAspectRatio:false, cutout:'68%', plugins:{legend:{display:false}} }
    });
    
    // Revenue from Courses - Line chart
    (function(){
        var ctx = document.getElementById('revenueChart').getContext('2d');
        var grad = ctx.createLinearGradient(0,0,0,260);
        grad.addColorStop(0,'rgba(79,70,229,0.25)'); grad.addColorStop(1,'rgba(79,70,229,0)');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'],
                datasets: [{
                    label: 'Revenue ($K)', data: [28,42,38,35,52,48,56,62],
                    borderColor:'#4f46e5', backgroundColor:grad, fill:true, tension:0.4, borderWidth:2, pointRadius:3
                }]
            },
            options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.05)'}},x:{grid:{display:false}}} }
        });
    })();
  }

  /* --- dashboard-finance --- */
  if (document.querySelector('#balanceChart')) {
    // Balance Chart
    const balCtx = document.getElementById('balanceChart');
    if (balCtx) {
        new Chart(balCtx, { type: 'line', data: { labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul'],
            datasets: [{ data: [200,180,250,320,280,240,200], borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0 },
            { data: [150,160,170,180,200,220,180], borderColor: '#e2e8f0', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } }, y: { display: false } } } });
    }
    
    // ROI Chart
    const roiCtx = document.getElementById('roiChart');
    if (roiCtx) {
        new Chart(roiCtx, { type: 'bar', data: { labels: ['JAN','FEB','MAR','APR','MAY','JUN'],
            datasets: [{ data: [20,45,30,25,35,28], backgroundColor: function(ctx) { return ctx.dataIndex === 1 ? '#06b6d4' : '#e0e0e0'; }, borderRadius: 4, barPercentage: 0.5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' } } }, y: { display: false } } } });
    }
    
    // Revenue vs Expense - Grouped Bar
    new Chart(document.getElementById('revenueExpense').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
            datasets: [{
                label: 'Revenue',
                data: [48000, 52000, 61000, 55000, 58000, 64000, 59000, 67000],
                backgroundColor: '#4f46e5',
                borderRadius: 4
            }, {
                label: 'Expense',
                data: [22000, 25000, 28000, 24000, 26000, 29000, 23000, 27000],
                backgroundColor: '#ef4444',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20 } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: v => '$' + (v/1000) + 'k' } }, x: { grid: { display: false } } },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Income Sources - Doughnut
    new Chart(document.getElementById('incomeSource').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Investments', 'Sales', 'Services', 'Subscriptions'],
            datasets: [{ data: [38, 28, 22, 12], backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#06b6d4'], borderWidth: 0, spacing: 3 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
    });
    
    // Cash Flow - Line 2 datasets
    new Chart(document.getElementById('cashFlow').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Inflow',
                data: [85000, 92000, 105000, 98000, 112000, 108000],
                borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#10b981'
            }, {
                label: 'Outflow',
                data: [42000, 38000, 45000, 40000, 48000, 42000],
                borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#ef4444'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20 } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: v => '$' + (v/1000) + 'k' } }, x: { grid: { display: false } } },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Expense Categories - Pie
    new Chart(document.getElementById('expensePie').getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Salaries', 'Marketing', 'Infrastructure', 'Travel', 'Other'],
            datasets: [{ data: [45, 20, 15, 10, 10], backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'], borderWidth: 0, spacing: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 15 } } } }
    });
  }

  /* --- dashboard-healthcare --- */
  if (document.querySelector('#patientVisitsChart')) {
    // Patient Visits Chart
    const pvCtx = document.getElementById('patientVisitsChart');
    if (pvCtx) {
        new Chart(pvCtx, { type: 'line', data: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
            datasets: [{ label: 'OPD', data: [20,50,180,280,350,400,320], borderColor: '#8b5cf6', borderDash: [5,5], backgroundColor: 'rgba(139,92,246,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0 },
            { label: 'Emergency', data: [10,30,40,60,80,90,100], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.05)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } } } } });
    }
    
    // Admissions Sparkline
    const adCtx = document.getElementById('admissionsSparkline');
    if (adCtx) {
        new Chart(adCtx, { type: 'line', data: { labels: ['','','','','','',''], datasets: [{ data: [280,320,300,350,380,360,386], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } } });
    }
    
    // Surgeries Sparkline (bars)
    const suCtx = document.getElementById('surgeriesSparkline');
    if (suCtx) {
        new Chart(suCtx, { type: 'bar', data: { labels: ['','','','','','',''], datasets: [{ data: [18,24,20,28,22,16,20], backgroundColor: '#ef4444', borderRadius: 3, barPercentage: 0.5 }, { data: [12,16,14,18,15,11,14], backgroundColor: '#8b5cf6', borderRadius: 3, barPercentage: 0.5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } } });
    }
    
    // Revenue Mini Donut
    const rvCtx = document.getElementById('revenueDonut');
    if (rvCtx) {
        new Chart(rvCtx, { type: 'doughnut', data: { labels: ['OPD','IPD','Surgery'], datasets: [{ data: [45,30,25], backgroundColor: ['#06b6d4','#8b5cf6','#f472b6'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } } });
    }
    
    // Patient Flow Area Chart
    new Chart(document.getElementById('patientFlowChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Admissions',
                data: [32, 28, 35, 42, 38, 24, 18],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: '#3b82f6',
                pointRadius: 4
            }, {
                label: 'Discharges',
                data: [28, 32, 30, 36, 40, 22, 20],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: '#10b981',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
        }
    });
    
    // Department Stats Horizontal Bar
    new Chart(document.getElementById('deptChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Cardiology', 'Orthopedics', 'Neurology', 'Pediatrics', 'General'],
            datasets: [{
                label: 'Patients',
                data: [45, 32, 28, 38, 52],
                backgroundColor: ['rgba(59,130,246,0.7)', 'rgba(239,68,68,0.7)', 'rgba(139,92,246,0.7)', 'rgba(245,158,11,0.7)', 'rgba(16,185,129,0.7)'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, y: { grid: { display: false } } }
        }
    });
    
    // Revenue Pie Chart
    new Chart(document.getElementById('revenueChart').getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['OPD', 'IPD', 'Surgery', 'Lab'],
            datasets: [{ data: [128400, 245600, 186200, 64800], backgroundColor: ['#3b82f6','#10b981','#f59e0b','#8b5cf6'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  /* --- dashboard-hrm --- */
  if (document.querySelector('#attendanceChart')) {
    // Salary Chart
    const salCtx = document.getElementById('salaryChart');
    if (salCtx) {
        new Chart(salCtx, {
            type: 'bar', data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'],
                datasets: [{ label: 'Salaries', data: [30000,38000,28000,42000,48000,36000,55000,60000], backgroundColor: '#f97316', borderRadius: 4, barPercentage: 0.6 },
                { label: 'Benefits', data: [15000,18000,22000,20000,16000,14000,25000,28000], backgroundColor: '#06b6d4', borderRadius: 4, barPercentage: 0.6 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => (v/1000)+'k', font: { size: 11, family: 'Inter' } } } } }
        });
    }
    
    // Yearly Donut
    const yrCtx = document.getElementById('yearlyDonut');
    if (yrCtx) {
        new Chart(yrCtx, { type: 'doughnut', data: { labels: ['2024','2025','2026'], datasets: [{ data: [35,30,35], backgroundColor: ['#f97316','#fbbf24','#8b5cf6'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } } });
    }
    
    // Earnings Bar
    const erCtx = document.getElementById('earningsBar');
    if (erCtx) {
        new Chart(erCtx, { type: 'bar', data: { labels: ['','','','','','',''], datasets: [{ data: [5,8,6,9,7,5,8], backgroundColor: '#f97316', borderRadius: 3, barPercentage: 0.5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } } });
    }
    
    // Monthly Attendance - Multi-color Bar Chart
    (function () {
        var attCanvas = document.getElementById('attendanceChart');
        var ctx = attCanvas.getContext('2d');
        var palette = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        function gradients() {
            return palette.map(function (c) {
                var g = ctx.createLinearGradient(0, 0, 0, attCanvas.clientHeight || 320);
                g.addColorStop(0, c);
                g.addColorStop(1, c + '33');
                return g;
            });
        }
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
                datasets: [{
                    label: 'Total Attendance',
                    data: [1190, 1198, 1200, 1200, 1187, 440, 190],
                    backgroundColor: gradients(),
                    borderRadius: 8,
                    borderSkipped: false,
                    barPercentage: 0.65
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: function (c) { return c.parsed.y.toLocaleString() + ' employees'; } } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } },
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } }
                }
            }
        });
    })();
    
    // Department Distribution - Doughnut Chart
    new Chart(document.getElementById('deptChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Engineering', 'Marketing', 'Sales', 'HR', 'Finance'],
            datasets: [{
                data: [420, 280, 310, 120, 117],
                backgroundColor: ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'],
                borderWidth: 0,
                spacing: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { legend: { display: false } }
        }
    });
    
    // Payroll Overview - Line Chart
    new Chart(document.getElementById('payrollChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
            datasets: [{
                label: 'Payroll ($K)',
                data: [245, 252, 268, 258, 272, 280],
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.08)',
                borderWidth: 3,
                pointRadius: 5,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: function(v) { return '$' + v + 'K'; } } },
                x: { grid: { display: false } }
            }
        }
    });
  }

  /* --- dashboard-marketing --- */
  if (document.querySelector('#salesProfitChart')) {
    // Sales Profit Chart
    const spCtx = document.getElementById('salesProfitChart');
    if (spCtx) {
        new Chart(spCtx, { type: 'line', data: { labels: ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr'],
            datasets: [{ label: 'This Year', data: [20,25,30,40,55,65,70,60,55], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#06b6d4', pointHoverRadius: 6 },
            { label: 'Last Year', data: [15,20,22,28,35,45,50,40,35], borderColor: '#e2e8f0', backgroundColor: 'rgba(0,0,0,0.02)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } } },
                interaction: { intersect: false, mode: 'index' } } });
    }
    
    // Product Sales Donut (semi-circle gauge)
    const psCtx = document.getElementById('productSalesDonut');
    if (psCtx) {
        new Chart(psCtx, { type: 'doughnut', data: { labels: ['Modernize','Spike','Ample','MaterialM'], datasets: [{ data: [36,7,22,31], backgroundColor: ['#4f46e5','#10b981','#8b5cf6','#f472b6'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, rotation: -90, circumference: 180, cutout: '70%', plugins: { legend: { display: false } } } });
    }
    
    // Campaign Performance - Line 3 datasets
    new Chart(document.getElementById('campaignChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
            datasets: [{
                label: 'Impressions',
                data: [320000, 380000, 420000, 390000, 450000, 480000, 520000],
                borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.06)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#4f46e5'
            }, {
                label: 'Clicks',
                data: [24000, 28000, 32000, 29000, 35000, 38000, 42000],
                borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#10b981'
            }, {
                label: 'Conversions',
                data: [1200, 1500, 1800, 1600, 2000, 2200, 2500],
                borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#f59e0b'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20 } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Marketing Channels - Doughnut
    new Chart(document.getElementById('channelChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Social', 'Email', 'Search', 'Display', 'Affiliate'],
            datasets: [{ data: [32, 25, 22, 13, 8], backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'], borderWidth: 0, spacing: 3 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
    });
    
    // Email Analytics - Grouped Bar
    new Chart(document.getElementById('emailChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Welcome Series', 'Product Launch', 'Holiday Sale', 'Newsletter'],
            datasets: [{
                label: 'Sent',
                data: [8450, 32000, 45000, 18200],
                backgroundColor: '#4f46e5', borderRadius: 4
            }, {
                label: 'Opened',
                data: [5520, 12380, 23445, 7735],
                backgroundColor: '#10b981', borderRadius: 4
            }, {
                label: 'Clicked',
                data: [2374, 4864, 10080, 1529],
                backgroundColor: '#f59e0b', borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 20 } } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } }
        }
    });
  }

  /* --- dashboard-project --- */
  if (document.querySelector('#projectChart')) {
    // Project Timeline - Horizontal Bar Chart
    new Chart(document.getElementById('projectChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Website Redesign', 'Mobile App v2', 'API Integration', 'Dashboard Analytics', 'E-commerce Platform', 'CRM Module'],
            datasets: [{
                label: 'Completion %',
                data: [85, 62, 45, 92, 28, 55],
                backgroundColor: ['#f59e0b', '#4f46e5', '#10b981', '#8b5cf6', '#ef4444', '#4f46e5'],
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 22
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, max: 100, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: function(v) { return v + '%'; } } },
                y: { grid: { display: false } }
            }
        }
    });
    
    // Task Distribution - Doughnut Chart
    new Chart(document.getElementById('taskDoughnut').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Todo', 'In Progress', 'Review', 'Done'],
            datasets: [{
                data: [24, 38, 16, 52],
                backgroundColor: ['#f59e0b', '#4f46e5', '#8b5cf6', '#10b981'],
                borderWidth: 0,
                spacing: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: { legend: { display: false } }
        }
    });
    
    // Team Workload - Horizontal Bar Chart
    new Chart(document.getElementById('workloadChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Sarah K.', 'John D.', 'Mike R.', 'Anna L.', 'David P.'],
            datasets: [{
                label: 'Tasks Assigned',
                data: [14, 11, 9, 12, 7],
                backgroundColor: ['#f59e0b', '#4f46e5', '#10b981', '#8b5cf6', '#ef4444'],
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { grid: { display: false } }
            }
        }
    });
  }

  /* --- dashboard-realestate --- */
  if (document.querySelector('#portfolioChart')) {
    // Portfolio Chart
    const pfCtx = document.getElementById('portfolioChart');
    if (pfCtx) {
        new Chart(pfCtx, { type: 'line', data: { labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
            datasets: [{ data: [5.2,5.8,6.1,5.9,6.4,6.8,7.2,7.0,7.5,7.8,8.1,8.4], borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { callback: v => '$'+v+'M', font: { size: 11, family: 'Inter' } } } } } });
    }
    
    // Revenue Trend - Line chart (12 months, filled area gradient)
    (function(){
        var ctx = document.getElementById('revenueTrendChart').getContext('2d');
        var grad = ctx.createLinearGradient(0,0,0,320);
        grad.addColorStop(0,'rgba(79,70,229,0.3)'); grad.addColorStop(1,'rgba(79,70,229,0)');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [{
                    label: 'Revenue ($K)', data: [180,220,195,280,310,245,320,290,350,380,420,400],
                    borderColor:'#4f46e5', backgroundColor:grad, fill:true, tension:0.4, borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#4f46e5'
                },{
                    label: 'Properties Sold', data: [28,35,30,42,48,38,52,45,55,60,65,48],
                    borderColor:'#10b981', backgroundColor:'transparent', tension:0.4, borderWidth:2, borderDash:[5,5], pointRadius:2
                }]
            },
            options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.05)'}},x:{grid:{display:false}}} }
        });
    })();
    
    // Property Types - Donut chart
    new Chart(document.getElementById('propertyTypeChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Residential','Commercial','Industrial','Land','Other'],
            datasets: [{ data: [45,25,15,10,5], backgroundColor: ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6'], borderWidth: 0 }]
        },
        options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{legend:{display:false}} }
    });
    
    // Market Analysis - Stacked bar chart
    (function(){
        var ctx = document.getElementById('marketChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
                datasets: [{
                    label: 'Residential', data: [12,15,13,18,22,16,20,18,24,26,28,22],
                    backgroundColor: '#4f46e5', borderRadius: 4, stack: 'stack0'
                },{
                    label: 'Commercial', data: [5,8,6,10,8,7,12,10,14,12,15,10],
                    backgroundColor: '#10b981', borderRadius: 4, stack: 'stack0'
                },{
                    label: 'Industrial', data: [3,4,3,5,6,4,7,5,8,7,9,6],
                    backgroundColor: '#f59e0b', borderRadius: 4, stack: 'stack0'
                },{
                    label: 'Land', data: [2,3,2,4,3,3,5,4,5,6,7,4],
                    backgroundColor: '#ef4444', borderRadius: 4, stack: 'stack0'
                }]
            },
            options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top'}}, scales:{y:{beginAtZero:true,stacked:true,grid:{color:'rgba(0,0,0,0.05)'}},x:{stacked:true,grid:{display:false}}} }
        });
    })();
  }

  /* --- form-advanced --- */
  if (document.querySelector('#strengthBar')) {
    function updateStrength(pwd) {
        let score = 0;
        if (pwd.length >= 8) score++;
        if (pwd.length >= 12) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^A-Za-z0-9]/.test(pwd)) score++;
        const pct = (score / 5) * 100;
        const colors = ['#ef4444','#ef4444','#f59e0b','#f59e0b','#22c55e','#22c55e'];
        const texts = ['Very Weak','Weak','Fair','Medium','Strong','Very Strong'];
        document.getElementById('strengthBar').style.width = pct + '%';
        document.getElementById('strengthBar').style.background = colors[score];
        document.getElementById('strengthText').textContent = texts[score];
    }
  }

  /* --- form-validation --- */
  if (document.querySelector('#regForm')) {
    // Bootstrap validation
    document.getElementById('regForm').addEventListener('submit', function(e) {
        if (!this.checkValidity()) { e.preventDefault(); e.stopPropagation(); }
        this.classList.add('was-validated');
    });
    document.getElementById('regPwd').addEventListener('input', function() {
        let s = 0, v = this.value;
        if(v.length>=8)s++; if(v.length>=12)s++; if(/[A-Z]/.test(v))s++; if(/[0-9]/.test(v))s++; if(/[^A-Za-z0-9]/.test(v))s++;
        const bar = document.getElementById('regStrength');
        bar.style.width = (s/5*100)+'%';
        bar.style.background = ['#ef4444','#ef4444','#f59e0b','#f59e0b','#22c55e','#22c55e'][s];
    });
  }

  /* --- form-wizard --- */
  if (document.querySelector('#step1')) {
    let currentStep = 1;
    const totalSteps = 4;

    window.changeStep = function changeStep(direction) {
        currentStep += direction;
        if (currentStep < 1) currentStep = 1;
        if (currentStep > totalSteps) currentStep = totalSteps;
    
        // Update step contents
        document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
        document.getElementById('step' + currentStep).classList.add('active');
    
        // Update step indicators
        document.querySelectorAll('.wizard-step').forEach((el, i) => {
            el.classList.remove('active', 'completed');
            if (i + 1 < currentStep) el.classList.add('completed');
            if (i + 1 === currentStep) el.classList.add('active');
        });
    
        // Update progress
        const pct = (currentStep / totalSteps) * 100;
        document.getElementById('wizardProgress').style.width = pct + '%';
        document.getElementById('progressLine').style.width = ((currentStep - 1) / (totalSteps - 1) * 70) + '%';
    
        // Buttons
        document.getElementById('prevBtn').disabled = currentStep === 1;
        const nextBtn = document.getElementById('nextBtn');
        if (currentStep === totalSteps) {
            nextBtn.innerHTML = '<i data-feather="check" style="width:16px;height:16px" class="me-1"></i> Submit';
            nextBtn.onclick = function() { alert('Registration Complete!'); };
        } else {
            nextBtn.innerHTML = 'Next <i data-feather="arrow-right" style="width:16px;height:16px" class="ms-1"></i>';
            nextBtn.onclick = function() { window.changeStep(1); };
        }
        feather.replace();
    };
  }

  /* --- table-datatable --- */
  if (document.querySelector('.datatable-search')) {
    const table = document.querySelector('.table-responsive table');
    const tbody = table.querySelector('tbody');
    const allRows = Array.from(tbody.querySelectorAll('tr'));
    const searchInput = document.querySelector('.datatable-search');
    const pageSizeSelect = document.querySelector('.select-w-auto');
    const paginationUl = document.querySelector('.pagination');
    const infoLabel = paginationUl ? paginationUl.closest('.d-flex').querySelector('.text-muted') : null;
    const headers = Array.from(table.querySelectorAll('th.sortable'));

    let filtered = allRows.slice();
    let pageSize = parseInt(pageSizeSelect.value, 10) || 10;
    let currentPage = 1;
    let sortColumn = -1;
    let sortDir = 1;

    function parseCell(text) {
        const t = text.trim().replace(/[$,]/g, '');
        const n = parseFloat(t);
        if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(t)) return n;
        const d = Date.parse(t);
        if (!isNaN(d)) return d;
        return text.trim().toLowerCase();
    }

    function applyFilter() {
        const q = searchInput.value.trim().toLowerCase();
        filtered = allRows.filter(row => !q || row.textContent.toLowerCase().includes(q));
        if (sortColumn >= 0) {
            filtered.sort((a, b) => {
                const av = parseCell(a.children[sortColumn].textContent);
                const bv = parseCell(b.children[sortColumn].textContent);
                if (av < bv) return -1 * sortDir;
                if (av > bv) return 1 * sortDir;
                return 0;
            });
        }
        currentPage = 1;
        render();
    }

    function render() {
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, total);

        allRows.forEach(r => { r.style.display = 'none'; });
        filtered.slice(start, end).forEach(r => { r.style.display = ''; });
        // Reorder in DOM so sorted order is visible
        filtered.slice(start, end).forEach(r => tbody.appendChild(r));

        if (infoLabel) {
            infoLabel.textContent = total === 0
                ? 'Showing 0 to 0 of 0 entries'
                : 'Showing ' + (start + 1) + ' to ' + end + ' of ' + total + ' entries';
        }

        if (paginationUl) {
            paginationUl.innerHTML = '';
            const mkItem = (label, page, opts) => {
                opts = opts || {};
                const li = document.createElement('li');
                li.className = 'page-item' + (opts.disabled ? ' disabled' : '') + (opts.active ? ' active' : '');
                const a = document.createElement('a');
                a.className = 'page-link';
                a.href = '#';
                a.textContent = label;
                a.addEventListener('click', e => {
                    e.preventDefault();
                    if (opts.disabled || opts.active) return;
                    currentPage = page;
                    render();
                });
                li.appendChild(a);
                return li;
            };
            paginationUl.appendChild(mkItem('Previous', currentPage - 1, { disabled: currentPage === 1 }));
            for (let i = 1; i <= totalPages; i++) {
                paginationUl.appendChild(mkItem(String(i), i, { active: i === currentPage }));
            }
            paginationUl.appendChild(mkItem('Next', currentPage + 1, { disabled: currentPage === totalPages }));
        }
    }

    searchInput.addEventListener('input', applyFilter);
    pageSizeSelect.addEventListener('change', () => {
        pageSize = parseInt(pageSizeSelect.value, 10) || 10;
        currentPage = 1;
        render();
    });
    headers.forEach((th, idx) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            if (sortColumn === idx) {
                sortDir = -sortDir;
            } else {
                sortColumn = idx;
                sortDir = 1;
            }
            headers.forEach((h, i) => {
                const icon = h.querySelector('.sort-icon');
                if (!icon) return;
                const spans = icon.querySelectorAll('span');
                spans.forEach(s => s.classList.remove('active'));
                if (i === sortColumn && spans.length >= 2) {
                    spans[sortDir === 1 ? 0 : 1].classList.add('active');
                }
            });
            applyFilter();
        });
    });

    render();
  }

  /* --- gallery --- */
  if (document.querySelector('#lightbox')) {
    const galleryItems = [
        {title:'Sunset Beach',info:'Mar 15 · 2.4 MB',bg:'linear-gradient(135deg,#f472b6,#ec4899)'},
        {title:'Mountain Vista',info:'Mar 14 · 3.1 MB',bg:'linear-gradient(135deg,#60a5fa,#3b82f6)'},
        {title:'Forest Path',info:'Mar 13 · 1.8 MB',bg:'linear-gradient(135deg,#34d399,#10b981)'},
        {title:'City Lights',info:'Mar 12 · 4.2 MB',bg:'linear-gradient(135deg,#a78bfa,#8b5cf6)'},
        {title:'Desert Dunes',info:'Mar 11 · 2.9 MB',bg:'linear-gradient(135deg,#fb923c,#f97316)'},
        {title:'Ocean Wave',info:'Mar 10 · 3.5 MB',bg:'linear-gradient(135deg,#38bdf8,#0ea5e9)'},
        {title:'Autumn Leaves',info:'Mar 9 · 1.6 MB',bg:'linear-gradient(135deg,#f87171,#ef4444)'},
        {title:'Spring Garden',info:'Mar 8 · 2.1 MB',bg:'linear-gradient(135deg,#86efac,#22c55e)'},
        {title:'Northern Lights',info:'Mar 7 · 5.8 MB',bg:'linear-gradient(135deg,#c084fc,#a855f7)'},
        {title:'Golden Hour',info:'Mar 6 · 3.3 MB',bg:'linear-gradient(135deg,#fbbf24,#f59e0b)'},
        {title:'Tropical Island',info:'Mar 5 · 4.1 MB',bg:'linear-gradient(135deg,#2dd4bf,#14b8a6)'},
        {title:'Starry Night',info:'Mar 4 · 2.7 MB',bg:'linear-gradient(135deg,#818cf8,#6366f1)'},
        {title:'Cherry Blossom',info:'Mar 3 · 2.0 MB',bg:'linear-gradient(135deg,#fb7185,#e11d48)'},
        {title:'Glacier Lake',info:'Mar 2 · 3.9 MB',bg:'linear-gradient(135deg,#67e8f9,#06b6d4)'},
        {title:'Rolling Hills',info:'Mar 1 · 1.4 MB',bg:'linear-gradient(135deg,#bef264,#84cc16)'},
        {title:'Neon City',info:'Feb 28 · 4.7 MB',bg:'linear-gradient(135deg,#d946ef,#c026d3)'},
        {title:'Canyon View',info:'Feb 27 · 3.0 MB',bg:'linear-gradient(135deg,#fdba74,#ea580c)'},
        {title:'Coral Reef',info:'Feb 26 · 5.2 MB',bg:'linear-gradient(135deg,#5eead4,#0d9488)'},
        {title:'Rainy Window',info:'Feb 25 · 1.9 MB',bg:'linear-gradient(135deg,#93c5fd,#2563eb)'},
        {title:'Volcanic Sunset',info:'Feb 24 · 4.4 MB',bg:'linear-gradient(135deg,#fca5a5,#dc2626)'},
        {title:'Lavender Field',info:'Feb 23 · 2.6 MB',bg:'linear-gradient(135deg,#a5b4fc,#4f46e5)'},
        {title:'Wheat Field',info:'Feb 22 · 3.7 MB',bg:'linear-gradient(135deg,#fde68a,#d97706)'},
        {title:'Bamboo Forest',info:'Feb 21 · 2.3 MB',bg:'linear-gradient(135deg,#6ee7b7,#059669)'},
        {title:'Rose Garden',info:'Feb 20 · 1.5 MB',bg:'linear-gradient(135deg,#f9a8d4,#db2777)'}
    ];
    let currentIndex = 0;

    function updateLightbox() {
        const item = galleryItems[currentIndex];
        const img = document.getElementById('lightboxImg');
        img.src = 'https://picsum.photos/seed/bootuigallery' + currentIndex + '/1200/800';
        img.alt = item.title;
        document.getElementById('lightboxTitle').textContent = item.title;
        document.getElementById('lightboxInfo').textContent = item.info;
    }
    window.openLightbox = function (index) {
        currentIndex = index;
        updateLightbox();
        document.getElementById('lightbox').classList.add('show');
    };
    window.closeLightbox = function (e) {
        if (!e || e.target.classList.contains('lightbox-backdrop') || e.target.classList.contains('lightbox-close'))
            document.getElementById('lightbox').classList.remove('show');
    };
    window.navigateLightbox = function (dir, e) {
        if (e) e.stopPropagation();
        currentIndex = (currentIndex + dir + galleryItems.length) % galleryItems.length;
        updateLightbox();
    };
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
  }

  /* --- hrm-payroll --- */
  if (document.querySelector('#salaryChart')) {
    new Chart(document.getElementById('salaryChart'), {
          type: 'bar',
          data: {
            labels: ['Engineering','Marketing','Sales','HR','Finance','Design','Operations','Support'],
            datasets: [{
              label: 'Avg Salary',
              data: [6400,5100,5500,4800,5200,5000,5600,4200],
              backgroundColor: '#4f46e5',
              borderRadius: 8
            },{
              label: 'Bonuses',
              data: [1200,800,2100,750,800,850,950,650],
              backgroundColor: '#22c55e',
              borderRadius: 8
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '$'+v.toLocaleString() } } } }
        });

        new Chart(document.getElementById('payrollPie'), {
          type: 'doughnut',
          data: {
            labels: ['Basic Salary','Allowances','Bonuses','Deductions'],
            datasets: [{ data: [385000,52000,32000,28000], backgroundColor: ['#4f46e5','#06b6d4','#22c55e','#ef4444'], borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
  }

  /* --- icons --- */
  if (document.querySelector('#iconCount')) {
    function filterIcons(query) {
        const items = document.querySelectorAll('.icon-item');
        let count = 0;
        items.forEach(item => {
            const name = item.querySelector('.icon-name').textContent;
            if (name.includes(query.toLowerCase())) { item.style.display = ''; count++; }
            else { item.style.display = 'none'; }
        });
        document.getElementById('iconCount').textContent = count;
    }
  }

  /* --- index --- */
  if (document.querySelector('#weeklyOrdersChart')) {
    // Weekly Orders - Line Chart
    const weeklyCtx = document.getElementById('weeklyOrdersChart');
    if (weeklyCtx) {
        new Chart(weeklyCtx, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    label: 'This Week',
                    data: [0, 15, 18, 17, 22, 25, 30],
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79,70,229,0.05)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }, {
                    label: 'Last Week',
                    data: [0, 12, 14, 20, 18, 16, 22],
                    borderColor: '#c4b5fd',
                    backgroundColor: 'rgba(196,181,253,0.05)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11, family: 'Inter' } } },
                    y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 11, family: 'Inter' } } }
                }
            }
        });
    }
    
    // Customers Sparkline
    const custCtx = document.getElementById('customersSparkline');
    if (custCtx) {
        new Chart(custCtx, {
            type: 'line',
            data: {
                labels: ['', '', '', '', '', '', ''],
                datasets: [{
                    data: [3800, 4200, 4000, 4800, 5200, 5800, 6380],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6,182,212,0.1)',
                    fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: false }, y: { display: false } }
            }
        });
    }
    
    // Payments Sparkline - Stacked Bars
    const payCtx = document.getElementById('paymentsSparkline');
    if (payCtx) {
        new Chart(payCtx, {
            type: 'bar',
            data: {
                labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
                datasets: [{
                    data: [1200, 1800, 1400, 2000, 1600, 1200, 1800],
                    backgroundColor: '#4f46e5',
                    borderRadius: 3, barPercentage: 0.5
                }, {
                    data: [800, 1000, 900, 1200, 1100, 800, 1000],
                    backgroundColor: '#e2e8f0',
                    borderRadius: 3, barPercentage: 0.5
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { display: false }, y: { display: false } },
                interaction: { intersect: false }
            }
        });
    }
    
    // Products Donut
    const prodCtx = document.getElementById('productsDonut');
    if (prodCtx) {
        new Chart(prodCtx, {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Inactive', 'Draft'],
                datasets: [{
                    data: [60, 25, 15],
                    backgroundColor: ['#06b6d4', '#8b5cf6', '#f472b6'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: false } }
            }
        });
    }
    
    // Revenue Overview - Bar Chart
    const revenueCtx = document.getElementById('revenueChart').getContext('2d');
    new Chart(revenueCtx, {
        type: 'bar',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
            datasets: [
                {
                    label: 'This Year',
                    data: [18200, 22400, 19800, 24600, 21500, 28300, 25100],
                    backgroundColor: '#4f46e5',
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7
                },
                {
                    label: 'Last Year',
                    data: [14500, 17800, 15200, 19400, 16800, 21600, 18900],
                    backgroundColor: '#e2e8f0',
                    borderRadius: 4,
                    barPercentage: 0.6,
                    categoryPercentage: 0.7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 } } },
                y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Inter', size: 11 }, callback: function(v) { return '$' + (v/1000) + 'K'; } } }
            },
            interaction: { intersect: false, mode: 'index' }
        }
    });
    
    // Order Summary - Doughnut Chart
    const orderCtx = document.getElementById('orderSummary').getContext('2d');
    new Chart(orderCtx, {
        type: 'doughnut',
        data: {
            labels: ['Completed', 'Pending', 'Cancelled'],
            datasets: [{
                data: [65, 25, 10],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: { legend: { display: false } }
        }
    });
    
    // Sales by Region - Horizontal Bar Chart
    const regionCtx = document.getElementById('regionChart').getContext('2d');
    new Chart(regionCtx, {
        type: 'bar',
        data: {
            labels: ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East'],
            datasets: [{
                label: 'Sales',
                data: [32400, 24800, 18600, 12400, 8200],
                backgroundColor: '#4f46e5',
                borderRadius: 4,
                barPercentage: 0.5
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Inter', size: 11 }, callback: function(v) { return '$' + (v/1000) + 'K'; } } },
                y: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 12 } } }
            }
        }
    });
    
    // Top Categories - Pie Chart
    const catCtx = document.getElementById('categoryChart').getContext('2d');
    new Chart(catCtx, {
        type: 'pie',
        data: {
            labels: ['Electronics', 'Fashion', 'Home & Living', 'Sports & Outdoors'],
            datasets: [{
                data: [35, 28, 22, 15],
                backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#06b6d4'],
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', font: { family: 'Inter', size: 12 } }
                }
            }
        }
    });
  }

  /* --- invoice-create --- */
  if (document.querySelector('#line-items-table')) {
    function formatCurrency(n) {
          return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
    
        function calcRow(el) {
          const row = el.closest('.line-item');
          const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
          const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
          row.querySelector('.item-amount').textContent = formatCurrency(qty * rate);
          calcTotals();
        }
    
        function calcTotals() {
          let subtotal = 0;
          document.querySelectorAll('.line-item').forEach(row => {
            const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
            const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
            subtotal += qty * rate;
          });
          const taxRate = parseFloat(document.getElementById('tax-rate').value) || 0;
          const discount = parseFloat(document.getElementById('discount').value) || 0;
          const tax = subtotal * (taxRate / 100);
          const total = subtotal + tax - discount;
          document.getElementById('subtotal').textContent = formatCurrency(subtotal);
          document.getElementById('tax-amount').textContent = formatCurrency(tax);
          document.getElementById('discount-amount').textContent = '-' + formatCurrency(discount);
          document.getElementById('total').textContent = formatCurrency(total);
        }
    
        function addLineItem() {
          const tbody = document.querySelector('#line-items-table tbody');
          const tr = document.createElement('tr');
          tr.className = 'line-item';
          tr.innerHTML = `
            <td><input type="text" class="form-control" placeholder="Item description"></td>
            <td><input type="number" class="form-control text-center item-qty" value="1" min="1" onchange="calcRow(this)"></td>
            <td><input type="number" class="form-control text-end item-rate" value="0" step="0.01" onchange="calcRow(this)"></td>
            <td class="text-end fw-semibold align-middle item-amount">$0.00</td>
            <td class="text-center"><button type="button" class="btn btn-soft-danger btn-sm btn-icon" onclick="removeRow(this)"><i data-feather="trash-2" style="width:14px;height:14px;"></i></button></td>
          `;
          tbody.appendChild(tr);
          feather.replace();
        }
    
        function removeRow(el) {
          el.closest('.line-item').remove();
          calcTotals();
        }
  }

  /* --- pricing --- */
  if (document.querySelector('#billing-toggle')) {
    function toggleBilling() {
          const isAnnual = document.getElementById('billing-toggle').checked;
          document.getElementById('monthly-label').style.color = isAnnual ? '#94a3b8' : 'var(--heading-color)';
          document.getElementById('annual-label').style.color = isAnnual ? 'var(--heading-color)' : '#94a3b8';
    
          document.querySelectorAll('.price-value[data-monthly]').forEach(el => {
            el.textContent = isAnnual ? el.dataset.annual : el.dataset.monthly;
          });
        }
  }

  /* --- project-create --- */
  if (document.querySelector('#milestones-container')) {
    function addMilestone() {
          const container = document.getElementById('milestones-container');
          const row = document.createElement('div');
          row.className = 'row g-3 mt-0 milestone-row align-items-end';
          row.innerHTML = `
            <div class="col-md-6">
              <label class="form-label">Milestone Name</label>
              <input type="text" class="form-control" placeholder="Milestone name">
            </div>
            <div class="col-md-4">
              <label class="form-label">Target Date</label>
              <input type="date" class="form-control">
            </div>
            <div class="col-md-2">
              <button type="button" class="btn btn-soft-danger btn-sm w-100" onclick="this.closest('.milestone-row').remove()"><i data-feather="trash-2" style="width:14px;height:14px;"></i></button>
            </div>
          `;
          container.appendChild(row);
          feather.replace();
        }
  }

  /* --- reviews --- */
  if (document.querySelector('#reviewsChart')) {
    // Reviews Doughnut Chart
            const ctx = document.getElementById('reviewsChart').getContext('2d');
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['5 Star', '4 Star', '3 Star', '2 Star', '1 Star'],
                    datasets: [{
                        data: [1366, 797, 399, 199, 86],
                        backgroundColor: ['#198754', '#667eea', '#0dcaf0', '#ffc107', '#dc3545'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { padding: 12, usePointStyle: true, pointStyle: 'circle' }
                        }
                    },
                    cutout: '65%'
                }
            });
  }

  /* --- ui-alerts --- */
  if (document.querySelector('#liveAlertPlaceholder')) {
    // Live Alert Demo
    const alertPlaceholder = document.getElementById('liveAlertPlaceholder');
    const appendAlert = (message, type) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<div class="alert alert-' + type + ' alert-dismissible fade show" role="alert">' + message + '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>';
        alertPlaceholder.append(wrapper);
    };
    document.getElementById('liveAlertBtnPrimary').addEventListener('click', () => appendAlert('<strong>Primary!</strong> This is a dynamically generated primary alert.', 'primary'));
    document.getElementById('liveAlertBtnSuccess').addEventListener('click', () => appendAlert('<strong>Success!</strong> Operation completed successfully.', 'success'));
    document.getElementById('liveAlertBtnDanger').addEventListener('click', () => appendAlert('<strong>Error!</strong> Something went wrong. Please try again.', 'danger'));
    document.getElementById('liveAlertBtnWarning').addEventListener('click', () => appendAlert('<strong>Warning!</strong> Please review your input carefully.', 'warning'));
    document.getElementById('liveAlertBtnInfo').addEventListener('click', () => appendAlert('<strong>Info!</strong> Here is some useful information for you.', 'info'));
  }

  /* --- ui-offcanvas --- */
  if (document.querySelector('.offcanvas')) {
    document.querySelectorAll('.offcanvas').forEach(el=>{el.addEventListener('shown.bs.offcanvas',()=>feather.replace())});
  }

  /* --- ui-toasts --- */
  if (document.querySelector('#toastContainer')) {
    function showToast(color, title, message) {
        const container = document.getElementById('toastContainer');
        const toastEl = document.createElement('div');
        toastEl.className = 'toast show bg-' + color + ' text-white border-0';
        toastEl.setAttribute('role', 'alert');
        toastEl.innerHTML = '<div class="d-flex"><div class="toast-body"><strong>' + title + '</strong><br>' + message + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
        container.appendChild(toastEl);
        const bsToast = new bootstrap.Toast(toastEl, {delay: 4000});
        bsToast.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }
    document.getElementById('triggerPrimary').addEventListener('click', () => showToast('primary', 'Primary', 'This is a primary toast notification.'));
    document.getElementById('triggerSuccess').addEventListener('click', () => showToast('success', 'Success!', 'Operation completed successfully.'));
    document.getElementById('triggerDanger').addEventListener('click', () => showToast('danger', 'Error!', 'Something went wrong. Please try again.'));
    document.getElementById('triggerWarning').addEventListener('click', () => showToast('warning', 'Warning!', 'Please review your input carefully.'));
    document.getElementById('triggerInfo').addEventListener('click', () => showToast('info', 'Info', 'Here is some useful information.'));
  }

  /* --- ui-tooltips --- */
  if (document.querySelector('[data-bs-toggle="tooltip"]')) {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el=>new bootstrap.Tooltip(el));document.querySelectorAll('[data-bs-toggle="popover"]').forEach(el=>new bootstrap.Popover(el));
  }

  /* --- wallet --- */
  if (document.querySelector('#spendingChart')) {
    // Spending Donut Chart
        const spendingCtx = document.getElementById('spendingChart').getContext('2d');
        new Chart(spendingCtx, {
          type: 'doughnut',
          data: {
            labels: ['Hosting & Cloud', 'Software & Tools', 'Contractors', 'Office & Equipment', 'Marketing'],
            datasets: [{
              data: [2340, 1685, 4800, 3200, 1450],
              backgroundColor: ['#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'],
              borderWidth: 0,
              hoverOffset: 8
            }]
          },
          options: {
            responsive: true,
            cutout: '70%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    return ctx.label + ': $' + ctx.parsed.toLocaleString();
                  }
                }
              }
            }
          }
        });
    
        // Income vs Expense Bar Chart
        const incomeExpenseCtx = document.getElementById('incomeExpenseChart').getContext('2d');
        new Chart(incomeExpenseCtx, {
          type: 'bar',
          data: {
            labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
            datasets: [
              {
                label: 'Income',
                data: [42000, 38500, 51200, 44800, 56300, 48420],
                backgroundColor: 'rgba(79, 70, 229, 0.8)',
                borderRadius: 6,
                barPercentage: 0.4,
                categoryPercentage: 0.7
              },
              {
                label: 'Expenses',
                data: [28000, 25200, 31400, 27600, 33100, 23240],
                backgroundColor: 'rgba(239, 68, 68, 0.6)',
                borderRadius: 6,
                barPercentage: 0.4,
                categoryPercentage: 0.7
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                grid: { display: false },
                ticks: { font: { size: 12 } }
              },
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(0,0,0,0.05)' },
                ticks: {
                  font: { size: 12 },
                  callback: function(val) { return '$' + (val / 1000) + 'k'; }
                }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 12 } }
              },
              tooltip: {
                callbacks: {
                  label: function(ctx) {
                    return ctx.dataset.label + ': $' + ctx.parsed.y.toLocaleString();
                  }
                }
              }
            }
          }
        });
  }

  /* --- widgets --- */
  if (document.querySelector('#revenueWidget')) {
    new Chart(document.getElementById('revenueWidget'),{type:'line',data:{labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],datasets:[{label:'Revenue',data:[1200,1900,1500,2100,1800,2400,2200],borderColor:'#4f46e5',backgroundColor:'rgba(79,70,229,0.1)',fill:true,tension:0.4,borderWidth:2,pointRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v}},x:{grid:{display:false}}}}});
  }

})();
