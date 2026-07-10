/* Shared core logic for both the hourly scheduled sync and the admin
 * "Sync To-dos Now" button - both just call runTodoSync().
 */
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { matchClientName } = require('./matchClientName');
const { fetchTodoSheetRows } = require('./googleSheets');

// One entry per sheet row with a non-empty client name. `items` can be an
// empty array (client name present, but every month cell now blank) - that
// case still needs to reach runTodoSync() below so stale to-dos get cleared,
// which is why this does NOT filter out empty-items rows the way a naive
// "build a map of non-empty clients" pass would.
function parseTodoSheetRows(rows) {
  const result = [];
  if (!rows.length) return result;
  const header = rows[0];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const clientName = String(row[0] == null ? '' : row[0]).trim();
    if (!clientName) continue;
    const items = [];
    for (let c = 1; c < header.length; c++) {
      const monthName = String(header[c] == null ? '' : header[c]).trim();
      const task = String(row[c] == null ? '' : row[c]).trim();
      if (!monthName || !task) continue;
      items.push({ month: monthName, task: task });
    }
    result.push({ clientName: clientName, items: items });
  }
  return result;
}

async function runTodoSync() {
  const admin = getSupabaseAdmin();
  const rows = await fetchTodoSheetRows();
  const sheetEntries = parseTodoSheetRows(rows);

  const { data: clients, error: clientsError } = await admin.from('clients').select('id, name');
  if (clientsError) throw new Error('Kundenliste konnte nicht geladen werden: ' + clientsError.message);

  const matched = [];
  const unmatched = [];

  for (const entry of sheetEntries) {
    const client = matchClientName(clients, entry.clientName);
    if (!client) {
      // Human-typed sheet, more typo-prone than the Excel export - skip and
      // report rather than auto-creating a possibly-bogus client row.
      unmatched.push(entry.clientName);
      continue;
    }

    const { error: deleteError } = await admin.from('todos').delete().eq('client_id', client.id);
    if (deleteError) {
      throw new Error('To-dos für "' + entry.clientName + '" konnten nicht gelöscht werden: ' + deleteError.message);
    }

    if (entry.items.length > 0) {
      const insertRows = entry.items.map((t) => ({ client_id: client.id, month: t.month, task: t.task }));
      const { error: insertError } = await admin.from('todos').insert(insertRows);
      if (insertError) {
        throw new Error('To-dos für "' + entry.clientName + '" konnten nicht gespeichert werden: ' + insertError.message);
      }
    }

    matched.push(entry.clientName);
  }

  return { matched, unmatched, syncedAt: new Date().toISOString() };
}

module.exports = { runTodoSync, parseTodoSheetRows };
