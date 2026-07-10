import { supabase, requireSession, signOut } from './supabase-client.js';

var reportsRoot = document.getElementById('reports-root');
var loadingWrap = document.getElementById('loading-wrap');
var errorWrap = document.getElementById('error-wrap');
var errorEl = document.getElementById('dashboard-error');

document.getElementById('logout-btn').addEventListener('click', function () { signOut(); });

function showError(msg) {
  loadingWrap.style.display = 'none';
  errorWrap.style.display = 'block';
  errorEl.textContent = msg;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Today's real local calendar month, as a "YYYY-MM-01" cutoff string -
// performance_monthly rows on or after this are excluded (still-accumulating
// current-month data would be misleading).
function currentMonthCutoff() {
  var now = new Date();
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-01';
}

// Today's real local calendar month, as the bare English name the to-do
// table uses - only to-dos for this month are shown (EN_MONTHS is a global
// from report-builder.js, loaded before this module script).
function currentMonthEnglishName() {
  return EN_MONTHS[new Date().getMonth()];
}

// DB date "2026-06-01" -> "June 2026" label, built via plain string
// splitting (never `new Date(...)`) to avoid a UTC/local timezone shift
// silently moving the displayed month back by one.
function dbDateToMonthLabel(dateStr) {
  var parts = dateStr.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]) - 1;
  return EN_MONTHS[m] + ' ' + y;
}

async function main() {
  var profile;
  try {
    profile = await requireSession();
  } catch (err) {
    showError('Sitzung konnte nicht geladen werden: ' + err.message);
    return;
  }
  if (!profile) return; // requireSession already redirected to /

  document.getElementById('authbar-who').innerHTML = 'Angemeldet als <strong>' + esc(profile.email || '') + '</strong>';
  if (profile.role === 'admin') document.getElementById('admin-link').style.display = '';

  var clientId = profile.client_id;
  var params = new URLSearchParams(window.location.search);
  var overrideClientId = params.get('client');
  if (profile.role === 'admin' && overrideClientId) {
    // Admin QA affordance only - RLS still scopes every query below to a
    // client this account is actually allowed to see, so a non-admin
    // tampering with this same query param just gets an empty result, never
    // another client's data.
    clientId = overrideClientId;
  }

  if (!clientId) {
    showError('Diesem Konto ist noch kein Kunde zugeordnet. Bitte an den Admin wenden.');
    return;
  }

  try {
    var clientRes = await supabase.from('clients').select('id, name').eq('id', clientId).maybeSingle();
    if (clientRes.error) throw clientRes.error;
    if (!clientRes.data) { showError('Kunde nicht gefunden oder kein Zugriff.'); return; }
    var companyName = clientRes.data.name;

    var cutoff = currentMonthCutoff();
    var monthlyRes = await supabase.from('performance_monthly').select('*')
      .eq('client_id', clientId).lt('month', cutoff).order('month', { ascending: true });
    if (monthlyRes.error) throw monthlyRes.error;

    var todosRes = await supabase.from('todos').select('month, task')
      .eq('client_id', clientId).eq('month', currentMonthEnglishName());
    if (todosRes.error) throw todosRes.error;

    var months = monthlyRes.data.map(function (row) {
      return Object.assign({}, row, { month: dbDateToMonthLabel(row.month) });
    });

    // entry.total is intentionally omitted: buildCompanyReport's existing
    // fallback recomputes totals purely from `months`, keeping the hero
    // KPIs and "Gesamt" tab consistent with the (current-month-excluded)
    // breakdown shown below them.
    var entry = { total: null, months: months };

    reportsRoot.innerHTML = buildCompanyReport(companyName, entry, todosRes.data);
    loadingWrap.style.display = 'none';
  } catch (err) {
    showError('Report konnte nicht geladen werden: ' + err.message);
  }
}

main();
