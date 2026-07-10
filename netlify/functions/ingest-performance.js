/* POST /.netlify/functions/ingest-performance
 * Body: { filename: string, fileBase64: string }
 * Auth: Authorization: Bearer <supabase access_token> (must resolve to an admin)
 *
 * Parses the uploaded Excel export and upserts it into performance_totals /
 * performance_monthly. Entities not yet in the `clients` table are created
 * automatically (this is the authoritative, machine-generated source of
 * which clients exist - see matchClientName usage below).
 */
const { requireAdmin, HttpError } = require('./_lib/requireAdmin');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { parseExcelBuffer } = require('./_lib/parseExcel');
const { matchClientName } = require('./_lib/matchClientName');
const { jsonResponse } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    await requireAdmin(event);

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      throw new HttpError(400, 'Ungültiger Request-Body (kein gültiges JSON).');
    }
    const { fileBase64 } = payload;
    if (!fileBase64 || typeof fileBase64 !== 'string') {
      throw new HttpError(400, 'Feld "fileBase64" fehlt oder ist ungültig.');
    }

    let buffer;
    try {
      buffer = Buffer.from(fileBase64, 'base64');
    } catch (e) {
      throw new HttpError(400, 'Datei konnte nicht dekodiert werden.');
    }

    let parsed;
    try {
      parsed = parseExcelBuffer(buffer);
    } catch (e) {
      throw new HttpError(400, e.message || 'Datei konnte nicht gelesen werden.');
    }

    const entityNames = Object.keys(parsed.entities);
    if (entityNames.length === 0) {
      throw new HttpError(400, 'Keine Kunden/Entities in der Daten-Datei gefunden.');
    }

    const admin = getSupabaseAdmin();

    const { data: existingClients, error: clientsError } = await admin.from('clients').select('id, name');
    if (clientsError) throw new HttpError(500, 'Kundenliste konnte nicht geladen werden: ' + clientsError.message);

    const clientsCreated = [];
    const clientsUpdated = [];
    const nameToId = {};

    const namesToCreate = [];
    entityNames.forEach((name) => {
      const match = matchClientName(existingClients, name);
      if (match) {
        nameToId[name] = match.id;
        clientsUpdated.push(name);
      } else {
        namesToCreate.push(name);
      }
    });

    if (namesToCreate.length > 0) {
      const { data: created, error: createError } = await admin
        .from('clients')
        .insert(namesToCreate.map((name) => ({ name })))
        .select('id, name');
      if (createError) throw new HttpError(500, 'Neue Kunden konnten nicht angelegt werden: ' + createError.message);
      created.forEach((row) => {
        nameToId[row.name] = row.id;
        clientsCreated.push(row.name);
      });
    }

    const totalsRows = [];
    const monthlyRows = [];
    entityNames.forEach((name) => {
      const clientId = nameToId[name];
      const entry = parsed.entities[name];
      if (entry.total) {
        totalsRows.push(Object.assign({ client_id: clientId }, entry.total));
      }
      entry.months.forEach((m) => {
        monthlyRows.push(Object.assign({ client_id: clientId }, m));
      });
    });

    let monthsWritten = 0;
    if (totalsRows.length > 0) {
      const { error } = await admin.from('performance_totals').upsert(totalsRows, { onConflict: 'client_id' });
      if (error) throw new HttpError(500, 'Gesamtwerte konnten nicht gespeichert werden: ' + error.message);
    }
    if (monthlyRows.length > 0) {
      const { error } = await admin.from('performance_monthly').upsert(monthlyRows, { onConflict: 'client_id,month' });
      if (error) throw new HttpError(500, 'Monatswerte konnten nicht gespeichert werden: ' + error.message);
      monthsWritten = monthlyRows.length;
    }

    return jsonResponse(200, {
      ok: true,
      clientsCreated,
      clientsUpdated,
      monthsWritten,
      warnings: parsed.warnings
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse(err.statusCode, { ok: false, error: err.message });
    }
    console.error('ingest-performance error:', err);
    return jsonResponse(500, { ok: false, error: 'Unerwarteter Serverfehler.' });
  }
};
