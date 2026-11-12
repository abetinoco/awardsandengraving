/* Offline checks for /api/quote. Nothing leaves this process: every fetch is
   stubbed and an un-stubbed host throws, which is what guarantees no row is
   ever written to the live leads table and no mail is ever sent.
   Run from the repo root:  node tools/quote-selftest.js  */
'use strict';
const RESEND = 'https://api.resend.com/emails';
const SUPA = 'https://stub-project.supabase.co';
const MAILID = '7f1d0c2a-9b44-4c31-8e07-2a5c6d8e9f10';

function env() {
  process.env.VERCEL_ENV = 'production';
  process.env.RESEND_API_KEY = 'stub-key';
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = 'stub-anon';
  process.env.QUOTE_TO = 'stub@example.com';
  process.env.QUOTE_BCC = '';
  delete process.env.TURNSTILE_SECRET_KEY;
}
function resp(url, status, body, type) {
  const r = new Response(body, { status, headers: { 'content-type': type || 'application/json' } });
  Object.defineProperty(r, 'url', { value: url });
  Object.defineProperty(r, 'redirected', { value: false });
  return r;
}
function install(supaMode, resendMode) {
  const seen = [];
  global.fetch = (url, options) => {
    const u = String(url);
    seen.push((options && options.method || 'GET') + ' ' + u.replace(SUPA, '<supabase>').replace(RESEND, '<resend>'));
    if (u.startsWith(SUPA)) {
      if (supaMode === 'hang') return new Promise(() => {});
      if (supaMode === 'ok') return Promise.resolve(resp(SUPA + '/rest/v1/leads', 201, '', 'application/json'));
      if (supaMode === 'err') return Promise.resolve(resp(SUPA + '/rest/v1/leads', 500, '{"message":"boom"}'));
    }
    if (u === RESEND) {
      if (resendMode === 'ok') return Promise.resolve(resp(RESEND, 200, JSON.stringify({ id: MAILID })));
      if (resendMode === 'fail') return Promise.resolve(resp(RESEND, 500, '{"message":"down"}'));
      if (resendMode === 'hang') return new Promise(() => {});
    }
    throw new Error('UNSTUBBED NETWORK CALL: ' + u);
  };
  return seen;
}
const BODY = { name: 'Test Harness', email: 'harness@example.com', phone: '847-555-0100',
  type: 'Plaques', msg: 'offline self test', formType: 'contact' };

function run(name, { supa, resend, body = BODY, cap = 28000 }) {
  env();
  const seen = install(supa, resend);
  delete require.cache[require.resolve('../api/quote.js')];
  const handler = require('../api/quote.js');
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
  let out = null;
  const res = { setHeader() {}, _s: 0, status(s) { this._s = s; return this; },
    json(b) { out = { status: this._s, body: b }; return this; } };
  const t0 = Date.now();
  return Promise.race([
    Promise.resolve(handler(req, res)).then(() => ({ out, ms: Date.now() - t0, seen })),
    new Promise(r => setTimeout(() => r({ out: null, ms: Date.now() - t0, seen, hung: true }), cap)),
  ]).then(r => ({ name, ...r }));
}

const CASES = [
  ['database hangs forever',      { supa: 'hang', resend: 'ok' },  r => r.out && r.out.status === 200 && r.out.body.emailed === true && r.out.body.saved === false],
  ['everything healthy',          { supa: 'ok',   resend: 'ok' },  r => r.out && r.out.status === 200 && r.out.body.saved === true && r.out.body.emailed === true],
  ['database 500, email fine',    { supa: 'err',  resend: 'ok' },  r => r.out && r.out.status === 200 && r.out.body.saved === false && r.out.body.emailed === true],
  ['email down, database fine',   { supa: 'ok',   resend: 'fail' },r => r.out && r.out.status === 200 && r.out.body.saved === true && r.out.body.emailed === false],
  ['both down',                   { supa: 'err',  resend: 'fail' },r => r.out && r.out.status === 502],
  ['email hangs, database fine',  { supa: 'ok',   resend: 'hang' },r => r.out && r.out.status === 200 && r.out.body.saved === true],
  ['rubbish input is rejected',   { supa: 'ok',   resend: 'ok', body: { name: 'x', email: 'nope' } }, r => r.out && r.out.status === 400],
];

(async () => {
  let bad = 0;
  for (const [name, opts, check] of CASES) {
    const r = await run(name, opts);
    const ok = !r.hung && check(r);
    if (!ok) bad++;
    const supa = r.seen.filter(s => s.includes('<supabase>')).length;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${String(r.ms).padStart(6)} ms  ` +
      (r.hung ? 'NO RESPONSE' : `${r.out.status} ${JSON.stringify({ saved: r.out.body.saved, emailed: r.out.body.emailed })}`) +
      `  supabase calls: ${supa}`);
  }
  console.log(bad ? `\n${bad} FAILED` : '\nall checks passed — no live writes, no mail sent');
  process.exit(bad ? 1 : 0);
})();
