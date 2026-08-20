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

/**
 * Verify a Cloudflare Turnstile token server-side. Only enforced when
 * TURNSTILE_SECRET_KEY is set — otherwise returns true so the form keeps
 * working (honeypot only) where the secret isn't configured.
 */
async function verifyTurnstile(token, remoteip) {
  var secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return true;
  if (!token) return false;
  try {
    var params = new URLSearchParams({ secret: secret, response: token });
    if (remoteip) params.append('remoteip', remoteip);
    var verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    if (!verifyRes.ok) return false;
    var data = await verifyRes.json();
    return data.success === true;
  } catch (e) {
    return false;
  }
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

  // Bot protection: verify the Cloudflare Turnstile token before doing any work.
  var remoteip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
  var humanVerified = await verifyTurnstile(clean(body.turnstileToken, 2048), remoteip);
  if (!humanVerified) {
    return res.status(403).json({ error: 'Verification failed. Please refresh the page and try again.' });
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

    // Receipt for the customer. Best-effort and deliberately last: the shop's copy
    // is already away, and while awardsandengraving.com is unverified in Resend
    // this send is rejected outright — that must not cost anyone their quote.
    await sendCustomerReceipt(apiKey, email, name, type);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('quote: request to resend failed', err);
    await sentry.capture(err, { route: '/api/quote', tags: { step: 'send-mail', leadSaved: String(leadSaved) } });
    if (leadSaved) return res.status(200).json({ ok: true, emailed: false });
    return res.status(502).json({ error: 'Could not send your request right now.' });
  }
};

/* Confirmation to the customer who asked for the quote. Never throws: the shop's
   notification has already been sent by the time this runs, so a failure here is
   worth a log line and nothing more.

   NOTE: until awardsandengraving.com is verified at resend.com/domains, that
   account is in sandbox and will only deliver to the address it was registered
   with. This send will 403 for every real customer until verification is done —
   which is exactly why it is fire-and-forget rather than part of the happy path. */
async function sendCustomerReceipt(apiKey, email, name, type) {
  try {
    if (!email) return;
    var firstName = String(name || '').trim().split(/\s+/)[0] || 'there';
    var wanted = type ? escapeHtml(String(type)) : '';

    var text = [
      'Hi ' + firstName + ',',
      '',
      "Thanks for your quote request - we've got it, and we'll come back to you with pricing the same business day.",
      wanted ? '\nWhat you asked about: ' + String(type) : '',
      '',
      'In a hurry? Call the shop on (847) 549-1923.',
      '',
      '- Awards & Engraving of Libertyville',
      '333 N Milwaukee Ave, Libertyville, IL 60048'
    ].filter(function (l) { return l !== ''; }).join('\n');

    var html = '<!doctype html><html><body style="margin:0;background:#f6f4ef;padding:24px 12px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
      '<tr><td style="background:#14203a;padding:30px 34px;">' +
        '<div style="color:#c9a227;font-size:15px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">Awards &amp; Engraving</div>' +
        '<div style="color:#94a3b8;font-size:12px;letter-spacing:.1em;text-transform:uppercase;margin-top:5px;">Quote request received</div>' +
      '</td></tr>' +
      '<tr><td style="padding:32px 34px 8px;">' +
        '<h1 style="margin:0 0 10px;font-size:20px;color:#14203a;font-weight:700;">Hi ' + escapeHtml(firstName) + ',</h1>' +
        '<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#3f3f46;">Thanks for your request &mdash; we&rsquo;ve got it, and we&rsquo;ll come back to you with pricing the same business day.</p>' +
        (wanted ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#faf8f3;border-radius:10px;margin:0 0 24px;"><tr><td style="padding:16px 20px;font-size:14px;color:#3f3f46;line-height:1.7;"><span style="color:#8a7a52;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">You asked about</span><br>' + wanted + '</td></tr></table>' : '') +
        '<p style="margin:0 0 12px;font-size:14px;color:#3f3f46;">In a hurry? Call the shop:</p>' +
        '<a href="tel:+18475491923" style="display:inline-block;background:#14203a;color:#ffffff;padding:13px 30px;text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;">(847) 549-1923</a>' +
        '<p style="margin:26px 0 0;font-size:14px;color:#3f3f46;">&mdash; Daniel &amp; the <strong style="color:#14203a;">Awards &amp; Engraving</strong> team</p>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 34px 28px;text-align:center;font-size:12px;color:#a1a1aa;line-height:1.7;">' +
        '333 N Milwaukee Ave, Libertyville, IL 60048<br>Mon&ndash;Fri 11am&ndash;5pm &middot; Sat &amp; Sun by appointment<br>' +
        '<a href="https://www.awardsandengraving.com" style="color:#71717a;text-decoration:none;">awardsandengraving.com</a>' +
      '</td></tr>' +
      '</table></body></html>';

    var r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.QUOTE_FROM || DEFAULT_FROM,
        to: [email],
        subject: "We've got your request, " + firstName + ' — Awards & Engraving',
        text: text,
        html: html
      })
    });
    if (!r.ok) {
      var body = await r.text();
      console.warn('quote: customer receipt not sent ' + r.status + ' ' + body.slice(0, 300));
    }
  } catch (e) {
    console.warn('quote: customer receipt threw', e && e.message);
  }
}
