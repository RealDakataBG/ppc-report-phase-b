import { supabase, requireAdminSession, signOut, getAccessToken } from './supabase-client.js';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

var fileData = null;
var allClients = []; // {id, name}[] - shared source for the sidebar list and the invite combobox

document.getElementById('logout-btn').addEventListener('click', function () { signOut(); });

/* ---------- collapsible sidebar ---------- */
var SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';
var sidebarToggleBtn = document.getElementById('sidebar-toggle');
function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggleBtn.textContent = collapsed ? '›' : '‹';
  sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
}
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
sidebarToggleBtn.addEventListener('click', function () {
  var collapsed = !document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
});

function showEl(el, msg) { el.textContent = msg; el.classList.add('show'); }
function hideEl(el) { el.classList.remove('show'); el.textContent = ''; }

var uploadErrorEl = document.getElementById('upload-error');
var uploadResultEl = document.getElementById('upload-result');
var syncErrorEl = document.getElementById('sync-error');
var syncSuccessEl = document.getElementById('sync-success');

function setupDropzone(zoneId, inputId, fileLabelId, onFile) {
  var zone = document.getElementById(zoneId);
  var input = document.getElementById(inputId);
  var label = document.getElementById(fileLabelId);
  function handleFile(file) {
    if (!file) return;
    label.textContent = file.name;
    zone.classList.add('filled');
    onFile(file);
  }
  input.addEventListener('change', function () { handleFile(input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); }); });
  zone.addEventListener('drop', function (e) { var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var result = reader.result; // "data:...;base64,XXXX"
      var comma = result.indexOf(',');
      resolve(comma !== -1 ? result.slice(comma + 1) : result);
    };
    reader.onerror = function () { reject(new Error('Datei konnte nicht gelesen werden.')); };
    reader.readAsDataURL(file);
  });
}

setupDropzone('dz-data', 'file-data', 'dz-data-file', function (file) {
  fileData = file;
  document.getElementById('upload-btn').disabled = false;
  hideEl(uploadErrorEl);
});

document.getElementById('upload-btn').addEventListener('click', function () {
  if (!fileData) return;
  hideEl(uploadErrorEl);
  uploadResultEl.innerHTML = '';
  var btn = document.getElementById('upload-btn');
  var originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen…';

  fileToBase64(fileData).then(function (base64) {
    return getAccessToken().then(function (token) {
      if (!token) throw new Error('Keine gültige Sitzung.');
      return fetch('/.netlify/functions/ingest-performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ filename: fileData.name, fileBase64: base64 })
      });
    });
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  }).then(function (result) {
    if (!result.ok || !result.data.ok) throw new Error((result.data && result.data.error) || 'Unbekannter Fehler.');
    renderUploadResult(result.data);
    loadClients();
  }).catch(function (err) {
    showEl(uploadErrorEl, 'Fehler: ' + err.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = originalLabel;
  });
});

function renderUploadResult(data) {
  var html = '<div class="result-panel"><h4>Import abgeschlossen</h4>';
  html += '<div>' + data.monthsWritten + ' Monatswerte gespeichert.</div>';
  if (data.clientsCreated.length) {
    html += '<div style="margin-top:8px;">Neue Kunden angelegt:</div><ul>' +
      data.clientsCreated.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
  }
  if (data.warnings && data.warnings.length) {
    html += '<div class="result-warn" style="margin-top:8px;">Hinweise:</div><ul class="result-warn">' +
      data.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
  }
  html += '</div>';
  uploadResultEl.innerHTML = html;
}

document.getElementById('sync-btn').addEventListener('click', function () {
  hideEl(syncErrorEl);
  hideEl(syncSuccessEl);
  var btn = document.getElementById('sync-btn');
  var originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Wird synchronisiert…';

  getAccessToken().then(function (token) {
    if (!token) throw new Error('Keine gültige Sitzung.');
    return fetch('/.netlify/functions/sync-todos-manual', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  }).then(function (result) {
    if (!result.ok || !result.data.ok) throw new Error((result.data && result.data.error) || 'Unbekannter Fehler.');
    var d = result.data;
    var msg = d.matched.length + ' Kunden synchronisiert';
    if (d.unmatched.length) msg += ', ' + d.unmatched.length + ' nicht zugeordnet (' + d.unmatched.join(', ') + ')';
    showEl(syncSuccessEl, msg + '.');
  }).catch(function (err) {
    showEl(syncErrorEl, 'Fehler: ' + err.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = originalLabel;
  });
});

var sidebarSearchInput = document.getElementById('sidebar-search');

function renderSidebarClients(list) {
  var el = document.getElementById('sidebar-clients');
  if (list.length === 0) {
    el.innerHTML = '<div class="sidebar-empty">Kein Treffer</div>';
    return;
  }
  el.innerHTML = list.map(function (c) {
    return '<a class="client-pill" href="dashboard.html?client=' + encodeURIComponent(c.id) + '">' + esc(c.name) + '</a>';
  }).join('');
}

function filteredClients() {
  var q = sidebarSearchInput.value.trim().toLowerCase();
  if (!q) return allClients;
  return allClients.filter(function (c) { return c.name.toLowerCase().indexOf(q) !== -1; });
}

sidebarSearchInput.addEventListener('input', function () { renderSidebarClients(filteredClients()); });

function loadClients() {
  return supabase.from('clients').select('id, name').order('name').then(function (res) {
    if (res.error) return;
    allClients = res.data;
    renderSidebarClients(filteredClients());
  });
}

/* ---------- combined performance overview (all clients) ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function currentMonthCutoff() {
  var now = new Date();
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-01';
}
function dbDateToMonthLabel(dateStr) {
  var parts = dateStr.split('-');
  return EN_MONTHS[Number(parts[1]) - 1] + ' ' + Number(parts[0]);
}

// Groups performance_monthly rows from every client by month, sums the raw
// counters, then re-derives the ratio metrics per month - same formulas as
// report-builder.js's own total-fallback, just applied across clients
// instead of across one client's months.
function aggregateMonthly(rows) {
  var byMonth = {};
  rows.forEach(function (r) {
    var g = byMonth[r.month] || (byMonth[r.month] = { month: r.month, impressions: 0, clicks: 0, orders: 0, spend: 0, revenue: 0 });
    g.impressions += r.impressions; g.clicks += r.clicks; g.orders += r.orders; g.spend += r.spend; g.revenue += r.revenue;
  });
  return Object.keys(byMonth).sort().map(function (key) {
    var g = byMonth[key];
    g.ctr = g.impressions ? g.clicks / g.impressions : 0;
    g.cr = g.clicks ? g.orders / g.clicks : 0;
    g.acos = g.revenue ? g.spend / g.revenue : 0;
    g.roas = g.spend ? g.revenue / g.spend : 0;
    g.tacos = g.acos;
    g.cpc = g.clicks ? g.spend / g.clicks : 0;
    g.cpo = g.orders ? g.spend / g.orders : 0;
    g.asp = g.orders ? g.revenue / g.orders : 0;
    g.month = dbDateToMonthLabel(g.month);
    return g;
  });
}

function loadOverview() {
  return supabase.from('performance_monthly').select('*')
    .lt('month', currentMonthCutoff()).order('month', { ascending: true })
    .then(function (res) {
      if (res.error) return;
      var months = aggregateMonthly(res.data);
      document.getElementById('overview-root').innerHTML = buildCompanyReport('Alle Kunden', { total: null, months: months }, null);
    });
}

/* ---------- invite modal ---------- */
var inviteBackdrop = document.getElementById('invite-backdrop');
var inviteEmailInput = document.getElementById('invite-email');
var inviteCompanyInput = document.getElementById('invite-company');
var inviteCompanyList = document.getElementById('invite-company-list');
var inviteErrorEl = document.getElementById('invite-error');
var inviteSuccessEl = document.getElementById('invite-success');

function openInviteModal() {
  hideEl(inviteErrorEl);
  hideEl(inviteSuccessEl);
  inviteBackdrop.classList.add('show');
  inviteEmailInput.focus();
}
function closeInviteModal() {
  hideSuggestions();
  inviteBackdrop.classList.remove('show');
}

document.getElementById('invite-open-btn').addEventListener('click', openInviteModal);
document.getElementById('invite-close').addEventListener('click', closeInviteModal);
inviteBackdrop.addEventListener('click', function (e) {
  if (e.target === inviteBackdrop) closeInviteModal();
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (!inviteBackdrop.classList.contains('show')) return;
  if (inviteCompanyList.classList.contains('show')) { hideSuggestions(); return; }
  closeInviteModal();
});

/* ---------- searchable company combobox ---------- */
function renderSuggestions(query) {
  var q = query.trim().toLowerCase();
  var matches = allClients.filter(function (c) { return c.name.toLowerCase().indexOf(q) !== -1; });
  if (matches.length === 0) {
    inviteCompanyList.innerHTML = '<li class="combobox-empty">Kein Treffer – wird als neuer Kunde angelegt</li>';
  } else {
    inviteCompanyList.innerHTML = matches.map(function (c) {
      return '<li data-name="' + esc(c.name) + '">' + esc(c.name) + '</li>';
    }).join('');
  }
  inviteCompanyList.classList.add('show');
}
function hideSuggestions() { inviteCompanyList.classList.remove('show'); }

inviteCompanyInput.addEventListener('focus', function () { renderSuggestions(inviteCompanyInput.value); });
inviteCompanyInput.addEventListener('input', function () { renderSuggestions(inviteCompanyInput.value); });
inviteCompanyInput.addEventListener('blur', function () { hideSuggestions(); });

// The classic combobox footgun: closing the list on the input's `blur` fires
// BEFORE a `click` on a suggestion registers, so clicks never land. Fix:
// listen on `mousedown` (fires before blur) and call preventDefault() so the
// input never actually loses focus for this interaction - blur simply never
// fires for it at all, which is more robust than a setTimeout-delayed blur.
inviteCompanyList.addEventListener('mousedown', function (e) {
  var li = e.target.closest('li[data-name]');
  if (!li) return;
  e.preventDefault();
  inviteCompanyInput.value = li.dataset.name;
  hideSuggestions();
});

/* ---------- submit ---------- */
document.getElementById('invite-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var email = inviteEmailInput.value.trim();
  var companyName = inviteCompanyInput.value.trim();
  if (!email || !companyName) return;

  hideSuggestions();
  hideEl(inviteErrorEl);
  hideEl(inviteSuccessEl);
  var btn = document.getElementById('invite-submit');
  var originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Wird eingeladen…';

  getAccessToken().then(function (token) {
    if (!token) throw new Error('Keine gültige Sitzung.');
    return fetch('/.netlify/functions/invite-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ email: email, companyName: companyName })
    });
  }).then(function (res) {
    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
  }).then(function (result) {
    if (!result.ok || !result.data.ok) throw new Error((result.data && result.data.error) || 'Unbekannter Fehler.');
    var d = result.data;
    var parts = [];
    parts.push(d.clientCreated ? 'Neuer Kunde „' + esc(d.clientName) + '" angelegt.' : 'Mit bestehendem Kunden „' + esc(d.clientName) + '" verknüpft.');
    parts.push(d.userInvited ? 'Einladungs-E-Mail an ' + esc(d.email) + ' gesendet.' : 'Bestehendes Konto neu verknüpft (keine neue E-Mail versendet).');
    showEl(inviteSuccessEl, parts.join(' '));
    inviteEmailInput.value = '';
    inviteCompanyInput.value = '';
    loadClients();
    inviteEmailInput.focus();
    // modal intentionally stays open - admin onboards clients often and can add several in a row
  }).catch(function (err) {
    showEl(inviteErrorEl, 'Fehler: ' + err.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = originalLabel;
  });
});

requireAdminSession().then(function (profile) {
  if (!profile) return;
  document.getElementById('authbar-who').innerHTML = 'Angemeldet als <strong>' + esc(profile.email || '') + '</strong> (Admin)';
  loadClients();
  loadOverview();
}).catch(function (err) { console.error(err); });
