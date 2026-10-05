'use strict';
// BodyParts3D version 4.3: the latest, full-resolution release (3,210 mesh
// components including BodyParts3D's own mirrored left-side muscles).
//
// The public dbarchive mirror only ships the 99%-reduced 4.0 set. 4.3 is served
// by the Anatomography viewer back end at lifesciencedb.jp/bp3d; this module
// talks to the same endpoints the viewer uses (approach documented by
// https://github.com/olivercase/body_parts_3d_api). Requests are sequential,
// rate-limited and resumable.

const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('./zip');
const { readLists, conceptsFromLists, parseMeshes, elementKey, ATTRIBUTION } = require('./bp3d');
const { buildGraph, newConcept, link } = require('./graph');
const { assemble } = require('./assemble');

const BASE = 'https://lifesciencedb.jp/bp3d';
const VIEWER = `${BASE}/?lng=en`;
const INFO_CGI = `${BASE}/get-info.cgi`;
const DOWNLOAD_CGI = `${BASE}/download.cgi`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 OpenAnatomyAtlas/0.3';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- parsing (pure, testable) ----------

function splitLines(text) { return text.replace(/\r\n?/g, '\n').split('\n'); }

// FMA2Obj.txt: "FMAxxxx <tab> is_a|part_of <tab> FJ1+FJ2+..."
function parseFMA2Obj(text) {
  const rows = [];
  for (const line of splitLines(text)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    rows.push({ fma: cols[0].trim(), kind: cols[1].trim(), fj: cols[2].split('+').map(s => s.trim()).filter(s => s.startsWith('FJ')) });
  }
  return rows;
}

// obj2FMA.html: table rows with td classes art_id (FJ), rep_id (BP), cdi_name (FMA), cdi_name_e (name)
function parseObj2FMA(html) {
  const out = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td class="(\w+)"[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const d = {};
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[1]))) d[c[1]] = c[2].replace(/<[^>]+>/g, '').trim();
    if (d.art_id && d.art_id.startsWith('FJ')) out.push({ fj: d.art_id, bp: d.rep_id || '', fma: d.cdi_name || '', name: d.cdi_name_e || '' });
  }
  return out;
}

// ---------- download ----------

class Session {
  constructor(fetchImpl) { this.fetch = fetchImpl || globalThis.fetch; this.cookies = new Map(); }
  _store(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const sc of list) { const kv = sc.split(';')[0]; const i = kv.indexOf('='); if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  }
  async request(url, { form, retries = 4 } = {}) {
    let lastErr;
    for (let a = 1; a <= retries; a++) {
      try {
        const headers = { 'User-Agent': UA, Referer: VIEWER, Accept: '*/*' };
        if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        const opts = { headers, redirect: 'follow' };
        if (form) { opts.method = 'POST'; opts.body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
        const res = await this.fetch(url, opts);
        this._store(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        if (a < retries) await sleep(1000 * 2 ** a);
      }
    }
    throw new Error(`${url}: ${lastErr.message}`);
  }
}

function zipHasObj(buf) {
  try { return new ZipArchive(buf).files().some(e => /\.obj$/i.test(e.name)); } catch (_) { return false; }
}

async function download43({ rawDir, fetchImpl, onProgress = () => {}, chunkSize = 50, delayMs = 800, limit = 0 }) {
  const meta = path.join(rawDir, 'metadata');
  const chunks = path.join(rawDir, 'chunks');
  fs.mkdirSync(meta, { recursive: true });
  fs.mkdirSync(chunks, { recursive: true });
  const s = new Session(fetchImpl);

  onProgress({ phase: 'download', message: 'Connecting to the Anatomography server' });
  await s.request(VIEWER);

  const manifestFile = path.join(meta, 'FMA2Obj.txt');
  if (!fs.existsSync(manifestFile) || !fs.statSync(manifestFile).size) {
    onProgress({ phase: 'download', message: 'Downloading the 4.3 manifest' });
    const zip = new ZipArchive(await s.request(`${INFO_CGI}?version=4.3&cmd=concept-objfiles-list`));
    const e = zip.files().find(f => /\.txt$/i.test(f.name));
    if (!e) throw new Error('The 4.3 manifest download did not contain FMA2Obj.txt');
    fs.writeFileSync(manifestFile, zip.read(e));
  }
  const mapFile = path.join(meta, 'obj2FMA.html');
  if (!fs.existsSync(mapFile) || !fs.statSync(mapFile).size) {
    onProgress({ phase: 'download', message: 'Downloading the mesh index' });
    const html = await s.request(INFO_CGI, { form: { cmd: 'upload-all-list', load: '1', md_abbr: 'bp3d', title: 'obj2FMA', tree: 'isa', version: '4.3' } });
    fs.writeFileSync(mapFile, html);
  }

  const manifest = parseFMA2Obj(fs.readFileSync(manifestFile, 'utf8'));
  const fj2bp = new Map(parseObj2FMA(fs.readFileSync(mapFile, 'utf8')).filter(r => r.bp).map(r => [r.fj, r.bp]));
  let target = [...new Set(manifest.flatMap(r => r.fj))].sort().filter(fj => fj2bp.has(fj));
  if (limit) target = target.slice(0, limit);
  if (!target.length) throw new Error('The 4.3 manifest lists no downloadable meshes; the server format may have changed.');

  const groups = [];
  for (let i = 0; i < target.length; i += chunkSize) groups.push(target.slice(i, i + chunkSize));
  let failed = 0;
  for (let i = 0; i < groups.length; i++) {
    const file = path.join(chunks, `chunk_${String(i).padStart(4, '0')}.zip`);
    if (fs.existsSync(file) && zipHasObj(fs.readFileSync(file))) continue;
    onProgress({ phase: 'download', loaded: i, total: groups.length, message: `Downloading 4.3 meshes, batch ${i + 1} of ${groups.length}` });
    try {
      const body = await s.request(DOWNLOAD_CGI, { form: {
        ids: JSON.stringify(groups[i]),
        rep_id: JSON.stringify([...new Set(groups[i].map(fj => fj2bp.get(fj)))].sort()),
        filename: `chunk_${String(i).padStart(4, '0')}`,
        type: 'art_file',
        all_downloads: '1',
      } });
      if (!zipHasObj(body)) throw new Error('response was not a zip of meshes');
      fs.writeFileSync(file, body);
    } catch (e) {
      failed++;
      onProgress({ phase: 'warn', message: `Batch ${i + 1} failed: ${e.message}` });
    }
    await sleep(delayMs);
  }
  onProgress({ phase: 'download', loaded: groups.length, total: groups.length, message: `Downloaded ${groups.length - failed} of ${groups.length} batches` });
  if (failed) throw new Error(`${failed} of ${groups.length} download batches failed. Run the download again to resume; finished batches are kept.`);
}

// ---------- build ----------

async function build43({ rawDir, listDir, outDir, onProgress = () => {}, mirror }) {
  const meta = path.join(rawDir, 'metadata');
  const manifest = parseFMA2Obj(fs.readFileSync(path.join(meta, 'FMA2Obj.txt'), 'utf8'));
  const map = parseObj2FMA(fs.readFileSync(path.join(meta, 'obj2FMA.html'), 'utf8'));
  const wanted = new Set(manifest.flatMap(r => r.fj));

  // names + hierarchy from the 4.0 lists; mesh membership from the 4.3 manifest
  const C = conceptsFromLists(readLists([listDir]));
  for (const c of C.values()) c.direct.clear();
  for (const r of map) if (r.fma) newConcept(C, r.fma, r.name && r.name.charAt(0).toLowerCase() + r.name.slice(1));
  for (const r of manifest) { const c = newConcept(C, r.fma); for (const fj of r.fj) c.direct.add(fj); }

  // meshes from all downloaded batches (plus any loose OBJ folder)
  const objs = new Map();
  const archives = [];
  const chunkDir = path.join(rawDir, 'chunks');
  const chunkFiles = fs.existsSync(chunkDir) ? fs.readdirSync(chunkDir).filter(f => f.endsWith('.zip')).sort() : [];
  for (const f of chunkFiles) {
    const z = new ZipArchive(path.join(chunkDir, f));
    archives.push(z);
    for (const e of z.files()) {
      if (!/\.obj$/i.test(e.name)) continue;
      const k = elementKey(e.name);
      if (wanted.has(k) && !objs.has(k)) objs.set(k, () => z.read(e).toString('latin1'));
    }
  }
  for (const objDir of ['objs', 'meshes'].map(d => path.join(rawDir, d)).filter(d => fs.existsSync(d))) for (const f of fs.readdirSync(objDir)) {
    const k = elementKey(f);
    if (!/\.obj$/i.test(f) || !wanted.has(k) || objs.has(k)) continue;
    const file = path.join(objDir, f);
    if (fs.statSync(file).size < 300 && /git-lfs/.test(fs.readFileSync(file, 'utf8'))) throw new Error(`${f} is a Git LFS pointer, not a mesh. Run "git lfs pull" in that repository first.`);
    objs.set(k, () => fs.readFileSync(file, 'latin1'));
  }
  if (!objs.size) throw new Error('No BodyParts3D 4.3 meshes found. Download them first.');
  if (objs.size < wanted.size) onProgress({ phase: 'warn', message: `${wanted.size - objs.size} of ${wanted.size} meshes are missing; building with what is there.` });

  const meshes = await parseMeshes(objs, onProgress);
  for (const a of archives) a.close();

  inferParents(C);
  const g = buildGraph(C, meshes);
  return assemble({ meshes, ...g, outDir, onProgress, mirror, meta: {
    source: 'bp3d43', name: 'BodyParts3D', version: '4.3',
    attribution: ATTRIBUTION, license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://lifesciencedb.jp/bp3d/',
    notes: ['Full-resolution meshes from the Anatomography 4.3 release. Components ending in "M" are BodyParts3D’s own mirrored left-side models.'],
  } });
}

// Concepts the 4.0 hierarchy does not place get the smallest concept whose
// meshes strictly contain theirs as a part-of parent.
function inferParents(C) {
  const named = [...C.values()].filter(c => c.name && c.direct.size);
  const byElem = new Map();
  for (const c of named) for (const e of c.direct) { if (!byElem.has(e)) byElem.set(e, []); byElem.get(e).push(c); }
  for (const c of named) {
    if (c.pp.size) continue; // already placed in the part-of (regional) tree
    const first = c.direct.values().next().value;
    let best = null;
    for (const cand of byElem.get(first) || []) {
      if (cand === c || cand.direct.size <= c.direct.size) continue;
      if (best && cand.direct.size >= best.direct.size) continue;
      let ok = true;
      for (const e of c.direct) if (!cand.direct.has(e)) { ok = false; break; }
      if (ok) best = cand;
    }
    if (best) link(C, best.id, c.id, 'p');
  }
}

module.exports = { download43, build43, parseFMA2Obj, parseObj2FMA, inferParents, BASE };
