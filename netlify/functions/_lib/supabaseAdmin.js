/* Service-role Supabase client - bypasses Row Level Security entirely.
 * Server-only. Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
const { createClient } = require('@supabase/supabase-js');

let cached = null;

function getSupabaseAdmin() {
  if (!cached) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables are not set.');
    }
    cached = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return cached;
}

module.exports = { getSupabaseAdmin };
