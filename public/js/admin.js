import { supabase, requireAdminSession, signOut, getAccessToken } from './supabase-client.js';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

var fileData = null;

document.getElementById('logout-btn').addEventListener('click', function () { signOut(); });

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

function loadClients() {
  supabase.from('clients').select('id, name').order('name').then(function (res) {
    if (res.error) return;
    var list = document.getElementById('client-list');
    list.innerHTML = res.data.map(function (c) {
      return '<li><a href="dashboard.html?client=' + encodeURIComponent(c.id) + '">' + esc(c.name) + '</a></li>';
    }).join('');
  });
}

requireAdminSession().then(function (profile) {
  if (!profile) return;
  document.getElementById('authbar-who').innerHTML = 'Angemeldet als <strong>' + esc(profile.email || '') + '</strong> (Admin)';
  loadClients();
}).catch(function (err) { console.error(err); });
