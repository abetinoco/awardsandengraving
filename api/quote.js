/* POST /api/quote — receives the contact form and emails the shop via Resend.
 *
 * Env vars (set in Vercel → Settings → Environment Variables, and .env.local for `vercel dev`):
 *   RESEND_API_KEY  required — the Resend API key.
 *   QUOTE_TO        where quote requests land. Until the domain is verified in Resend,
 *                   this MUST be the email on the Resend account — the shared
 *                   onboarding@resend.dev sender may not deliver anywhere else.
 *   QUOTE_FROM      sender. Stays onboarding@resend.dev until awardsandengraving.com
 *                   is verified, then becomes e.g. "Awards & Engraving <quotes@awardsandengraving.com>".
 *
 *   SENTRY_DSN      optional — if set, failures here are reported to Sentry.
 *
 * Uses Resend's REST API directly rather than the npm SDK so the site stays dependency-free.
 */

var sentry = require('./_sentry');

var RESEND_ENDPOINT = 'https://api.resend.com/emails';
var DEFAULT_TO = 'daniel@awardsandengraving.com';
var DEFAULT_FROM = 'Awards & Engraving <onboarding@resend.dev>';

// Caps mirror the form's own fields; anything longer is a bot or a paste accident.
var LIMITS = { name: 120, email: 200, phone: 60, type: 80, msg: 5000 };

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/* QUOTE_TO takes one address or several separated by commas, so a second
   person can be copied on enquiries without a code change. Empty entries are
   dropped — a trailing comma should not become an empty recipient, which
   Resend rejects for the whole send. */
function recipients() {
  var list = String(process.env.QUOTE_TO || DEFAULT_TO)
    .split(',')
    .map(function (a) { return a.trim(); })
    .filter(Boolean);
  return list.length ? list : [DEFAULT_TO];
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('quote: RESEND_API_KEY is not set');
    // Misconfiguration, not a user error — every submission is being lost.
    await sentry.capture('RESEND_API_KEY is not set', { route: '/api/quote' });
    return res.status(500).json({ error: 'Email is not configured.' });
  }

  // Reading req.body *throws* if the payload isn't parseable JSON, so this access
  // has to be guarded — an uncaught throw here takes the whole function down.
  var body;
  try {
    body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (e) {
    return res.status(400).json({ error: 'Expected a valid JSON body.' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Expected a JSON body.' });
  }

  // Honeypot: real people never fill this. Answer 200 so bots don't learn anything.
  if (clean(body._gotcha, 50)) return res.status(200).json({ ok: true });

  var name = clean(body.name, LIMITS.name);
  var email = clean(body.email, LIMITS.email);
  var phone = clean(body.phone, LIMITS.phone);
  var type = clean(body.type, LIMITS.type) || 'Not specified';
  var msg = clean(body.msg, LIMITS.msg);

  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a name and a valid email address.' });
  }

  var rows = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone || '—'],
    ['Needs', type],
    ['Details', msg || '—']
  ];

  var text = rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');

  var html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#132038">' +
      '<h2 style="margin:0 0 4px;font-size:18px">New quote request</h2>' +
      '<p style="margin:0 0 16px;color:#6b7280">From the website contact form</p>' +
      '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px">' +
      rows.map(function (r) {
        return '<tr>' +
          '<td style="padding:8px 12px 8px 0;vertical-align:top;color:#6b7280;white-space:nowrap">' + escapeHtml(r[0]) + '</td>' +
          '<td style="padding:8px 0;vertical-align:top;border-bottom:1px solid #e5e7eb;white-space:pre-wrap">' + escapeHtml(r[1]) + '</td>' +
        '</tr>';
      }).join('') +
      '</table>' +
      '<p style="margin:18px 0 0;color:#6b7280;font-size:13px">Reply directly to this email to reach ' + escapeHtml(name) + '.</p>' +
    '</div>';

  // Record the lead before emailing. If Resend is down or the domain is not yet
  // verified, the enquiry is still captured and visible in the admin — losing a
  // customer to a mail outage is the failure mode worth engineering against.
  // Uses the anon key: the leads policy allows insert but not select, so this
  // cannot read anyone else's data even if the key leaked.
  var leadSaved = false;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    try {
      var lr = await fetch(process.env.SUPABASE_URL + '/rest/v1/leads', {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          name: name, email: email, phone: phone || null,
          interest: type, message: msg || null,
          source: 'website-contact', page_path: '/contact',
        }),
      });
      leadSaved = lr.ok;
      if (!lr.ok) {
        var lrBody = (await lr.text()).slice(0, 200);
        console.error('quote: lead insert ' + lr.status + ' ' + lrBody);
        await sentry.capture('Lead insert failed: ' + lr.status, {
          route: '/api/quote',
          tags: { step: 'lead-insert' },
          extra: { status: lr.status, body: lrBody },
        });
      }
    } catch (e) {
      console.error('quote: lead insert failed', e.message);
      await sentry.capture(e, { route: '/api/quote', tags: { step: 'lead-insert' } });
    }
  }

  try {
    var r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.QUOTE_FROM || DEFAULT_FROM,
        to: recipients(),
        reply_to: email, // hitting reply in the inbox answers the customer
        subject: 'Quote request — ' + type + ' — ' + name,
        text: text,
        html: html
      })
    });

    if (!r.ok) {
      // Surface Resend's reason in the logs; keep it out of the browser response.
      var detail = await r.text();
      console.error('quote: resend responded ' + r.status + ' ' + detail);
      await sentry.capture('Resend responded ' + r.status, {
        route: '/api/quote',
        tags: { step: 'send-mail', leadSaved: String(leadSaved) },
        extra: { status: r.status, body: detail.slice(0, 500) },
      });
      if (leadSaved) return res.status(200).json({ ok: true, emailed: false });
      return res.status(502).json({ error: 'Could not send your request right now.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('quote: request to resend failed', err);
    await sentry.capture(err, { route: '/api/quote', tags: { step: 'send-mail', leadSaved: String(leadSaved) } });
    if (leadSaved) return res.status(200).json({ ok: true, emailed: false });
    return res.status(502).json({ error: 'Could not send your request right now.' });
  }
};
