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
 * Quote diagnostics use fixed local codes; raw inquiry/provider error exports are held.
 *
 * Uses Resend's REST API directly rather than the npm SDK so the site stays dependency-free.
 */

var crypto = require('node:crypto');
var mail = require('./_email.js');
var policy = require('../assets/quote-policy.js');
var runtime = require('./_quote-runtime.js');
var T = { turnstile: 4000, lead: 3000, send: 8000, receipt: 5000, total: 24000 };

var RESEND_ENDPOINT = 'https://api.resend.com/emails';
var DEFAULT_TO = 'daniel@awardsandengraving.com';
var DEFAULT_BCC = 'abe@haloweb.agency';
/* The address this Resend account was registered with. While the domain is
   unverified it is the ONLY recipient Resend will accept, so it is the last
   resort rather than the configured destination. */
var SANDBOX_ONLY_RECIPIENT = 'aelibertyvilledev@outlook.com';
var DEFAULT_FROM = 'Awards & Engraving <onboarding@resend.dev>';

// Caps mirror the form's own fields; anything longer is a bot or a paste accident.
var LIMITS = {
  name: 120, email: 200, phone: 60, type: 80, msg: 5000,
  // Wholesale-only fields, see FORMS below.
  company: 160, website: 200, volume: 60, formType: 24
};

/* The forms this endpoint serves.
 *
 * The wholesale page posts here too rather than to an endpoint of its own, so a
 * trade enquiry inherits Turnstile, the honeypot, the Halo bcc, lead capture and
 * the customer receipt without any of that being written a second time — and
 * Daniel has one inbox to check instead of two. Only the wording, the subject
 * line and how the lead is filed differ, which is all this table holds.
 *
 * `source` is what separates the two in the admin's Quote requests list.
 */
var FORMS = {
  contact: {
    source: 'website-contact',
    pagePath: '/contact',
    eyebrow: 'New quote request',
    intro: 'A quote request came in through <strong style="color:#1A2740;">awardsandengraving.com</strong>. Replying to this email goes straight back to them.',
    detailLabel: 'What they need',
    subject: function (d) { return 'Quote request — ' + d.type + ' — ' + d.name; },
    heading: function (d) { return mail.escapeEmail(d.name) + ' wants a quote'; },
    interest: function (d) { return d.type; },
    receipt: {
      subject: function (d) { return "We've got your request, " + d.first + ' — Awards & Engraving'; },
      preview: 'We come back with pricing the same business day.',
      eyebrow: 'Quote request received',
      plain: "Thanks for your quote request - we've got it, and we'll come back to you with pricing the same business day.",
      heading: function (d) { return 'Thanks, ' + mail.escapeEmail(d.first) + ' — we\u2019ve got it'; },
      intro: 'We&rsquo;ve got your request, and we&rsquo;ll come back to you with pricing the same business day.',
      detailLabel: 'What you asked about',
    },
  },
  wholesale: {
    source: 'website-wholesale',
    pagePath: '/wholesale',
    eyebrow: 'New trade enquiry',
    intro: 'A wholesale enquiry came in through <strong style="color:#1A2740;">awardsandengraving.com/wholesale</strong>. Replying to this email goes straight back to them.',
    detailLabel: 'What they want to move',
    subject: function (d) { return 'Trade enquiry — ' + (d.company || d.name) + ' — ' + d.type; },
    heading: function (d) { return mail.escapeEmail(d.company || d.name) + ' wants a trade account'; },
    interest: function (d) { return 'Wholesale — ' + d.type + (d.volume ? ' — ' + d.volume : ''); },
    receipt: {
      subject: function (d) { return 'Thanks for your trade enquiry, ' + d.first + ' — Awards & Engraving'; },
      preview: 'Daniel reads these himself and comes back the same business day.',
      eyebrow: 'Trade enquiry received',
      plain: "Thanks for your trade enquiry - we've got it. Daniel reads these himself and will come back to you the same business day with trade pricing.",
      heading: function (d) { return 'Thanks, ' + mail.escapeEmail(d.first) + ' — we\u2019ve got it'; },
      intro: 'We&rsquo;ve got your enquiry. Daniel reads these himself and will come back to you &mdash; usually the same business day &mdash; with trade pricing and a straight answer on capacity.',
      detailLabel: 'What you told us',
    },
  },
};

function recipients() {
  var list = String(process.env.QUOTE_TO || DEFAULT_TO)
    .split(',')
    .map(function (a) { return a.trim(); })
    .filter(Boolean);
  return list.length ? list : [DEFAULT_TO];
}

/* Hidden copy to Halo, so a broken quote form is noticed here and not by a
   customer who never hears back.

   This is the exact change that took the form down on 4 Aug: while
   awardsandengraving.com is unverified, Resend's sandbox accepts one recipient
   only, and rejects the WHOLE message if any other address appears in to, cc or
   bcc. Adding Halo back is therefore paired with sandboxRejectedRecipient()
   below, which drops the bcc and retries so the shop's copy always lands. */
function bccRecipients() {
  return String(process.env.QUOTE_BCC === undefined ? DEFAULT_BCC : process.env.QUOTE_BCC)
    .split(',')
    .map(function (a) { return a.trim(); })
    .filter(Boolean);
}

/* True when Resend refused the send purely because a recipient isn't allowed
   in sandbox mode — the one failure we can recover from by dropping the bcc. */
function sandboxRejectedRecipient(status, body) {
  if (status !== 403) return false;
  var text = String(body || '').toLowerCase();
  return text.indexOf('only send testing emails') !== -1 ||
         text.indexOf('verify a domain') !== -1;
}

function reply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}
function acknowledgment(state) {
  return { ok: true, accepted: true, requestId: state.requestId,
    saved: state.saved, emailed: !!state.mailId, emailReceiptId: state.mailId || null };
}
async function verifyTurnstile(token, remoteip, budget) {
  var secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return true;
  if (!token) return false;
  try {
    var endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    var params = new URLSearchParams({ secret: secret, response: token });
    if (remoteip) params.append('remoteip', remoteip);
    var r = await budget.call(endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }, T.turnstile, 4096);
    return runtime.exact(r, endpoint, 200) && runtime.json(r).success === true;
  } catch (_) { return false; }
}
async function insertLead(row, budget) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return false;
  var endpoint = process.env.SUPABASE_URL + '/rest/v1/leads';
  // Existing UUID primary key: both attempts use this exact same row identity.
  var options = { method: 'POST', headers: {
    apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json', Prefer: 'return=minimal'
  }, body: JSON.stringify(row) };
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await budget.pause(250);
      var r = await budget.call(endpoint, options, T.lead, 4096);
      if (runtime.exact(r, endpoint, 201) && r.text === '') return true;
      // A conflict is never a guessed saved receipt, including after an uncertain first write.
      if (!(r.status >= 500 || r.status === 408 || r.status === 429)) break;
    } catch (_) { /* Requested transient retry retains the same existing UUID. */ }
  }
  console.warn('quote: QUOTE_RECORD_UNCONFIRMED');
  return false;
}
async function sendReceipt(apiKey, values, copy, budget) {
  try {
    var email = values.email, name = values.name, type = values.type, msg = values.msg;
    var firstName = String(name || '').trim().split(/\s+/)[0] || 'there';
    var r = copy || FORMS.contact.receipt;
    var d = { first: firstName };

    var text = [
      'Hi ' + firstName + ',',
      '',
      r.plain,
      (type && type !== 'Not specified') ? '\nWhat you asked about: ' + String(type) : '',
      '',
      'In a hurry? Call the shop on (847) 549-1923.',
      '',
      '- Awards & Engraving of Libertyville',
      '333 N Milwaukee Ave, Libertyville, IL 60048'
    ].filter(function (l) { return l !== ''; }).join('\n');

    var html = mail.emailShell({
      preview: r.preview,
      eyebrow: r.eyebrow,
      heading: r.heading(d),
      intro: r.intro,
      body: mail.quoteBlock(r.detailLabel, (type ? String(type) + '\n\n' : '') + String(msg || '')),
      cta: { label: 'Call the shop (847) 549-1923', href: 'tel:+18475491923' },
      outro: '&mdash; Daniel &amp; the Awards &amp; Engraving team',
    });


    var response = await budget.call(RESEND_ENDPOINT, {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.QUOTE_FROM || DEFAULT_FROM, to: [email],
        reply_to: 'orders@awardsandengraving.com', subject: r.subject(d), text: text, html: html })
    }, T.receipt, 4096);
    if (!runtime.exact(response, RESEND_ENDPOINT, 200) || !runtime.mailReceiptId(response)) {
      console.warn('quote: QUOTE_COURTESY_UNCONFIRMED');
    }
  } catch (_) { console.warn('quote: QUOTE_COURTESY_UNCONFIRMED'); }
}
module.exports = async function handler(req, res) {
  var invocationStarted = Date.now();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { error: 'Method not allowed', accepted: false });
  }
  var body, values, requestId;
  try {
    body = runtime.parseBody(req);
    if (body.requestId !== undefined && !policy.validId(body.requestId)) throw new Error('Invalid input');
    requestId = body.requestId === undefined ? crypto.randomUUID() : body.requestId.toLowerCase();
    // Preserve the silent honeypot response, which never establishes acceptance.
    if (policy.field(body._gotcha, 50, false, false)) {
      return reply(res, 200, { ok: true, accepted: false, requestId: requestId });
    }
    values = policy.validate(body);
  } catch (_) {
    return reply(res, 400, { error: 'Please provide a valid request.', code: 'invalid-input', accepted: false, requestId: requestId || null });
  }
  if (process.env.VERCEL_ENV !== 'production') return reply(res, 503, { error: 'Online requests are unavailable. Please call the shop.', code: 'unavailable', accepted: false, requestId: requestId });
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return reply(res, 503, { error: 'Online requests are unavailable. Please call the shop.', code: 'unavailable', accepted: false, requestId: requestId });
  var state = { requestId: requestId, saved: false, mailId: null };
  var budget = runtime.budget(Math.max(1, T.total - (Date.now() - invocationStarted)));
  try {
    var outcome = await budget.run(async function () {
      var forwarded = typeof (req.headers || {})['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
      var remoteip = forwarded.split(',')[0].trim().slice(0, 100) || undefined;
      if (!await verifyTurnstile(values.turnstileToken, remoteip, budget)) {
        return { status: 403, body: { error: 'Verification failed. Please refresh the page and try again.', code: 'verification-failed',
          accepted: false, requestId: requestId } };
      }
      var formKey = values.formType, form = FORMS[formKey];
      var fields = { name: values.name, type: values.type, company: values.company, website: values.website, volume: values.volume };
      var rows = [['Name', values.name], ['Email', values.email], ['Phone', values.phone || '—']];
      if (values.company) rows.push(['Company', values.company]);
      if (values.website) rows.push(['Website', values.website]);
      rows.push([formKey === 'wholesale' ? 'Partner type' : 'Needs', values.type]);
      if (values.volume) rows.push(['Volume', values.volume]);
      rows.push(['Details', values.msg || '—']);
      var text = rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n');
      var emailHref = 'mailto:' + encodeURIComponent(values.email);
      var html = mail.emailShell({ preview: (values.company || values.name) + ' — ' + values.type,
        eyebrow: form.eyebrow, heading: form.heading(fields), intro: form.intro,
        body: '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 6px;">' +
          mail.detailRows(rows.filter(function (r) { return r[0] !== 'Details'; }).map(function (r) {
            if (r[0] === 'Email') return ['Email', r[1], emailHref];
            if (r[0] === 'Phone') return ['Phone', r[1], 'tel:' + String(r[1]).replace(/\D/g, '')];
            return [r[0], r[1]];
          })) + '</table>' + mail.quoteBlock(form.detailLabel, values.msg),
        cta: { label: 'Reply to ' + values.name.split(/\s+/)[0], href: emailHref } });
      var leadPromise = insertLead({ id: requestId, name: values.name, email: values.email, phone: values.phone || null,
        interest: form.interest(fields), message: [values.company ? 'Company: ' + values.company : '',
          values.website ? 'Website: ' + values.website : '', values.volume ? 'Volume: ' + values.volume : '',
          values.msg || ''].filter(Boolean).join('\n') || null, source: form.source, page_path: form.pagePath
      }, budget).then(function (saved) { state.saved = saved; return saved; });
      var bcc = bccRecipients();
      async function sendQuote(withBcc, toOverride) {
        var payload = { from: process.env.QUOTE_FROM || DEFAULT_FROM, to: toOverride || recipients(),
          reply_to: values.email, subject: form.subject(fields), text: text, html: html };
        if (withBcc && bcc.length) payload.bcc = bcc;
        return budget.call(RESEND_ENDPOINT, { method: 'POST', headers: {
          Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'
        }, body: JSON.stringify(payload) }, T.send, 8192);
      }
      try {
        var r = await sendQuote(true);
        // Only a confirmed, unredirected refusal triggers the existing recipient fallback.
        if (runtime.exact(r, RESEND_ENDPOINT, 403) && sandboxRejectedRecipient(r.status, r.text)) {
          if (bcc.length) r = await sendQuote(false);
          if (runtime.exact(r, RESEND_ENDPOINT, 403) && sandboxRejectedRecipient(r.status, r.text)) {
            var allowed = String(process.env.QUOTE_SANDBOX_FALLBACK || SANDBOX_ONLY_RECIPIENT).trim();
            if (allowed && recipients().join(',').toLowerCase() !== allowed.toLowerCase()) r = await sendQuote(false, [allowed]);
          }
        }
        if (runtime.exact(r, RESEND_ENDPOINT, 200)) {
          state.mailId = runtime.mailReceiptId(r);
        }
      } catch (_) { console.warn('quote: QUOTE_NOTIFICATION_UNCONFIRMED'); }
      // Confirmed shop acceptance precedes the independent courtesy attempt.
      if (state.mailId) await sendReceipt(apiKey, values, form.receipt, budget);
      await leadPromise;
      return state.saved || state.mailId ? { status: 200, body: acknowledgment(state) } :
        { status: 502, body: { error: 'We could not confirm your request. Please call the shop before trying again.',
          accepted: false, requestId: requestId } };
    });
    return reply(res, outcome.status, outcome.body);
  } catch (_) {
    if (state.saved || state.mailId) return reply(res, 200, acknowledgment(state));
    return reply(res, 502, { error: 'We could not confirm your request. Please call the shop before trying again.',
      accepted: false, requestId: requestId });
  } finally { budget.close(); }
};
