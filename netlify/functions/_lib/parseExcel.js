/* Pure Excel-parsing logic for the monthly performance export. No DB/network
 * access here on purpose - this module is fully unit-testable offline. The
 * caller (ingest-performance.js) is responsible for matching/creating clients
 * in the database and writing the parsed rows.
 */
const XLSX = require('xlsx');

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function normHeader(h) { return String(h == null ? '' : h).trim().toLowerCase(); }

function findCol(headerRow, candidates) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(headerRow[i]);
    for (let j = 0; j < candidates.length; j++) {
      if (h === candidates[j].toLowerCase()) return i;
    }
  }
  return -1;
}

// blank -> 0, for the raw fields the briefing says are always present
function toNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// blank -> null, for fields the briefing says can be genuinely missing
// (tacos / viewable_impressions / vcpm) - null must not be misread as "zero"
function toNumOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function divOrNull(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

// Parses a Month cell into a { year, monthIndex } pair, or null if unparseable.
// Handles the expected "June 2026" string format, and defensively also native
// Excel date cells (SheetJS hands those back as JS Date objects when the
// workbook is read with { cellDates: true }, or occasionally as a raw serial
// number) in case the source export ever changes how it formats that column.
function parseMonthCell(raw) {
  if (raw == null || raw === '') return null;

  if (raw instanceof Date) {
    // SheetJS builds cellDates Date objects from UTC components - read them
    // back the same way to avoid a local-timezone off-by-one-month shift.
    return { year: raw.getUTCFullYear(), monthIndex: raw.getUTCMonth() };
  }

  if (typeof raw === 'number') {
    // Raw Excel date serial number (fallback path, shouldn't normally occur
    // when cellDates:true is set, but handled defensively).
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && typeof parsed.y === 'number') {
      return { year: parsed.y, monthIndex: parsed.m - 1 };
    }
    return null;
  }

  const str = String(raw).trim();
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(str);
  if (!match) return null;
  const idx = EN_MONTHS.findIndex((m) => m.toLowerCase() === match[1].toLowerCase());
  if (idx === -1) return null;
  return { year: Number(match[2]), monthIndex: idx };
}

function monthCellIsTotal(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase() === 'total';
}

function computeMetrics(row) {
  const impressions = toNum(row.impressions);
  const clicks = toNum(row.clicks);
  const orders = toNum(row.orders);
  const spend = toNum(row.spend);
  const revenue = toNum(row.revenue);
  return {
    impressions, clicks, orders, spend, revenue,
    ctr: divOrNull(clicks, impressions),
    cr: divOrNull(orders, clicks),
    acos: divOrNull(spend, revenue),
    roas: divOrNull(revenue, spend),
    cpc: divOrNull(spend, clicks),
    cpo: divOrNull(spend, orders),
    asp: divOrNull(revenue, orders),
    // tacos can never be derived from ad data alone - always taken as-is from the column
    tacos: toNumOrNull(row.tacos),
    viewable_impressions: toNumOrNull(row.viewable_impressions),
    vcpm: toNumOrNull(row.vcpm)
  };
}

/**
 * @param {Buffer} buffer raw .xlsx file bytes
 * @returns {{ entities: Object<string, {total: object|null, months: Array<{month:string}&object>}>, warnings: string[] }}
 *   `month` on each monthly row is a "YYYY-MM-01" date string.
 */
function parseExcelBuffer(buffer) {
  const warnings = [];
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  let sheetRows = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    if (!rows.length) continue;
    const idx = findCol(rows[0], ['entity', 'client', 'company', 'kunde']);
    if (idx !== -1) { sheetRows = rows; break; }
    if (!sheetRows) sheetRows = rows;
  }
  if (!sheetRows || sheetRows.length < 2) {
    throw new Error('Keine gültigen Daten in der Daten-Datei gefunden.');
  }

  const header = sheetRows[0];
  const col = {
    entity: findCol(header, ['entity', 'client', 'company', 'kunde']),
    month: findCol(header, ['month', 'monat']),
    impressions: findCol(header, ['impressions']),
    clicks: findCol(header, ['clicks']),
    orders: findCol(header, ['orders', 'bestellungen']),
    spend: findCol(header, ['spend', 'kosten']),
    revenue: findCol(header, ['revenue', 'umsatz']),
    tacos: findCol(header, ['tacos']),
    viewable_impressions: findCol(header, ['viewable impressions']),
    vcpm: findCol(header, ['vcpm'])
  };
  if (col.entity === -1 || col.month === -1) {
    throw new Error('Spalten "Entity" und "Month" wurden in der Daten-Datei nicht gefunden.');
  }

  const entities = {};
  let currentEntity = null;

  for (let r = 1; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    const rawEntity = String(row[col.entity] == null ? '' : row[col.entity]).trim();
    const rawMonth = row[col.month];

    // forward-fill: the real export only populates Entity on each block's Total row
    if (rawEntity) currentEntity = rawEntity;

    if (!rawMonth && rawMonth !== 0) continue; // blank spacer row between entity blocks, skip silently

    if (!currentEntity) {
      warnings.push('Zeile ' + (r + 1) + ': Monat ohne zugehörigen Kunden übersprungen.');
      continue;
    }

    const rawRow = {
      impressions: row[col.impressions], clicks: row[col.clicks], orders: row[col.orders],
      spend: row[col.spend], revenue: row[col.revenue], tacos: col.tacos !== -1 ? row[col.tacos] : '',
      viewable_impressions: col.viewable_impressions !== -1 ? row[col.viewable_impressions] : '',
      vcpm: col.vcpm !== -1 ? row[col.vcpm] : ''
    };
    const metrics = computeMetrics(rawRow);

    if (!entities[currentEntity]) entities[currentEntity] = { total: null, months: [] };

    if (monthCellIsTotal(rawMonth)) {
      entities[currentEntity].total = metrics;
      continue;
    }

    const parsed = parseMonthCell(rawMonth);
    if (!parsed) {
      warnings.push('Zeile ' + (r + 1) + ' (' + currentEntity + '): unlesbarer Monatswert "' + rawMonth + '" übersprungen.');
      continue;
    }
    const monthStr = parsed.year + '-' + String(parsed.monthIndex + 1).padStart(2, '0') + '-01';
    entities[currentEntity].months.push(Object.assign({ month: monthStr }, metrics));
  }

  Object.keys(entities).forEach((name) => {
    entities[name].months.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  });

  return { entities, warnings };
}

module.exports = { parseExcelBuffer, normHeader, findCol, toNum, toNumOrNull, parseMonthCell, EN_MONTHS };
