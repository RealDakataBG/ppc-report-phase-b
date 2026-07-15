/* POST /.netlify/functions/invite-client
 * Auth: Authorization: Bearer <supabase access_token> (must resolve to an admin)
 * Body: { email: string, companyName: string }
 *
 * One-click "streamlined client onboarding": resolves or creates the
 * company, then either invites a brand-new email (which also sends the
 * actual invite email) or re-links an already-existing account to the
 * resolved client - never both, and never touches profiles.role (granting
 * admin access stays a deliberate manual-SQL-only action).
 */
const { requireAdmin, HttpError } = require('./_lib/requireAdmin');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { matchClientName } = require('./_lib/matchClientName');
const { jsonResponse } = require('./_lib/http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    const email = String(payload.email || '').trim().toLowerCase();
    const companyName = String(payload.companyName || '').trim();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Ungültige E-Mail-Adresse.');
    if (!companyName) throw new HttpError(400, 'Firmenname fehlt.');

    const admin = getSupabaseAdmin();

    // Resolve-or-create the client, same pattern as ingest-performance.js.
    const { data: existingClients, error: clientsError } = await admin.from('clients').select('id, name');
    if (clientsError) throw new HttpError(500, 'Kundenliste konnte nicht geladen werden: ' + clientsError.message);

    let clientId, clientName, clientCreated;
    const matched = matchClientName(existingClients, companyName);
    if (matched) {
      clientId = matched.id;
      clientName = matched.name;
      clientCreated = false;
    } else {
      const { data: created, error: createError } = await admin
        .from('clients')
        .insert({ name: companyName })
        .select('id, name')
        .single();
      if (createError) throw new HttpError(500, 'Kunde konnte nicht angelegt werden: ' + createError.message);
      clientId = created.id;
      clientName = created.name;
      clientCreated = true;
    }

    // Is there already an account for this email? (re-link branch)
    // Plain equality on the already-lowercased string, not .ilike() - an
    // ilike pattern would misinterpret a literal "_" in an email's local
    // part (e.g. john_doe@x.com) as a SQL wildcard.
    const { data: existingProfile, error: profileLookupError } = await admin
      .from('profiles')
      .select('id, client_id')
      .eq('email', email)
      .maybeSingle();
    if (profileLookupError) throw new HttpError(500, 'Profil-Suche fehlgeschlagen: ' + profileLookupError.message);

    let userId, userInvited, previousClientId;

    if (existingProfile) {
      userId = existingProfile.id;
      previousClientId = existingProfile.client_id;
      userInvited = false;
    } else {
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteError) {
        const alreadyRegistered = /already registered|already exists/i.test(inviteError.message || '');
        if (alreadyRegistered) {
          throw new HttpError(409, 'Diese E-Mail-Adresse hat bereits ein Konto, aber kein zugehöriges Profil wurde gefunden. Bitte manuell in Supabase prüfen.');
        }
        throw new HttpError(500, 'Einladung fehlgeschlagen: ' + inviteError.message);
      }
      userId = inviteData.user.id;
      userInvited = true;
      previousClientId = null;
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({ client_id: clientId })
      .eq('id', userId);
    if (updateError) throw new HttpError(500, 'Kunde konnte nicht zugeordnet werden: ' + updateError.message);

    return jsonResponse(200, {
      ok: true,
      email,
      clientId,
      clientName,
      clientCreated,
      userInvited,
      previousClientId: userInvited ? null : previousClientId
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse(err.statusCode, { ok: false, error: err.message });
    }
    console.error('invite-client error:', err);
    return jsonResponse(500, { ok: false, error: 'Unerwarteter Serverfehler.' });
  }
};
