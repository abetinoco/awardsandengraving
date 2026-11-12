/* Quote-only HTTP/body/budget helpers; other API routes keep their own contract. */
'use strict';
var policy = require('../assets/quote-policy.js');
function unavailable() { return new Error('Unconfirmed'); }
function parseBody(req) {
  var type = String((req.headers || {})['content-type'] || '');
  if (!/^application\/json(?:\s*;|$)/i.test(type)) throw new Error('Invalid input');
  var length = (req.headers || {})['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > policy.MAX_BYTES)) throw new Error('Invalid input');
  var body = req.body;
  if (typeof body === 'string') {
    if (policy.bytes(body) > policy.MAX_BYTES) throw new Error('Invalid input');
    body = JSON.parse(body);
  }
  if (!policy.object(body) || policy.bytes(JSON.stringify(body)) > policy.MAX_BYTES) throw new Error('Invalid input');
  return body;
}
function budget(milliseconds) {
  var end = Date.now() + milliseconds, closed = false, active = new Set();
  var deadline;
  function remaining() { return Math.max(0, end - Date.now()); }
  function close() {
    if (closed) return;
    closed = true;
    active.forEach(function (cancel) { cancel(); });
    active.clear();
    clearTimeout(deadline);
  }
  function race(work, milliseconds, cancel) {
    var timer, stop;
    return Promise.race([Promise.resolve().then(work), new Promise(function (_, reject) {
      stop = function () { clearTimeout(timer); cancel(); reject(unavailable()); };
      active.add(stop);
      timer = setTimeout(stop, milliseconds);
    })]).finally(function () { clearTimeout(timer); active.delete(stop); });
  }
  async function call(url, options, milliseconds, maxBytes) {
    if (closed || remaining() < 1) throw unavailable();
    var controller = new AbortController(), reader;
    function cancel() {
      controller.abort();
      if (reader) { try { void reader.cancel().catch(function () {}); } catch (_) {} }
    }
    try {
      return await race(async function () {
        var response = await fetch(url, Object.assign({}, options, { redirect: 'error', signal: controller.signal }));
        if (closed || controller.signal.aborted) { void response.body?.cancel().catch(function () {}); throw unavailable(); }
        var chunks = [], size = 0;
        if (response.body) {
          reader = response.body.getReader();
          for (;;) {
            var part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > maxBytes) throw unavailable();
            chunks.push(part.value);
          }
        }
        var raw = new Uint8Array(size), offset = 0;
        chunks.forEach(function (chunk) { raw.set(chunk, offset); offset += chunk.byteLength; });
        var text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        if (closed || controller.signal.aborted) throw unavailable();
        return { status: response.status, ok: response.ok, url: response.url,
          redirected: response.redirected, type: response.headers.get('content-type') || '', text: text };
      }, Math.min(milliseconds, remaining()), cancel);
    } finally {
      cancel();
      if (reader) { try { reader.releaseLock(); } catch (_) {} }
    }
  }
  function run(work) {
    return Promise.race([Promise.resolve().then(work), new Promise(function (_, reject) {
      deadline = setTimeout(function () { close(); reject(unavailable()); }, remaining());
    })]);
  }
  async function pause(ms) {
    if (closed || remaining() < ms) throw unavailable();
    var timer, cancel;
    try {
      await new Promise(function (resolve, reject) {
        timer = setTimeout(resolve, ms);
        cancel = function () { clearTimeout(timer); reject(unavailable()); };
        active.add(cancel);
      });
      if (closed) throw unavailable();
    } finally { clearTimeout(timer); active.delete(cancel); }
  }
  return { call: call, run: run, pause: pause, remaining: remaining, close: close };
}
function exact(result, url, status) {
  return result.status === status && result.ok === (status >= 200 && status < 300) && !result.redirected && result.url === url;
}
function json(result) {
  if (!/^application\/json(?:\s*;|$)/i.test(result.type)) throw unavailable();
  var value = JSON.parse(result.text);
  if (!policy.object(value)) throw unavailable();
  return value;
}
// Raw REST receipts require no SDK envelope; explicit failure still contradicts acceptance.
function mailReceiptId(result) {
  var body = json(result);
  if (!policy.validId(body.id) || body.error != null || body.success === false ||
      body.ok === false || body.accepted === false) return null;
  return body.id.toLowerCase();
}
module.exports = { parseBody: parseBody, budget: budget, exact: exact, json: json, mailReceiptId: mailReceiptId };
