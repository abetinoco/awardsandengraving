#!/usr/bin/env node
/* Swaps the older work photos (/assets/w-*.webp) for Bailey's everywhere the
 * database shows one, outside the homepage hero. Abe, 2026-10-06: "just use
 * baileys instead of mine for the rest of the site except the hero".
 *
 *   node tools/gallery-import/site-photos.mjs --env <.env.local>            dry run
 *   node tools/gallery-import/site-photos.mjs --env <.env.local> --apply
 *   node tools/gallery-import/site-photos.mjs --env <.env.local> --undo
 *
 * What --apply changes (every old value is journalled to site-applied.json):
 *   - services.image_url for all six services -> 3:2 crops in site/
 *   - site_content "trusted_photo" (the round photo on the homepage)
 *   - site_lists "reels": the three Instagram covers that used w-*.webp. The
 *     fourth is a photo of the shop, which Bailey's folders have no match for.
 *   - portfolio_items: the eight w-*.webp pieces are hidden (not deleted).
 *     Bailey's own photos of two of them, the Pride Award and the Chadwick
 *     memorial, are added in their place with the same title and caption.
 *   - portfolio_categories: "Engraving" is hidden, since only two of the
 *     hidden pieces were in it.
 * Photos go to the site-photos bucket with a `media` row, as the admin does.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply'), UNDO = argv.includes('--undo');
const envArg = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : null;
const JOURNAL = join(HERE, 'site-applied.json');
const BUCKET = 'site-photos', PREFIX = 'bailey-drive-', ACTOR = 'Halo (Bailey photos site-wide)';

const SERVICES = { trophies: 'svc-trophies', plaques: 'svc-plaques', school: 'svc-school',
  engraving: 'svc-engraving', gifts: 'svc-gifts', corporate: 'svc-corporate' };
const REELS = { '/assets/w-tumbler.webp': 'reel-tumbler', '/assets/w-vhhs.webp': 'reel-pride', '/assets/w-gloves.webp': 'reel-wallet' };
const OLD_WORK = ['w-aldridge', 'w-vhhs', 'w-30under30', 'w-memorial', 'w-tumbler', 'w-perfume', 'w-pawtag', 'w-gloves'].map((n) => `/assets/${n}.webp`);
// Bailey's photo of the same piece takes over the old row's words and place.
const REPLACE = { '/assets/w-vhhs.webp': 'plaques-10', '/assets/w-memorial.webp': 'outdoor-plaques-05' };

function readEnv() {
  const file = envArg ? resolve(envArg) : join(ROOT, '.env.local');
  const env = {};
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) { console.error(`Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE in ${file}`); process.exit(1); }
  const site = readFileSync(join(ROOT, 'site-config.js'), 'utf8').match(/url:\s*"([^"]+)"/);
  if (!site || site[1].replace(/\/$/, '') !== url.replace(/\/$/, '')) { console.error('Not the project in site-config.js. Stopping.'); process.exit(1); }
  return { url: url.replace(/\/$/, ''), key };
}
const { url: SB, key: KEY } = readEnv();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
async function rest(path, opts = {}) {
  const r = await fetch(SB + '/rest/v1/' + path, { ...opts, headers: { ...H, 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function upload(path, bytes) {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, { method: 'POST',
    headers: { ...H, 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'false' },
    body: bytes, signal: AbortSignal.timeout(60000) });
  if (r.ok) return 'uploaded';
  const t = await r.text();
  if (r.status === 409 || /already exists|Duplicate/i.test(t)) return 'exists';
  throw new Error(`upload ${path} -> ${r.status} ${t.slice(0, 200)}`);
}
const publicUrl = (p) => `${SB}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(p)}`;
const inList = (v) => 'in.(' + v.map((x) => '"' + x + '"').join(',') + ')';
const journal = (u) => { const j = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : {}; Object.assign(j, u); writeFileSync(JOURNAL, JSON.stringify(j, null, 1) + '\n'); return j; };

const files = JSON.parse(readFileSync(join(HERE, 'site', 'site.json'), 'utf8'));
const photo = (stem) => { const f = files.find((x) => x.file.startsWith(stem + '-')); if (!f) throw new Error('no file for ' + stem);
  const path = PREFIX + f.file; return { ...f, path, url: publicUrl(path), abs: join(HERE, 'site', f.file) }; };

if (UNDO) {
  const j = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : null;
  if (!j) { console.log('Nothing to undo.'); process.exit(0); }
  for (const s of j.services || []) await rest(`services?slug=eq.${s.slug}`, { method: 'PATCH', body: JSON.stringify(s.image_alt === undefined ? { image_url: s.image_url } : { image_url: s.image_url, image_alt: s.image_alt }) });
  if (j.trusted) await rest(`site_content?key=eq.trusted_photo`, { method: 'PATCH', body: JSON.stringify({ value: j.trusted.value, previous_value: j.trusted.previous_value }) });
  for (const r of j.reels || []) await rest(`site_lists?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: r.data }) });
  if ((j.hidden || []).length) await rest(`portfolio_items?id=${inList(j.hidden)}`, { method: 'PATCH', body: JSON.stringify({ visible: true }) });
  if ((j.added || []).length) await rest(`portfolio_items?id=${inList(j.added)}`, { method: 'DELETE' });
  if (j.category_hidden) await rest(`portfolio_categories?slug=eq.engraving`, { method: 'PATCH', body: JSON.stringify({ visible: true }) });
  writeFileSync(JOURNAL.replace('.json', `.undone-${Date.now()}.json`), JSON.stringify(j, null, 1));
  writeFileSync(JOURNAL, '{}\n');
  console.log('Undone. Uploaded photos stay in the bucket and Photo library.');
  process.exit(0);
}

const services = await rest('services?select=slug,image_url');
const trusted = (await rest('site_content?select=key,value,previous_value&key=eq.trusted_photo'))[0];
const reels = await rest('site_lists?select=id,data&list_key=eq.reels&order=order_index.asc');
const old = await rest(`portfolio_items?select=*&image_url=${inList(OLD_WORK)}&visible=eq.true`);
console.log('Services:', services.map((s) => `${s.slug}: ${s.image_url.split('/').pop()} -> ${SERVICES[s.slug] || '(no change)'}`).join('; '));
console.log('Trusted photo:', trusted.value, '-> trusted');
console.log('Reels:', reels.map((r) => `${(r.data.thumb || '').split('/').pop()} -> ${REELS[r.data.thumb] || '(kept)'}`).join('; '));
console.log('Gallery pieces to hide:', old.length, old.map((o) => o.image_url.split('/').pop()).join(', '));
if (!APPLY) { console.log('\nDry run only. Re-run with --apply.'); process.exit(0); }
if (existsSync(JOURNAL) && Object.keys(JSON.parse(readFileSync(JOURNAL, 'utf8'))).length) { console.error('site-applied.json already holds a run. Undo it first.'); process.exit(1); }

journal({ started_at: new Date().toISOString() });
for (const f of files) { const p = photo(f.file.replace(/-\d+x\d+\.webp$/, '')); await upload(p.path, readFileSync(p.abs)); }
const have = new Set((await rest(`media?select=path&path=${inList(files.map((f) => PREFIX + f.file))}`)).map((m) => m.path));
const media = files.filter((f) => !have.has(PREFIX + f.file)).map((f) => ({ path: PREFIX + f.file, url: publicUrl(PREFIX + f.file), bytes: f.bytes, created_by: ACTOR }));
if (media.length) await rest('media', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(media) });
console.log(`Uploaded ${files.length} photos, ${media.length} new in the Photo library`);

journal({ services: services.filter((s) => SERVICES[s.slug]).map((s) => ({ slug: s.slug, image_url: s.image_url })) });
for (const s of services) if (SERVICES[s.slug]) await rest(`services?slug=eq.${s.slug}`, { method: 'PATCH', body: JSON.stringify({ image_url: photo(SERVICES[s.slug]).url }) });
journal({ trusted: { value: trusted.value, previous_value: trusted.previous_value } });
await rest(`site_content?key=eq.trusted_photo`, { method: 'PATCH', body: JSON.stringify({ value: photo('trusted').url, previous_value: trusted.value }) });
const changedReels = reels.filter((r) => REELS[r.data.thumb]);
journal({ reels: changedReels.map((r) => ({ id: r.id, data: r.data })) });
for (const r of changedReels) await rest(`site_lists?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...r.data, thumb: photo(REELS[r.data.thumb]).url } }) });
console.log('Services, trusted photo and reel covers updated');

const added = [];
for (const o of old) if (REPLACE[o.image_url]) {
  const row = (await rest('portfolio_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    title: o.title, caption: o.caption, alt: o.alt, category: o.category, featured: false, visible: true,
    order_index: o.order_index, image_url: photo(REPLACE[o.image_url]).url, updated_by: ACTOR }) }))[0];
  added.push(row.id);
}
journal({ added });
journal({ hidden: old.map((o) => o.id) });
await rest(`portfolio_items?id=${inList(old.map((o) => o.id))}`, { method: 'PATCH', body: JSON.stringify({ visible: false, updated_by: ACTOR }) });
await rest(`portfolio_categories?slug=eq.engraving`, { method: 'PATCH', body: JSON.stringify({ visible: false }) });
journal({ category_hidden: true });
console.log(`Gallery: hid ${old.length} older pieces, added ${added.length} of Bailey's in their place, hid the Engraving filter`);
await rest('site_activity', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
  actor: ACTOR, action: 'updated', target: 'Photos site-wide — Bailey\'s photos replace the older work photos',
  detail: 'Services (all six), the homepage round photo, three Instagram covers and the Portfolio. Older pieces hidden, not deleted; Engraving filter hidden.',
}) }).catch((e) => console.warn('Activity log entry failed (not fatal):', e.message));
journal({ finished_at: new Date().toISOString() });
console.log('Done.');
