/* Shared admin-only auth check for Netlify Functions that must never be
 * reachable by a non-admin (ingest-performance, sync-todos-manual).
 *
 * Verification is two steps, both required:
 *   1. The bearer token is validated against Supabase's own Auth server
 *      (via a caller-scoped client) - proves it's a real, unexpired session.
 *   2. That user's profiles.role is looked up with the service-role client
 *      and must be 'admin'.
 */
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseAdmin } = require('./supabaseAdmin');

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function requireAdmin(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Fehlender oder ungültiger Authorization-Header.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) throw new HttpError(401, 'Fehlender Token.');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY environment variables are not set.');
  }
  const callerClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData || !userData.user) {
    throw new HttpError(401, 'Ungültige oder abgelaufene Sitzung.');
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, client_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, 'Profil konnte nicht geladen werden.');
  if (!profile || profile.role !== 'admin') {
    throw new HttpError(403, 'Nur für Admins zugänglich.');
  }

  return { user: userData.user, profile };
}

module.exports = { requireAdmin, HttpError };
