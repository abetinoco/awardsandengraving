#!/usr/bin/env node
/* Puts Bailey's Drive photos into the live Portfolio gallery.
 *
 *   node tools/gallery-import/publish.mjs            dry run: reads the database, changes nothing
 *   node tools/gallery-import/publish.mjs --apply    uploads the photos and adds them to the gallery
 *   node tools/gallery-import/publish.mjs --undo     removes exactly what --apply added
 *
 * Add --env <path> to point at a .env.local outside this checkout (a git
 * worktree has none of its own).
 *
 * It does what the admin's "Add picture" does, 126 times: the WebP goes into
 * the site-photos bucket with a one-year immutable cache header, gets a row in
 * `media` so the Photo library shows it, and gets a `portfolio_items` row.
 * Everything it writes is journalled to applied.json, which is what --undo
 * reads. Re-running --apply skips anything already there.
 *
 * It also:
 *   - adds the filter buttons for Bailey's four new folders and renames the
 *     "Gifts" button to "Personalized Gifts" (the slug stays `gifts`), and
 *   - moves two existing pieces into the folder Bailey filed them under:
 *     the Pride Award plaque (Awards -> Plaques) and the Jeff Chadwick memorial
 *     plaque (Plaques -> Outdoor Plaques). Bailey's copies of those two photos
 *     are skipped because the site already shows them.
 * Each of those is skipped if someone has changed the value since.
 *
 * Titles and captions are left empty on purpose: there is no written source
 * for them, and nothing is to be invented. The alt text is the folder name.
 * Ship the site-content.js change first, or empty captions show a bare
 * gradient on hover.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const UNDO = argv.includes('--undo');
const envArg = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : null;
const JOURNAL = join(HERE, 'applied.json');
const BUCKET = 'site-photos';
const ACTOR = 'Halo (Drive photo import)';
const PREFIX = 'bailey-drive-';

// Bailey's folder names are the button labels. `gifts` already exists and is renamed.
const NEW_CATEGORIES = [
  { slug: 'outdoor-plaques', label: 'Outdoor Plaques', order_index: 22 },
  { slug: 'jewelry', label: 'Jewelry', order_index: 24 },
  { slug: 'wedding-gifts', label: 'Wedding Gifts', order_index: 32 },
  { slug: 'water-bottles', label: 'Water Bottles', order_index: 34 },
];
const RENAME = { slug: 'gifts', from: 'Gifts', to: 'Personalized Gifts' };
const MOVES = [
  { image_url: '/assets/w-vhhs.webp', from: 'awards', to: 'plaques' },
  { image_url: '/assets/w-memorial.webp', from: 'plaques', to: 'outdoor-plaques' },
];

/* ------------------------------------------------------------- config --- */

function readEnv() {
  const file = envArg ? resolve(envArg) : join(ROOT, '.env.local');
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    console.error(`Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE (looked in ${file}). Pass --env <path to .env.local>.`);
    process.exit(1);
  }
  // Refuse to write anywhere but the project the public site reads from.
  const site = readFileSync(join(ROOT, 'site-config.js'), 'utf8').match(/url:\s*"([^"]+)"/);
  if (!site || site[1].replace(/\/$/, '') !== url.replace(/\/$/, '')) {
    console.error(`SUPABASE_URL (${url}) is not the project in site-config.js (${site && site[1]}). Stopping.`);
    process.exit(1);
  }
  return { url: url.replace(/\/$/, ''), key };
}

const { url: SB, key: KEY } = readEnv();
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

async function rest(path, opts = {}) {
  const r = await fetch(SB + '/rest/v1/' + path, {
    ...opts,
    headers: { ...H, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} -> ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function upload(path, bytes) {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': 'image/webp',
      // Same header the admin sends: the path never changes once written.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'false',
    },
    body: bytes,
    signal: AbortSignal.timeout(60000),
  });
  if (r.ok) return 'uploaded';
  const t = await r.text();
  if (r.status === 409 || /already exists|Duplicate/i.test(t)) return 'exists';
  throw new Error(`upload ${path} -> ${r.status} ${t.slice(0, 200)}`);
}

const publicUrl = (path) => `${SB}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`;
const inList = (vals) => 'in.(' + vals.map((v) => '"' + String(v).replace(/"/g, '\\"') + '"').join(',') + ')';
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// n at a time; the first failure stops every worker from starting another.
async function pool(list, n, fn) {
  const out = []; let i = 0, failed = false;
  await Promise.all(Array.from({ length: n }, async () => {
    while (!failed && i < list.length) {
      const k = i++;
      try { out[k] = await fn(list[k], k); } catch (e) { failed = true; throw e; }
    }
  }));
  return out;
}

function journal(update) {
  const j = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : {};
  Object.assign(j, update);
  writeFileSync(JOURNAL, JSON.stringify(j, null, 1) + '\n');
  return j;
}

/* --------------------------------------------------------------- plan --- */

/* Gallery order for the "All" view. Each photo sits (k + 0.5) / n of the way
   through its own folder of n; sorting on that interleaves the folders in
   proportion. Ties keep manifest order. */
function spread(list) {
  const byCat = {};
  list.forEach((p, i) => (byCat[p.category] ||= []).push(i));
  const pos = new Map();
  for (const idx of Object.values(byCat)) idx.forEach((i, k) => pos.set(i, (k + 0.5) / idx.length));
  return list.map((p, i) => [p, i]).sort((a, b) => pos.get(a[1]) - pos.get(b[1]) || a[1] - b[1]).map(([p]) => p);
}

const manifest = JSON.parse(readFileSync(join(HERE, 'photos.json'), 'utf8'));
const photos = manifest.photos.map((p) => {
  const file = join(HERE, 'photos', p.file);
  if (!existsSync(file)) throw new Error('Missing photo file: ' + p.file);
  const path = PREFIX + p.file;
  return { ...p, abs: file, path, url: publicUrl(path) };
});

async function readState() {
  const [cats, items] = await Promise.all([
    rest('portfolio_categories?select=id,slug,label,visible,order_index&order=order_index.asc'),
    rest('portfolio_items?select=id,image_url,category,order_index,visible'),
  ]);
  const media = [];
  for (const c of chunks(photos.map((p) => p.path), 40)) {
    media.push(...await rest('media?select=path&path=' + encodeURIComponent(inList(c))));
  }
  return { cats, items, mediaPaths: new Set(media.map((m) => m.path)) };
}

function describe(state) {
  const have = new Set(state.cats.map((c) => c.slug));
  const imported = new Set(state.items.map((i) => i.image_url));
  const todo = photos.filter((p) => !imported.has(p.url));
  const maxOrder = Math.max(0, ...state.items.map((i) => i.order_index || 0));
  const count = {};
  for (const p of todo) count[p.category_label] = (count[p.category_label] || 0) + 1;
  console.log(`Project:            ${SB}`);
  console.log(`Gallery now:        ${state.items.length} pieces, ${state.cats.length} filter buttons`);
  console.log(`Photos in manifest: ${photos.length} (${(photos.reduce((s, p) => s + p.bytes, 0) / 1048576).toFixed(1)} MB)`);
  console.log(`Already imported:   ${photos.length - todo.length}`);
  console.log(`To add:             ${todo.length}`, count);
  console.log(`New pieces start at order_index ${Math.ceil((maxOrder + 1) / 10) * 10}`);
  for (const c of NEW_CATEGORIES) console.log(`Filter "${c.label}":`, have.has(c.slug) ? 'exists' : 'will be added');
  const g = state.cats.find((c) => c.slug === RENAME.slug);
  console.log(`Filter "${RENAME.from}" -> "${RENAME.to}":`,
    !g ? 'slug missing, skipped' : g.label === RENAME.to ? 'already renamed' : g.label === RENAME.from ? 'will rename' : `label is "${g.label}", left alone`);
  for (const m of MOVES) {
    const it = state.items.find((i) => i.image_url === m.image_url);
    console.log(`Move ${m.image_url} ${m.from} -> ${m.to}:`,
      !it ? 'piece not found, skipped' : it.category === m.to ? 'already moved' : it.category === m.from ? 'will move' : `now "${it.category}", left alone`);
  }
  return { todo, maxOrder };
}

/* -------------------------------------------------------------- apply --- */

async function apply() {
  const state = await readState();
  const { todo, maxOrder } = describe(state);
  journal({ project: SB, started_at: new Date().toISOString() });

  // 1. Filter buttons first, so no piece ever points at a missing category.
  const have = new Set(state.cats.map((c) => c.slug));
  const add = NEW_CATEGORIES.filter((c) => !have.has(c.slug)).map((c) => ({ ...c, visible: true }));
  if (add.length) {
    const made = await rest('portfolio_categories', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(add) });
    journal({ categories_added: made.map((c) => ({ id: c.id, slug: c.slug })) });
    console.log('Added filters:', made.map((c) => c.label).join(', '));
  }
  const g = state.cats.find((c) => c.slug === RENAME.slug);
  if (g && g.label === RENAME.from) {
    await rest(`portfolio_categories?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify({ label: RENAME.to }) });
    journal({ category_renamed: { id: g.id, from: RENAME.from, to: RENAME.to } });
    console.log(`Renamed filter "${RENAME.from}" -> "${RENAME.to}"`);
  }

  // 2. Files, then their Photo library rows. Each upload is journalled as it
  //    lands, so a run that dies halfway can still be undone.
  const uploadedPaths = new Set(readJ().storage_uploaded || []);
  let done = 0;
  await pool(todo, 6, async (p) => {
    if (await upload(p.path, readFileSync(p.abs)) === 'uploaded') {
      uploadedPaths.add(p.path);
      journal({ storage_uploaded: [...uploadedPaths] });
    }
    if (++done % 20 === 0 || done === todo.length) console.log(`  uploaded ${done}/${todo.length}`);
  });
  const mediaRows = todo.filter((p) => !state.mediaPaths.has(p.path))
    .map((p) => ({ path: p.path, url: p.url, bytes: p.bytes, created_by: ACTOR }));
  for (const c of chunks(mediaRows, 50)) {
    await rest('media', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(c) });
  }
  journal({ media_added: [...new Set([...(readJ().media_added || []), ...mediaRows.map((m) => m.path)])] });

  // 3. Gallery rows, after every existing piece, with Bailey's folders spread
  //    evenly through the order so "All" never shows 48 gifts in a row.
  const start = Math.ceil((maxOrder + 1) / 10) * 10;
  const rows = spread(todo).map((p, i) => ({
    title: '', caption: null, alt: p.alt, image_url: p.url, category: p.category,
    featured: false, visible: true, order_index: start + i * 10, updated_by: ACTOR,
  }));
  const added = [];
  for (const c of chunks(rows, 50)) {
    added.push(...await rest('portfolio_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(c) }));
  }
  journal({ items_added: [...(readJ().items_added || []), ...added.map((r) => r.id)] });
  console.log(`Added ${added.length} gallery pieces`);

  // 4. The two existing pieces Bailey filed elsewhere.
  const moved = [];
  for (const m of MOVES) {
    const it = state.items.find((i) => i.image_url === m.image_url);
    if (!it || it.category !== m.from) continue;
    await rest(`portfolio_items?id=eq.${it.id}&category=eq.${m.from}`, { method: 'PATCH', body: JSON.stringify({ category: m.to, updated_by: ACTOR }) });
    moved.push({ id: it.id, image_url: m.image_url, from: m.from, to: m.to });
  }
  if (moved.length) { journal({ moved }); console.log('Moved:', moved.map((m) => `${m.image_url} -> ${m.to}`).join(', ')); }

  await rest('site_activity', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    actor: ACTOR, action: 'uploaded', target: `Portfolio — ${added.length} photos from Bailey's Drive folders`,
    detail: 'Filters added: ' + (add.map((c) => c.label).join(', ') || 'none') + '. Titles and captions left empty for the shop to write.',
  }) }).catch((e) => console.warn('Activity log entry failed (not fatal):', e.message));

  journal({ finished_at: new Date().toISOString() });
  await verify();
}

const readJ = () => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, 'utf8')) : {});

async function verify() {
  // Read back the way a visitor does, with the public key from site-config.js.
  const anon = readFileSync(join(ROOT, 'site-config.js'), 'utf8').match(/anonKey:\s*"([^"]+)"/)[1];
  const pub = await fetch(SB + '/rest/v1/portfolio_items?select=image_url&visible=eq.true', { headers: { apikey: anon, Authorization: 'Bearer ' + anon } }).then((r) => r.json());
  const live = pub.filter((r) => (r.image_url || '').includes(PREFIX)).length;
  const sample = photos[0].url;
  const head = await fetch(sample, { method: 'HEAD' });
  console.log(`Visible to the public: ${live} imported pieces (${pub.length} total)`);
  console.log(`Sample photo: ${head.status} ${head.headers.get('content-type')} cache-control="${head.headers.get('cache-control')}"`);
}

/* --------------------------------------------------------------- undo --- */

async function undo() {
  const j = readJ();
  if (!j.started_at) { console.log('Nothing to undo: no applied.json.'); return; }
  if (j.project !== SB) throw new Error(`applied.json is for ${j.project}, not ${SB}`);
  for (const c of chunks(j.items_added || [], 50)) await rest('portfolio_items?id=' + encodeURIComponent(inList(c)), { method: 'DELETE' });
  console.log(`Removed ${(j.items_added || []).length} gallery pieces`);
  for (const m of j.moved || []) {
    await rest(`portfolio_items?id=eq.${m.id}&category=eq.${m.to}`, { method: 'PATCH', body: JSON.stringify({ category: m.from }) });
  }
  if (j.category_renamed) {
    await rest(`portfolio_categories?id=eq.${j.category_renamed.id}&label=eq.${encodeURIComponent(j.category_renamed.to)}`, { method: 'PATCH', body: JSON.stringify({ label: j.category_renamed.from }) });
  }
  for (const c of j.categories_added || []) {
    const left = await rest(`portfolio_items?select=id&category=eq.${c.slug}&limit=1`);
    if (left.length) { console.log(`Kept filter "${c.slug}": pieces still use it`); continue; }
    await rest(`portfolio_categories?id=eq.${c.id}`, { method: 'DELETE' });
  }
  for (const c of chunks(j.media_added || [], 50)) await rest('media?path=' + encodeURIComponent(inList(c)), { method: 'DELETE' });
  for (const c of chunks(j.storage_uploaded || [], 50)) {
    const r = await fetch(`${SB}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: c }) });
    if (!r.ok) throw new Error('storage delete -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  console.log(`Removed ${(j.storage_uploaded || []).length} files; restored categories and moved pieces`);
  writeFileSync(JOURNAL.replace(/\.json$/, `.undone-${Date.now()}.json`), JSON.stringify(j, null, 1) + '\n');
  writeFileSync(JOURNAL, '{}\n');
}

/* --------------------------------------------------------------- main --- */

try {
  if (UNDO) await undo();
  else if (APPLY) await apply();
  else { describe(await readState()); console.log('\nDry run only. Nothing was changed. Re-run with --apply to publish.'); }
} catch (e) {
  console.error('\nStopped: ' + e.message);
  if (APPLY) console.error('Whatever finished is recorded in applied.json; re-run --apply to continue or --undo to roll back.');
  process.exit(1);
}
