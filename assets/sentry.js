/* Error reporting → Sentry, without the SDK.
 *
 * Why not @sentry/browser: the site has no build step and no dependencies, and
 * the CSP is script-src 'self' — a CDN loader is blocked outright and vendoring
 * the bundle adds ~25 KB of JS to a site whose whole point is being fast. Sentry
 * accepts plain HTTPS envelopes, so this posts one directly, the same way
 * api/quote.js talks to Resend without its SDK.
 *
 * What you give up versus the real SDK: breadcrumbs, session/release tracking,
 * and source-map symbolication. What you keep: the message, a parsed stack, the
 * URL, and the browser — which is what actually tells you why Daniel's save
 * button did nothing.
 *
 * Inert until window.__AE_CONFIG.sentryDsn is set, so shipping it costs nothing.
 */
(function () {
  'use strict';

  /* Defined unconditionally so callers never have to guard. Every path below
     that declines to report leaves this no-op in place, which means
     AE_SENTRY.capture(e) is always safe to call — including on localhost and
     before anyone has pasted in a DSN. */
  window.AE_SENTRY = { capture: function () {} };

  var cfg = window.__AE_CONFIG || {};
  var dsn = cfg.sentryDsn || '';
  if (!dsn) return;

  // Never report from a dev machine — it is noise, and it burns the quota.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '' || host === '[::1]') return;

  /* DSN is https://<publicKey>@<host>/<projectId>. Anything else is a typo, and
     a typo must not throw on every page load. */
  var m = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn);
  if (!m) return;
  var endpoint = 'https://' + m[2] + '/api/' + m[3] + '/envelope/?sentry_key=' + m[1] + '&sentry_version=7';

  var MAX_EVENTS = 8;      // a render loop must not turn into a thousand POSTs
  var sent = 0;
  var seen = {};
  var busy = false;        // an error raised *inside* this reporter must not recurse

  function uuid() {
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  /* Chrome/Edge: "    at fn (https://host/f.js:12:5)"
     Firefox/Safari: "fn@https://host/f.js:12:5"
     Sentry wants oldest frame first, so the parsed list is reversed. */
  function frames(stack) {
    if (typeof stack !== 'string') return [];
    var out = [];
    stack.split('\n').forEach(function (line) {
      var c = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line) ||
              /^\s*(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
      if (!c) return;
      var file = c[2] || '';
      out.push({
        function: c[1] || '?',
        filename: file,
        lineno: Number(c[3]) || 0,
        colno: Number(c[4]) || 0,
        // Our own files are in_app; anything else is a browser extension.
        in_app: file.indexOf(location.origin) === 0,
      });
    });
    return out.reverse();
  }

  function send(type, value, stack, extra) {
    if (busy || sent >= MAX_EVENTS) return;
    var fingerprint = type + '|' + value + '|' + String(stack || '').slice(0, 200);
    if (seen[fingerprint]) return;
    seen[fingerprint] = 1;
    sent++;
    busy = true;

    var id = uuid();
    var event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      logger: 'browser',
      environment: /^(www\.)?awardsandengraving\.com$/.test(host) ? 'production' : 'preview',
      exception: { values: [{ type: type, value: value, stacktrace: { frames: frames(stack) } }] },
      request: { url: location.href, headers: { 'User-Agent': navigator.userAgent } },
      // The panel and the public site fail for different reasons and different
      // people; splitting them means an alert says who is stuck.
      tags: { area: location.pathname.indexOf('/admin') === 0 ? 'admin' : 'site', page: location.pathname },
    };
    if (extra) event.extra = extra;

    var body = JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }) + '\n' +
               JSON.stringify({ type: 'event' }) + '\n' +
               JSON.stringify(event);

    try {
      // keepalive so a failure during unload still reaches Sentry.
      fetch(endpoint, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        keepalive: true,
        mode: 'cors',
      }).catch(function () { /* reporting must never surface to the user */ });
    } catch (e) { /* ditto */ }

    busy = false;
  }

  window.addEventListener('error', function (e) {
    if (!e) return;
    var err = e.error;
    if (err && err.message) send(err.name || 'Error', err.message, err.stack);
    // A failed <img>/<script> fires error with no .error — not worth an issue.
    else if (e.message) send('Error', e.message, e.filename ? ('at ' + e.filename + ':' + e.lineno + ':' + e.colno) : '');
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && r.message) send(r.name || 'UnhandledRejection', r.message, r.stack);
    else if (r !== undefined) send('UnhandledRejection', String(r), '');
  });

  /* Armed. Replaces the no-op above — for errors the code already catches, like
     a save that came back 500, which window.onerror never sees but which is
     exactly what we want to hear about. */
  window.AE_SENTRY.capture = function (err, extra) {
    if (!err) return;
    if (typeof err === 'string') send('Error', err, '', extra);
    else send(err.name || 'Error', err.message || String(err), err.stack, extra);
  };
})();
