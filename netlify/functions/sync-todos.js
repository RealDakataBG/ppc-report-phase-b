/* Scheduled function (see netlify.toml: runs @hourly). Netlify does not
 * expose scheduled functions via a public URL in production, so this has no
 * auth check of its own - that constraint is what it relies on for safety.
 * For an on-demand equivalent (e.g. testing, or an admin wanting the latest
 * sheet changes immediately), see sync-todos-manual.js.
 */
const { runTodoSync } = require('./_lib/reconcileTodos');

exports.handler = async () => {
  try {
    const result = await runTodoSync();
    console.log('sync-todos: matched=' + result.matched.length + ' unmatched=' + result.unmatched.length);
    if (result.unmatched.length) {
      console.warn('sync-todos: unmatched sheet client names:', result.unmatched.join(', '));
    }
    return { statusCode: 200, body: JSON.stringify(Object.assign({ ok: true }, result)) };
  } catch (err) {
    console.error('sync-todos error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
