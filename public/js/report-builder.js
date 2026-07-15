/* ===================== Digitallagune PPC Report Builder ===================== *
 * Ported from Stage A (site/app.js) - the pure HTML/SVG-string report
 * renderer, unchanged. Loaded as a classic (non-module) script so its
 * globals (buildCompanyReport, esc, EN_MONTHS, etc.) are available to the
 * page's own <script type="module"> tag, which supplies the data.
 * ============================================================================ */

/* ---------- formatting helpers (de-DE) ---------- */
var nfInt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
var nfEur0 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
var nfEur2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
var nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtInt(n) { return nfInt.format(Math.round(n || 0)); }
function fmtEUR0(n) { return nfEur0.format(Math.round(n || 0)) + ' €'; }
function fmtEUR2(n) { return nfEur2.format(n || 0) + ' €'; }
function fmtPct1(frac) { return nf1.format((frac || 0) * 100) + ' %'; }
function fmtPct2(frac) { return nf2.format((frac || 0) * 100) + ' %'; }
function fmtRatio2(n) { return nf2.format(n || 0) + 'x'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function niceMax(v) {
  if (!v || v <= 0) return 10;
  var exp = Math.floor(Math.log10(v));
  var base = Math.pow(10, exp);
  var n = v / base;
  var m;
  if (n <= 1) m = 1; else if (n <= 2) m = 2; else if (n <= 5) m = 5; else m = 10;
  return m * base;
}

/* delta: type 'value' -> relative % change; 'pp' -> percentage-point diff (values are fractions) */
function delta(curr, prev, type) {
  if (prev == null || curr == null) return null;
  if (type === 'pp') {
    var diff = (curr - prev) * 100;
    var rounded = Math.round(diff * 10) / 10;
    return { raw: diff, text: rounded === 0 ? '0 pp' : (rounded > 0 ? '+' : '−') + nf1.format(Math.abs(rounded)) + ' pp', zero: rounded === 0 };
  }
  if (prev === 0) return null;
  var pct = (curr - prev) / Math.abs(prev) * 100;
  var r2 = Math.round(pct * 10) / 10;
  return { raw: pct, text: r2 === 0 ? '0 %' : (r2 > 0 ? '+' : '−') + nf1.format(Math.abs(r2)) + ' %', zero: r2 === 0 };
}

function dltHtml(curr, prev, type, dir) {
  var d = delta(curr, prev, type);
  if (!d) return '';
  var arrow = d.zero ? '→' : (d.raw > 0 ? '▲' : '▼');
  var cls = 'dn';
  if (!d.zero) {
    if (dir === 'normal') cls = d.raw > 0 ? 'dg' : 'db';
    else if (dir === 'inverse') cls = d.raw > 0 ? 'db' : 'dg';
    else cls = 'dn';
  }
  return '<span class="dlt ' + cls + '">' + arrow + ' ' + d.text + '</span>';
}

/* ---------- month helpers ---------- */
var DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
var DE_MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function parseMonth(label) {
  if (!label) return null;
  var d = new Date(label);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth(), key: d.getFullYear() * 12 + d.getMonth() };
  return null;
}
function deMonthLabel(label) {
  var p = parseMonth(label);
  if (!p) return label;
  return DE_MONTHS[p.m] + ' ' + p.y;
}
function deMonthShort(label) {
  var p = parseMonth(label);
  if (!p) return label;
  return DE_MONTHS_SHORT[p.m];
}

/* bare English month name (no year), as used by the to-do sheet header row */
var EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function enMonthIndex(name) {
  var norm = String(name || '').trim().toLowerCase();
  for (var i = 0; i < EN_MONTHS.length; i++) { if (EN_MONTHS[i].toLowerCase() === norm) return i; }
  return -1;
}
function deMonthFromEnglish(name) {
  var i = enMonthIndex(name);
  return i === -1 ? name : DE_MONTHS[i];
}

/* ---------- SVG chart builders ---------- */
function svgOpen(vb) { return '<svg viewBox="0 0 ' + vb.split(' ')[2] + ' ' + vb.split(' ')[3] + '" class="chart" role="img">'; }

function dualBarChart(months, seriesA, seriesB, colorA, colorB) {
  var W = 760, H = 300, x0 = 56, x1 = 744, baseline = 254, top = 24;
  var plotH = baseline - top;
  var max = niceMax(Math.max.apply(null, seriesA.concat(seriesB).concat([1])));
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img">';
  for (var g = 0; g <= 4; g++) {
    var y = baseline - (g / 4) * plotH;
    svg += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="#EEF2F6" stroke-width="1"/>';
    svg += '<text x="' + (x0 - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="ax">' + fmtInt(max * g / 4) + '</text>';
  }
  var n = months.length;
  var slot = (x1 - x0) / n;
  var barW = Math.min(34, slot * 0.28);
  var gap = Math.max(3, barW * 0.12);
  for (var i = 0; i < n; i++) {
    var slotX = x0 + i * slot;
    var totalW = barW * 2 + gap;
    var leftPad = (slot - totalW) / 2;
    var bx1 = slotX + leftPad;
    var bx2 = bx1 + barW + gap;
    var h1 = (seriesA[i] / max) * plotH;
    var h2 = (seriesB[i] / max) * plotH;
    svg += '<rect class="viz-el bar-el" x="' + bx1.toFixed(1) + '" y="' + (baseline - h1).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h1.toFixed(1) + '" rx="4" fill="' + colorA + '"/>';
    svg += '<rect class="viz-el bar-el" x="' + bx2.toFixed(1) + '" y="' + (baseline - h2).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h2.toFixed(1) + '" rx="4" fill="' + colorB + '"/>';
    svg += '<text x="' + (slotX + slot / 2).toFixed(1) + '" y="272" text-anchor="middle" class="axm">' + esc(deMonthShort(months[i])) + '</text>';
  }
  svg += '</svg>';
  return svg;
}

function lineChart(months, values, color, gid, pctFmt) {
  var W = 760, H = 240, x0 = 56, x1 = 744, baseline = 198, top = 20;
  var plotH = baseline - top;
  var maxPct = niceMax(Math.max.apply(null, values.map(function (v) { return v * 100; }).concat([1])));
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img">';
  for (var g = 0; g <= 4; g++) {
    var y = baseline - (g / 4) * plotH;
    svg += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="#EEF2F6" stroke-width="1"/>';
    svg += '<text x="' + (x0 - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="ax">' + Math.round(maxPct * g / 4) + '%</text>';
  }
  var n = months.length;
  var pts = [];
  for (var i = 0; i < n; i++) {
    var x = n > 1 ? x0 + (i / (n - 1)) * (x1 - x0) : (x0 + x1) / 2;
    var y2 = baseline - (values[i] * 100 / maxPct) * plotH;
    pts.push([x, y2]);
  }
  svg += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.18"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
  var areaD = 'M ' + pts[0][0].toFixed(1) + ' ' + baseline.toFixed(1) + ' ';
  pts.forEach(function (p) { areaD += 'L ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; });
  areaD += 'L ' + pts[pts.length - 1][0].toFixed(1) + ' ' + baseline.toFixed(1) + ' Z';
  svg += '<path d="' + areaD + '" fill="url(#' + gid + ')"/>';
  var lineD = pts.map(function (p, idx) { return (idx === 0 ? 'M ' : 'L ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  svg += '<path d="' + lineD + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  pts.forEach(function (p, idx) {
    svg += '<circle class="viz-el line-pt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="#FFFFFF" stroke="' + color + '" stroke-width="2"/>';
    var anchor = idx === 0 ? 'start' : (idx === pts.length - 1 ? 'end' : 'middle');
    var tx = idx === 0 ? p[0] + 6 : (idx === pts.length - 1 ? p[0] - 6 : p[0]);
    svg += '<text x="' + tx.toFixed(1) + '" y="' + (p[1] - 10).toFixed(1) + '" text-anchor="' + anchor + '" class="pt">' + Math.round(values[idx] * 100) + '%</text>';
  });
  months.forEach(function (m, idx) {
    svg += '<text x="' + pts[idx][0].toFixed(1) + '" y="216" text-anchor="middle" class="axm">' + esc(deMonthShort(m)) + '</text>';
  });
  svg += '</svg>';
  return svg;
}

function singleBarChart(months, values, color) {
  var W = 760, H = 220, x0 = 56, x1 = 744, baseline = 178, top = 22;
  var plotH = baseline - top;
  var max = niceMax(Math.max.apply(null, values.concat([1])));
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img">';
  for (var g = 0; g <= 4; g++) {
    var y = baseline - (g / 4) * plotH;
    svg += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="#EEF2F6" stroke-width="1"/>';
    svg += '<text x="' + (x0 - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="ax">' + fmtInt(max * g / 4) + '</text>';
  }
  var n = months.length;
  var slot = (x1 - x0) / n;
  var barW = Math.min(46, slot * 0.34);
  for (var i = 0; i < n; i++) {
    var slotX = x0 + i * slot;
    var bx = slotX + (slot - barW) / 2;
    var h = (values[i] / max) * plotH;
    svg += '<rect class="viz-el bar-el" x="' + bx.toFixed(1) + '" y="' + (baseline - h).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="4" fill="' + color + '"/>';
    svg += '<text x="' + (slotX + slot / 2).toFixed(1) + '" y="' + (baseline - h - 7).toFixed(1) + '" text-anchor="middle" class="pt">' + fmtInt(values[i]) + '</text>';
    svg += '<text x="' + (slotX + slot / 2).toFixed(1) + '" y="196" text-anchor="middle" class="axm">' + esc(deMonthShort(months[i])) + '</text>';
  }
  svg += '</svg>';
  return svg;
}

function funnelChart(impressions, clicks, orders, ctr, cr) {
  var svg = '<svg viewBox="0 0 760 320" class="chart" role="img">';
  svg += '<polygon class="viz-el funnel-seg" points="50,10 710,10 460,68 300,68" fill="#5EB8B5"/>';
  svg += '<polygon class="viz-el funnel-seg" points="300,106 460,106 443,164 317,164" fill="#0E7C7B"/>';
  svg += '<polygon class="viz-el funnel-seg" points="317,202 443,202 438,260 322,260" fill="#12A150"/>';
  svg += '<text x="380" y="36" text-anchor="middle" class="fnm">Impressions</text>';
  svg += '<text x="380" y="54" text-anchor="middle" class="fnv">' + fmtInt(impressions) + '</text>';
  svg += '<text x="380" y="132" text-anchor="middle" class="fnm">Clicks</text>';
  svg += '<text x="380" y="150" text-anchor="middle" class="fnv">' + fmtInt(clicks) + '</text>';
  svg += '<text x="380" y="228" text-anchor="middle" class="fnm">Bestellungen</text>';
  svg += '<text x="380" y="246" text-anchor="middle" class="fnv">' + fmtInt(orders) + '</text>';
  svg += '<text x="380" y="86" text-anchor="middle" class="fconv">CTR ' + fmtPct2(ctr) + '</text>';
  svg += '<text x="380" y="182" text-anchor="middle" class="fconv">CR ' + fmtPct1(cr) + '</text>';
  svg += '</svg>';
  return svg;
}

/* ---------- metric config for KPI grids ---------- */
var METRICS = [
  { key: 'revenue', label: 'Werbeumsatz', fmt: fmtEUR0, type: 'value', dir: 'normal' },
  { key: 'spend', label: 'Werbekosten', fmt: fmtEUR0, type: 'value', dir: 'neutral' },
  { key: 'acos', label: 'ACOS', fmt: fmtPct1, type: 'pp', dir: 'inverse' },
  { key: 'roas', label: 'ROAS', fmt: fmtRatio2, type: 'value', dir: 'normal' },
  { key: 'tacos', label: 'TACOS', fmt: fmtPct1, type: 'pp', dir: 'inverse' },
  { key: 'impressions', label: 'Impressions', fmt: fmtInt, type: 'value', dir: 'neutral' },
  { key: 'clicks', label: 'Clicks', fmt: fmtInt, type: 'value', dir: 'neutral' },
  { key: 'ctr', label: 'CTR', fmt: fmtPct2, type: 'pp', dir: 'neutral' },
  { key: 'orders', label: 'Bestellungen', fmt: fmtInt, type: 'value', dir: 'normal' },
  { key: 'cr', label: 'Conversion Rate', fmt: fmtPct1, type: 'pp', dir: 'normal' },
  { key: 'cpc', label: 'CPC', fmt: fmtEUR2, type: 'value', dir: 'inverse' },
  { key: 'cpo', label: 'Kosten / Bestellung', fmt: fmtEUR2, type: 'value', dir: 'inverse' },
  { key: 'asp', label: 'Ø Verkaufspreis', fmt: fmtEUR2, type: 'value', dir: 'neutral' }
];

function kpiGrid(row, prevRow) {
  var html = '<div class="kgrid mkgrid">';
  METRICS.forEach(function (m) {
    html += '<div class="kpi"><div class="lab">' + m.label + '</div><div class="val">' + m.fmt(row[m.key]) + '</div>';
    if (prevRow) html += dltHtml(row[m.key], prevRow[m.key], m.type, m.dir);
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function flowBar(revenue, spend) {
  var tot = revenue + spend;
  var pr = tot > 0 ? (revenue / tot) * 100 : 50;
  var ps = 100 - pr;
  return '<div class="flowbar"><div class="track">' +
    '<div class="seg" style="background:#12A150;width:' + pr.toFixed(1) + '%">' + fmtEUR0(revenue) + '</div>' +
    '<div class="seg" style="background:#E0852B;width:' + ps.toFixed(1) + '%">' + fmtEUR0(spend) + '</div>' +
    '</div><div class="flowleg"><span><span class="dot" style="background:#12A150"></span>Werbeumsatz</span>' +
    '<span><span class="dot" style="background:#E0852B"></span>Werbekosten</span>' +
    '<span style="margin-left:auto">Verhältnis Umsatz : Kosten</span></div></div>';
}

/* ---------- analysis / plan generation ---------- */
function buildAnalysis(months) {
  var n = months.length;
  var obs = [];
  var rec = [];
  if (n === 0) {
    obs.push('Für diesen Kunden liegen keine monatlichen Datenpunkte vor.');
  } else {
    var last = months[n - 1];
    var prev = n > 1 ? months[n - 2] : null;
    var lastLabel = deMonthLabel(last.month);
    if (prev) {
      var revD = delta(last.revenue, prev.revenue, 'value');
      var acosD = delta(last.acos, prev.acos, 'pp');
      if (revD) {
        obs.push('Der Werbeumsatz ist im ' + lastLabel + ' auf ' + fmtEUR2(last.revenue) + ' ' + (revD.raw >= 0 ? 'gestiegen' : 'gesunken') + ' (' + revD.text + ' ggü. Vormonat).');
      }
      if (acosD) {
        var acosTail = acosD.raw > 0 ? 'pro Umsatz-Euro wurde mehr Werbebudget eingesetzt.' : 'die Werbeeffizienz hat sich verbessert.';
        obs.push('Der ACOS ist auf ' + fmtPct1(last.acos) + ' ' + (acosD.raw > 0 ? 'gestiegen' : 'gesunken') + ' (' + acosD.text + ') – ' + acosTail);
      }
    } else {
      obs.push('Im ' + lastLabel + ' wurden ' + fmtEUR2(last.revenue) + ' Werbeumsatz bei ' + fmtPct1(last.acos) + ' ACOS erzielt.');
    }
    if (last.cr < 0.02) {
      obs.push('Die Conversion Rate liegt mit ' + fmtPct1(last.cr) + ' unter dem typischen Zielkorridor – Klicks konvertieren unterdurchschnittlich.');
      rec.push('Listing-Conversion stärken (Hauptbild, A+ Content, Bewertungen, Preis) und Budget auf konvertierende Kampagnen bündeln.');
    } else {
      obs.push('Die Conversion Rate liegt mit ' + fmtPct1(last.cr) + ' in einem soliden Bereich.');
    }
    if (prev && last.acos - prev.acos > 0.001) {
      rec.push('Such-/Platzierungsberichte auf Begriffe mit hohem ACOS prüfen, Gebote dort senken und negative Keywords ergänzen.');
    }
    if (rec.length === 0) {
      rec.push('Aktuelle Kampagnenstruktur beibehalten und Performance im nächsten Monat weiter beobachten.');
    }
  }
  var html = '<div class="analysis"><ul class="obs">' + obs.map(function (o) { return '<li>' + esc(o).replace(/&amp;/g,'&') + '</li>'; }).join('') + '</ul>';
  html += '<div class="rec"><div class="rl">Handlungsbedarf</div><ul>' + rec.map(function (r) { return '<li>' + esc(r).replace(/&amp;/g,'&') + '</li>'; }).join('') + '</ul></div></div>';
  return html;
}

function buildPlan(companyName, todos) {
  var html = '<div class="plan"><div class="plan-hero">';
  html += '<div class="plan-season-badge"><span class="ico">✓</span>Automatisch abgeglichene To-dos</div>';
  html += '<div class="plan-title">Was als Nächstes für ' + esc(companyName) + ' ansteht</div>';
  html += '<div class="plan-season-text">Automatisch anhand des Kundennamens abgeglichen.</div>';
  html += '</div><div class="plan-body">';
  if (!todos || todos.length === 0) {
    html += '<div class="plan-empty">Keine offenen To-dos für diesen Kunden hinterlegt.</div>';
  } else {
    html += '<div class="plan-next-badge">▶ ' + todos.length + ' Maßnahme' + (todos.length > 1 ? 'n' : '') + '</div>';
    html += '<ul class="plan-actions">';
    todos.forEach(function (t, idx) {
      html += '<li><div class="plan-num">' + (idx + 1) + '</div><span>' +
        '<span class="plan-meta">' + esc(deMonthFromEnglish(t.month)) + '</span>' +
        esc(t.task || '(kein Titel)') +
        '</span></li>';
    });
    html += '</ul>';
  }
  html += '</div></div>';
  return html;
}

/* ---------- report builder ---------- */
var reportCounter = 0;

function buildCompanyReport(companyName, entry, todos) {
  reportCounter++;
  var months = entry.months;
  var total = entry.total || (function () {
    var agg = { entity: companyName, month: 'Total', impressions: 0, clicks: 0, orders: 0, spend: 0, revenue: 0 };
    months.forEach(function (m) { agg.impressions += m.impressions; agg.clicks += m.clicks; agg.orders += m.orders; agg.spend += m.spend; agg.revenue += m.revenue; });
    agg.ctr = agg.impressions ? agg.clicks / agg.impressions : 0;
    agg.cr = agg.clicks ? agg.orders / agg.clicks : 0;
    agg.acos = agg.revenue ? agg.spend / agg.revenue : 0;
    agg.roas = agg.spend ? agg.revenue / agg.spend : 0;
    agg.tacos = agg.acos;
    agg.cpc = agg.clicks ? agg.spend / agg.clicks : 0;
    agg.cpo = agg.orders ? agg.spend / agg.orders : 0;
    agg.asp = agg.orders ? agg.revenue / agg.orders : 0;
    return agg;
  })();

  var periodLabel = months.length ? (deMonthShort(months[0].month) + '–' + deMonthShort(months[months.length - 1].month) + ' ' + parseMonth(months[months.length - 1].month).y) : '';

  var slug = 'r' + reportCounter;

  /* ---- header + hero ---- */
  var html = '<div class="report" id="report-' + slug + '">';
  html += '<header class="hd"><div class="hd-in">';
  html += '<div class="eyebrow"><span class="eyebrow-l"><img class="hd-logo" src="assets/logo.jpg" alt="Digitallagune">Digitallagune · Amazon Ads Management</span>';
  if (periodLabel) html += '<span class="pill"><i></i>Zeitraum ' + esc(periodLabel) + '</span>';
  html += '</div><h1>' + esc(companyName) + '</h1><div class="sub">Automatisch erstellter Amazon-PPC-Performance-Report</div>';
  html += '</div></header>';

  html += '<div class="wrap"><div class="hero"><div class="hegrid">';
  html += '<div class="he"><div class="lab">Werbeumsatz</div><div class="val" style="color:#12A150">' + fmtEUR0(total.revenue) + '</div><div class="sub2">Umsatz über Ads</div></div>';
  html += '<div class="he"><div class="lab">Werbekosten</div><div class="val" style="color:#E0852B">' + fmtEUR0(total.spend) + '</div><div class="sub2">Ad Spend gesamt</div></div>';
  html += '<div class="he"><div class="lab">ACOS</div><div class="val" style="color:#7A9B2E">' + fmtPct1(total.acos) + '</div><div class="sub2">Kosten je Umsatz-€</div></div>';
  html += '<div class="he"><div class="lab">ROAS</div><div class="val" style="color:#0E7C7B">' + fmtRatio2(total.roas) + '</div><div class="sub2">Umsatz je Werbe-€</div></div>';
  html += '</div>' + flowBar(total.revenue, total.spend) + '</div>';

  /* ---- monthly charts ---- */
  if (months.length) {
    var monLabels = months.map(function (m) { return m.month; });
    html += '<section><div class="sec-h">Monatlicher Verlauf</div>';
    html += '<div class="card"><h3>Werbeumsatz vs. Werbekosten</h3><div class="leg"><span><span class="dot" style="background:#12A150"></span>Werbeumsatz</span><span><span class="dot" style="background:#E0852B"></span>Werbekosten</span></div>' +
      dualBarChart(monLabels, months.map(function (m) { return m.revenue; }), months.map(function (m) { return m.spend; }), '#12A150', '#E0852B') + '</div>';
    html += '<div class="card"><h3>ACOS-Verlauf</h3>' + lineChart(monLabels, months.map(function (m) { return m.acos; }), '#DC4C3F', 'ag' + slug) + '</div>';
    html += '<div class="card"><h3>Bestellungen pro Monat</h3>' + singleBarChart(monLabels, months.map(function (m) { return m.orders; }), '#0E7C7B') + '</div>';
    html += '</section>';
  }

  /* ---- month tabs detail ---- */
  var panels = [];
  var tabs = [];
  tabs.push({ i: 0, label: 'Gesamt' });
  months.forEach(function (m, idx) { tabs.push({ i: idx + 1, label: deMonthLabel(m.month) }); });
  var activeIdx = tabs.length - 1;

  panels.push({ i: 0, label: 'Gesamt', row: total, prev: null, note: 'Gesamter Zeitraum – kumulierte Werte aller Monate.' });
  months.forEach(function (m, idx) {
    var prev = idx > 0 ? months[idx - 1] : null;
    var note = '';
    if (prev) {
      var rd = delta(m.revenue, prev.revenue, 'value');
      var ad = delta(m.acos, prev.acos, 'pp');
      note = 'ggü. Vormonat: Umsatz ' + (rd ? rd.text.replace('+', '+') : 'n/a') + ', ACOS ' + (ad ? ad.text : 'n/a');
    } else {
      note = 'Einzelmonat – alle Werte dieses Monats im Detail.';
    }
    panels.push({ i: idx + 1, label: deMonthLabel(m.month), row: m, prev: prev, note: note });
  });

  html += '<section><div class="sec-h">Monats-Detailansicht</div>';
  html += '<div class="mtabs" role="tablist" aria-label="Monat wählen">';
  tabs.forEach(function (t) {
    html += '<button class="mtab' + (t.i === activeIdx ? ' active' : '') + '" data-i="' + t.i + '" role="tab" aria-selected="' + (t.i === activeIdx) + '">' + esc(t.label) + '</button>';
  });
  html += '</div><div class="mpanels" data-report="' + slug + '">';
  panels.forEach(function (p) {
    html += '<div class="mpanel' + (p.i === activeIdx ? ' active' : '') + '" data-i="' + p.i + '" role="tabpanel" aria-label="' + esc(p.label) + '">';
    html += '<div class="mhead"><span class="mtitle">' + esc(p.label) + '</span><span class="mnote">' + esc(p.note) + '</span></div>';
    html += flowBar(p.row.revenue, p.row.spend);
    html += kpiGrid(p.row, p.prev);
    html += '<div class="card fcard"><h3>Funnel: Impressions → Clicks → Bestellungen</h3>' + funnelChart(p.row.impressions, p.row.clicks, p.row.orders, p.row.ctr, p.row.cr) + '</div>';
    html += '</div>';
  });
  html += '</div></section>';

  /* ---- monthly table ---- */
  if (months.length) {
    html += '<section><div class="sec-h">Monatsübersicht</div><div class="card scrollx"><table class="tbl">';
    html += '<thead><tr><th>Monat</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>Best.</th><th>CR</th><th>Spend</th><th>Umsatz</th><th>ACOS</th><th>ROAS</th></tr></thead><tbody>';
    var byMonthDesc = months.slice().reverse();
    byMonthDesc.forEach(function (m) {
      var acosColor = m.acos < 0.25 ? '#12A150' : '#7A9B2E';
      html += '<tr><td>' + esc(deMonthLabel(m.month)) + '</td><td>' + fmtInt(m.impressions) + '</td><td>' + fmtInt(m.clicks) + '</td><td>' + fmtPct2(m.ctr) + '</td><td>' + fmtInt(m.orders) + '</td><td>' + fmtPct1(m.cr) + '</td><td>' + fmtEUR2(m.spend) + '</td><td>' + fmtEUR2(m.revenue) + '</td><td style="color:' + acosColor + ';font-weight:600">' + fmtPct1(m.acos) + '</td><td>' + fmtRatio2(m.roas) + '</td></tr>';
    });
    html += '<tr class="totrow"><td>Gesamt</td><td>' + fmtInt(total.impressions) + '</td><td>' + fmtInt(total.clicks) + '</td><td>' + fmtPct2(total.ctr) + '</td><td>' + fmtInt(total.orders) + '</td><td>' + fmtPct1(total.cr) + '</td><td>' + fmtEUR2(total.spend) + '</td><td>' + fmtEUR2(total.revenue) + '</td><td>' + fmtPct1(total.acos) + '</td><td>' + fmtRatio2(total.roas) + '</td></tr>';
    html += '</tbody></table></div></section>';
  }

  /* ---- analysis ---- */
  html += '<section><div class="sec-h">Analyse & Bewertung</div>' + buildAnalysis(months) + '</section>';

  /* ---- plan (from todos) ---- */
  if (todos !== null) {
    html += '<section><div class="sec-h">To-do & Plan</div>' + buildPlan(companyName, todos) + '</section>';
  }

  /* ---- footer ---- */
  var today = new Date();
  html += '<footer><span>Digitallagune – Amazon PPC Management</span><span>Stand: ' + ('' + today.getDate()).padStart(2, '0') + '.' + ('' + (today.getMonth() + 1)).padStart(2, '0') + '.' + today.getFullYear() + ' · automatisch generiert</span></footer>';
  html += '</div></div>';
  return html;
}

/* ---------- month-tab wiring (event delegation, works for all reports) ---------- */
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.mtab');
  if (!btn) return;
  var tabsWrap = btn.closest('.mtabs');
  var panelsWrap = tabsWrap.nextElementSibling;
  var i = btn.dataset.i;
  tabsWrap.querySelectorAll('.mtab').forEach(function (t) {
    var on = t.dataset.i === i;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  panelsWrap.querySelectorAll('.mpanel').forEach(function (p) {
    p.classList.toggle('active', p.dataset.i === i);
  });
});
