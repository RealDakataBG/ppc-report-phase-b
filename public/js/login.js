import { supabase, redirectIfSignedIn } from './supabase-client.js';

function showEl(el, msg) { el.textContent = msg; el.classList.add('show'); }
function hideEl(el) { el.classList.remove('show'); el.textContent = ''; }

var errorEl = document.getElementById('login-error');
var successEl = document.getElementById('login-success');
var form = document.getElementById('login-form');
var btn = document.getElementById('login-btn');

redirectIfSignedIn().catch(function (err) { console.error(err); });

// If a magic-link redirect just produced a session, jump forward immediately
// rather than waiting for the user to notice they're still on this page.
supabase.auth.onAuthStateChange(function (event, session) {
  if (session) redirectIfSignedIn().catch(function (err) { console.error(err); });
});

form.addEventListener('submit', function (e) {
  e.preventDefault();
  hideEl(errorEl);
  hideEl(successEl);
  var email = document.getElementById('email').value.trim();
  if (!email) return;

  btn.disabled = true;
  var originalLabel = btn.textContent;
  btn.textContent = 'Wird gesendet…';

  supabase.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.origin + '/' }
  }).then(function (res) {
    if (res.error) throw res.error;
    showEl(successEl, 'Login-Link gesendet – bitte E-Mail-Postfach prüfen.');
  }).catch(function (err) {
    showEl(errorEl, 'Fehler beim Senden: ' + err.message);
  }).then(function () {
    btn.disabled = false;
    btn.textContent = originalLabel;
  });
});
