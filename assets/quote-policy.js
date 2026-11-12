/* Shared, dependency-free quote validation. No settings or provider access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AE_QUOTE_POLICY = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  var LIMITS = { name: 120, email: 200, phone: 60, type: 80, msg: 5000,
    company: 160, website: 200, volume: 60, formType: 24 };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var MAX_BYTES = 32768;
  function validId(value) { return typeof value === 'string' && UUID.test(value); }
  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function field(value, max, required, multiline) {
    if (!required && (value === undefined || value === null)) return '';
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid input');
    for (var ch of value) {
      var n = ch.codePointAt(0);
      if ((n < 32 && !(multiline && (n === 9 || n === 10 || n === 13))) ||
          (n >= 127 && n <= 159) || (n >= 0xd800 && n <= 0xdfff)) throw new Error('Invalid input');
    }
    value = value.trim();
    if (required && !value) throw new Error('Invalid input');
    return value;
  }
  function validEmail(value) {
    var parts = value.split('@');
    if (parts.length !== 2) return false;
    var local = parts[0], labels = parts[1].split('.');
    return !!local && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
      /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && labels.length >= 2 &&
      labels.every(function (label) { return label.length > 0 && label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label); });
  }
  function bytes(value) { return new TextEncoder().encode(value).byteLength; }
  function validate(body) {
    if (!object(body)) throw new Error('Invalid input');
    var values = {};
    Object.keys(LIMITS).forEach(function (key) {
      values[key] = field(body[key], LIMITS[key], key === 'name' || key === 'email', key === 'msg');
    });
    if (values.name.length < 2 || !validEmail(values.email)) throw new Error('Invalid input');
    values.type = values.type || 'Not specified';
    values.formType = values.formType.toLowerCase() === 'wholesale' ? 'wholesale' : 'contact';
    values.turnstileToken = field(body.turnstileToken, 2048, false, false);
    values._gotcha = field(body._gotcha, 50, false, false);
    if (body.requestId !== undefined && !validId(body.requestId)) throw new Error('Invalid input');
    values.requestId = body.requestId === undefined ? undefined : body.requestId.toLowerCase();
    if (bytes(JSON.stringify(body)) > MAX_BYTES) throw new Error('Invalid input');
    return values;
  }
  return { LIMITS: LIMITS, MAX_BYTES: MAX_BYTES, validId: validId, validEmail: validEmail,
    object: object, field: field, bytes: bytes, validate: validate };
});
