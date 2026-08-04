/* Server-side Sentry reporting for the API routes, without the SDK.
 *
 * Same reasoning as assets/sentry.js and the Resend call in quote.js: the
 * project has no package.json, and @sentry/node would be its first dependency.
 * Sentry's envelope endpoint is plain HTTPS, so we post to it directly.
 *
 * Env: SENTRY_DSN (server-side; may be the same DSN the browser uses — a DSN is
 * a write-only public key, it cannot read issues). Unset = no-op.
 *
 * Deliberately never throws and never rejects: a reporting failure must not turn
 * a handled error into an unhandled one.
 */

var DSN = process.env.SENTRY_DSN || '';
var parsed = null;

if (DSN) {
  var m = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(DSN);
  if (m) {
    parsed = {
      endpoint: 'https://' + m[2] + '/api/' + m[3] + '/envelope/?sentry_key=' + m[1] + '&sentry_version=7',
    };
  } else {
    console.error('sentry: SENTRY_DSN is set but is not a valid DSN; reporting disabled');
  }
}

function uuid() {
  var s = '';
  for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function frames(stack) {
  if (typeof stack !== 'string') return [];
  var out = [];
  stack.split('\n').forEach(function (line) {
    var c = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!c) return;
    var file = c[2] || '';
    out.push({
      function: c[1] || '?',
      filename: file,
      lineno: Number(c[3]) || 0,
      colno: Number(c[4]) || 0,
      // node_modules and node internals are not our code.
      in_app: file.indexOf('/var/task') === 0 || file.indexOf('/api/') !== -1,
    });
  });
  return out.reverse();
}

/**
 * Report an error. Awaitable, but safe to leave unawaited.
 * @param {Error|string} err
 * @param {{route?:string, extra?:object, tags?:object}} [ctx]
 */
async function capture(err, ctx) {
  if (!parsed || !err) return;
  ctx = ctx || {};
  try {
    var id = uuid();
    var isErr = typeof err === 'object' && err !== null;
    var event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      logger: 'api',
      environment: process.env.VERCEL_ENV || 'development',
      server_name: process.env.VERCEL_REGION || undefined,
      exception: {
        values: [{
          type: (isErr && err.name) || 'Error',
          value: (isErr ? err.message : String(err)) || 'Unknown error',
          stacktrace: { frames: frames(isErr ? err.stack : '') },
        }],
      },
      tags: Object.assign({ area: 'api', route: ctx.route || 'unknown' }, ctx.tags || {}),
      extra: ctx.extra,
    };

    var body = JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }) + '\n' +
               JSON.stringify({ type: 'event' }) + '\n' +
               JSON.stringify(event);

    await fetch(parsed.endpoint, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
    });
  } catch (e) {
    // Reporting the reporter is not a thing. Log and move on.
    console.error('sentry: could not report error:', e && e.message);
  }
}

module.exports = { capture: capture, enabled: !!parsed };
