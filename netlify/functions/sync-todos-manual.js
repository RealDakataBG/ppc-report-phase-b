/* POST /.netlify/functions/sync-todos-manual
 * Auth: Authorization: Bearer <supabase access_token> (must resolve to an admin)
 * Same sync logic as the hourly scheduled job, triggered on demand from the
 * admin page's "Sync To-dos Now" button.
 */
const { requireAdmin, HttpError } = require('./_lib/requireAdmin');
const { runTodoSync } = require('./_lib/reconcileTodos');
const { jsonResponse } = require('./_lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    await requireAdmin(event);
    const result = await runTodoSync();
    return jsonResponse(200, Object.assign({ ok: true }, result));
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse(err.statusCode, { ok: false, error: err.message });
    }
    console.error('sync-todos-manual error:', err);
    return jsonResponse(500, { ok: false, error: 'Unerwarteter Serverfehler.' });
  }
};
