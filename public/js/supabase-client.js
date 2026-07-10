import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Safe to expose in the browser - Row Level Security is the real boundary,
// not this key. Never put the service_role key anywhere in this folder.
const SUPABASE_URL = 'https://rxxkfbmsfyywcalvicic.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eGtmYm1zZnl5d2NhbHZpY2ljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Njg1NzUsImV4cCI6MjA5OTI0NDU3NX0.yAtoGBdZl6xYHijW9e6e3d9fSP8JCey9ZTbb8lT1X4A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

/** Returns the caller's profile row (id, role, client_id, email), or null if signed out. */
export async function getCurrentProfile() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData && sessionData.session;
  if (!session) return null;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, client_id, email')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return profile;
}

/** For dashboard.html: any signed-in user (client or admin) may stay. */
export async function requireSession() {
  const profile = await getCurrentProfile();
  if (!profile) { window.location.replace('/'); return null; }
  return profile;
}

/** For admin.html: signed-in AND role === 'admin', else bounced to the client dashboard. */
export async function requireAdminSession() {
  const profile = await requireSession();
  if (profile && profile.role !== 'admin') {
    window.location.replace('/dashboard.html');
    return null;
  }
  return profile;
}

/** For index.html (login): if already signed in, skip the login form entirely. */
export async function redirectIfSignedIn() {
  const profile = await getCurrentProfile();
  if (profile) {
    window.location.replace(profile.role === 'admin' ? '/admin.html' : '/dashboard.html');
  }
  return profile;
}

/** Bearer token for calling the Netlify Functions (ingest-performance, sync-todos-manual). */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('/');
}
