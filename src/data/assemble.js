'use strict';
// Final stage shared by every data source: orient the body (Y up, front +Z,
// patient's left +X), mirror one-sided structures, mark sides, centre/scale
// to metres, pack all meshes into one binary and write index.json.

const fs = require('fs');
const path = require('path');
const { computeNormals } = require('./obj');
const { CATEGORIES } = require('./classify');

const tick = () => new Promise(r => setImmediate(r));
const mul3 = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const apply3 = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

const SIDE_RE = /\b(left|right)\b/i;
const baseName = (n) => String(n).toLowerCase().replace(/\b(left|right)\b/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
const swapSide = (n) => n.replace(/\b(left|right|Left|Right)\b/g, (w) => ({ left: 'right', right: 'left', Left: 'Right', Right: 'Left' }[w]));

function meshBox(p) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) {
    const v = p[i + a];
    if (v < b[a]) b[a] = v;
    if (v > b[a + 3]) b[a + 3] = v;
  }
  return b;
}

// ---------- orientation ----------
function orient(meshes, labelOf) {
  const raw = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of meshes) { const b = meshBox(m.positions); for (let a = 0; a < 3; a++) { raw[a] = Math.min(raw[a], b[a]); raw[a + 3] = Math.max(raw[a + 3], b[a + 3]); } }
  const ext = [raw[3] - raw[0], raw[4] - raw[1], raw[5] - raw[2]];
  const up = ext.indexOf(Math.max(...ext));
  let M = up === 2 ? [1, 0, 0, 0, 0, 1, 0, -1, 0] : up === 0 ? [0, -1, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const centroid = (i, m3) => {
    const p = meshes[i].positions; const n = p.length / 3; const step = Math.max(1, Math.floor(n / 200));
    let x = 0, y = 0, z = 0, cnt = 0;
    for (let v = 0; v < n; v += step) { const q = apply3(m3, p[v * 3], p[v * 3 + 1], p[v * 3 + 2]); x += q[0]; y += q[1]; z += q[2]; cnt++; }
    return [x / cnt, y / cnt, z / cnt];
  };
  const meanOf = (re, m3) => {
    const idx = meshes.map((_, i) => i).filter(i => re.test(labelOf(i).toLowerCase()));
    if (!idx.length) return null;
    const s = [0, 0, 0];
    for (const i of idx) { const c = centroid(i, m3); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
    return s.map(v => v / idx.length);
  };
  const a = apply3(M, raw[0], raw[1], raw[2]), b = apply3(M, raw[3], raw[4], raw[5]);
  const midY = (a[1] + b[1]) / 2;
  const head = meanOf(/\b(skull|cranium|brain|mandible|cerebrum|cerebellum|frontal bone|occipital bone|parietal bone)\b/, M);
  if (head && head[1] < midY) M = mul3([1, 0, 0, 0, -1, 0, 0, 0, -1], M);
  const front = meanOf(/sternum|patella|umbilic|navel|xiphoid/, M);
  const back = meanOf(/vertebra|spinal cord|sacrum|spinous/, M);
  if (front && back) {
    const dx = front[0] - back[0], dz = front[2] - back[2];
    if (Math.hypot(dx, dz) > 1e-9) {
      const t = -Math.atan2(dx, dz), cs = Math.cos(t), sn = Math.sin(t);
      M = mul3([cs, 0, sn, 0, 1, 0, -sn, 0, cs], M);
    }
  }
  const leftC = meanOf(/^left\b/, M), rightC = meanOf(/^right\b/, M);
  if (leftC && rightC && leftC[0] < rightC[0]) M = mul3([-1, 0, 0, 0, 1, 0, 0, 0, 1], M);

  for (const m of meshes) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) { const q = apply3(M, p[i], p[i + 1], p[i + 2]); p[i] = q[0]; p[i + 1] = q[1]; p[i + 2] = q[2]; }
    // a reflection flips triangle winding; keep winding consistent with orientation
    m.box = meshBox(p);
  }
  return { midline: () => {
    const mid = meshes.map((_, i) => i).filter(i => /vertebra|sternum|spinal cord|sacrum|coccyx/.test(labelOf(i).toLowerCase()));
    if (mid.length) return mid.reduce((s, i) => s + (meshes[i].box[0] + meshes[i].box[3]) / 2, 0) / mid.length;
    let lo = Infinity, hi = -Infinity; for (const m of meshes) { lo = Math.min(lo, m.box[0]); hi = Math.max(hi, m.box[3]); }
    return (lo + hi) / 2;
  } };
}

// ---------- mirroring ----------
// For structures in the given categories that exist on only one side of the
// body, add a mirror-image copy on the other side, flagged `mirrored`.
function mirrorMissing(meshes, concepts, best, cats, { categories = ['muscle'], x0, height }) {
  const eps = height * 0.006;
  const cx = (i) => (meshes[i].box[0] + meshes[i].box[3]) / 2;
  const sideOf = (i) => (cx(i) > x0 + eps ? 'L' : cx(i) < x0 - eps ? 'R' : 'M');
  const want = new Set(categories);
  const present = { L: new Map(), R: new Map() };
  const n0 = meshes.length;
  for (let i = 0; i < n0; i++) {
    if (!want.has(cats[i])) continue;
    const s = sideOf(i); if (s === 'M') continue;
    const k = cats[i] + '|' + baseName(concepts[best[i]].name);
    if (!present[s].has(k)) present[s].set(k, []);
    present[s].get(k).push(i);
  }
  const boxesBySide = { L: [], R: [] };
  for (let i = 0; i < n0; i++) if (want.has(cats[i])) { const s = sideOf(i); if (s !== 'M') boxesBySide[s].push(i); }
  const overlap = (b, i) => {
    const c = meshes[i].box; let inter = 1, va = 1, vb = 1;
    for (let a = 0; a < 3; a++) {
      const d = Math.min(b[a + 3], c[a + 3]) - Math.max(b[a], c[a]);
      if (d <= 0) return 0;
      inter *= d; va *= Math.max(1e-9, b[a + 3] - b[a]); vb *= Math.max(1e-9, c[a + 3] - c[a]);
    }
    return inter / Math.min(va, vb);
  };

  let group = -1;
  const byName = new Map(concepts.map((c, i) => [c.name.toLowerCase(), i]));
  let added = 0;
  for (let i = 0; i < n0; i++) {
    if (!want.has(cats[i])) continue;
    const s = sideOf(i); if (s === 'M') continue;
    const other = s === 'R' ? 'L' : 'R';
    const k = cats[i] + '|' + baseName(concepts[best[i]].name);
    if (present[other].has(k)) continue;
    const src = meshes[i];
    const p = new Float32Array(src.positions.length);
    for (let v = 0; v < p.length; v += 3) { p[v] = 2 * x0 - src.positions[v]; p[v + 1] = src.positions[v + 1]; p[v + 2] = src.positions[v + 2]; }
    const box = meshBox(p);
    if (boxesBySide[other].some(j => cats[j] === cats[i] && overlap(box, j) > 0.6)) continue; // something already there
    const idx = new Uint32Array(src.indices.length);
    for (let t = 0; t < idx.length; t += 3) { idx[t] = src.indices[t]; idx[t + 1] = src.indices[t + 2]; idx[t + 2] = src.indices[t + 1]; }
    const mi = meshes.length;
    meshes.push({ key: src.key + 'M*', positions: p, indices: idx, box });
    cats.push(cats[i]);

    const orig = concepts[best[i]];
    const sideWord = other === 'L' ? 'left' : 'right';
    const name = SIDE_RE.test(orig.name) ? swapSide(orig.name) : `${sideWord} ${orig.name}`;
    const ci = concepts.length;
    const mapParents = (list) => {
      const out = [];
      for (const pIdx of list) {
        const pc = concepts[pIdx];
        if (pc.synthetic) continue;
        if (SIDE_RE.test(pc.name)) { const twin = byName.get(swapSide(pc.name).toLowerCase()); if (twin !== undefined) out.push(twin); }
        else out.push(pIdx);
      }
      return out;
    };
    const c = { id: orig.id + '-MIRROR', name, pp: mapParents(orig.pp), pc: [], ip: mapParents(orig.ip), ic: [], el: [mi], mirrored: true, mirrorOf: best[i] };
    if (orig.la) c.la = orig.la;
    if (orig.def) c.def = orig.def;
    if (!c.pp.length) {
      if (group < 0) {
        group = concepts.length + 1;
        concepts.push(c);
        concepts.push({ id: 'X-MIRRORED', name: 'Mirrored structures (copied from the other side)', pp: [], pc: [], ip: [], ic: [], el: [], synthetic: true, mirrorGroup: true });
      } else concepts.push(c);
      c.pp.push(group); concepts[group].pc.push(ci);
    } else concepts.push(c);
    for (const pIdx of c.pp) if (!concepts[pIdx].pc.includes(ci)) concepts[pIdx].pc.push(ci);
    for (const pIdx of c.ip) if (!concepts[pIdx].ic.includes(ci)) concepts[pIdx].ic.push(ci);
    // add the new mesh to every ancestor
    const seen = new Set([ci]);
    const stack = [ci];
    while (stack.length) {
      const cur = stack.pop();
      if (!concepts[cur].el.includes(mi)) concepts[cur].el.push(mi);
      for (const pIdx of [...concepts[cur].pp, ...concepts[cur].ip]) if (!seen.has(pIdx)) { seen.add(pIdx); stack.push(pIdx); }
    }
    best.push(ci);
    added++;
  }
  return { added, group };
}

// Unsided names of small structures that sit wholly on one side get `side`.
function markSides(meshes, concepts, x0, height) {
  const eps = height * 0.006;
  for (const c of concepts) {
    if (c.synthetic || c.mirrored || SIDE_RE.test(c.name) || !c.el.length || c.el.length > 4) continue;
    let L = 0, R = 0;
    for (const e of c.el) { const x = (meshes[e].box[0] + meshes[e].box[3]) / 2; if (x > x0 + eps) L++; else if (x < x0 - eps) R++; }
    if (L === c.el.length) c.side = 'left';
    else if (R === c.el.length) c.side = 'right';
  }
}

async function assemble({ meshes, concepts, best, cats, roots, outDir, meta = {}, mirror = { categories: ['muscle'] }, onProgress = () => {}, extraFiles = {} }) {
  onProgress({ phase: 'orient', message: 'Orienting the body' });
  const o = orient(meshes, (i) => concepts[best[i]].name);
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) { lo = Math.min(lo, m.box[1]); hi = Math.max(hi, m.box[4]); }
  const height = hi - lo;
  const x0 = o.midline();

  let mirrored = 0;
  if (mirror && mirror.categories && mirror.categories.length) {
    const r = mirrorMissing(meshes, concepts, best, cats, { categories: mirror.categories, x0, height });
    mirrored = r.added;
    if (r.group >= 0) roots.partof.push(r.group);
    if (mirrored) onProgress({ phase: 'mirror', message: `Mirrored ${mirrored} one-sided structures` });
  }
  markSides(meshes, concepts, x0, height);
  for (const c of concepts) c.el.sort((a, b) => a - b);

  // centre, scale, pack
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], m.box[a]); bb[a + 3] = Math.max(bb[a + 3], m.box[a + 3]); }
  const scale = height > 50 ? 0.001 : 1; // millimetres -> metres
  const cx = x0, cz = (bb[2] + bb[5]) / 2, y0 = bb[1];

  let V = 0, I = 0;
  for (const m of meshes) { V += m.positions.length / 3; I += m.indices.length; }
  const positions = new Float32Array(V * 3);
  const normals = new Int16Array(V * 3 + (V * 3) % 2);
  const indices = new Uint32Array(I);
  const elements = [];
  let vo = 0, io = 0;
  const r4 = v => Math.round(v * 1e4) / 1e4;
  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) { p[i] = (p[i] - cx) * scale; p[i + 1] = (p[i + 1] - y0) * scale; p[i + 2] = (p[i + 2] - cz) * scale; }
    const b = meshBox(p);
    const n = computeNormals(p, m.indices);
    positions.set(p, vo * 3);
    for (let i = 0; i < n.length; i++) normals[vo * 3 + i] = Math.round(n[i] * 32767);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    const e = { k: m.key, c: best[mi], t: cats[mi], o: io, n: m.indices.length, b: b.map(r4) };
    if (concepts[best[mi]].mirrored) e.m = 1;
    elements.push(e);
    vo += p.length / 3; io += m.indices.length;
    m.positions = m.indices = null;
    if (mi % 50 === 0) { onProgress({ phase: 'pack', loaded: mi + 1, total: meshes.length, message: `Packing ${mi + 1}/${meshes.length}` }); await tick(); }
  }

  const posBytes = Buffer.from(positions.buffer), norBytes = Buffer.from(normals.buffer), idxBytes = Buffer.from(indices.buffer);
  const index = {
    format: 'open-anatomy-atlas/1',
    source: meta.source || 'bp3d40',
    name: meta.name || 'BodyParts3D',
    version: meta.version || '4.0',
    attribution: meta.attribution,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    sourceUrl: meta.sourceUrl,
    notes: meta.notes || [],
    builtAt: new Date().toISOString(),
    categories: Object.assign({}, CATEGORIES, meta.categories || {}),
    bbox: [(bb[0] - cx) * scale, 0, (bb[2] - cz) * scale, (bb[3] - cx) * scale, (bb[4] - y0) * scale, (bb[5] - cz) * scale].map(r4),
    counts: { elements: elements.length, concepts: concepts.length, triangles: I / 3, vertices: V, mirrored },
    buffers: { positions: [0, posBytes.length], normals: [posBytes.length, norBytes.length], indices: [posBytes.length + norBytes.length, idxBytes.length] },
    elements,
    concepts,
    roots,
  };

  onProgress({ phase: 'write', message: 'Writing atlas files' });
  const tmp = outDir + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const fd = fs.openSync(path.join(tmp, 'meshes.bin'), 'w');
  fs.writeSync(fd, posBytes); fs.writeSync(fd, norBytes); fs.writeSync(fd, idxBytes);
  fs.closeSync(fd);
  fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify(index));
  for (const [name, data] of Object.entries(extraFiles)) fs.writeFileSync(path.join(tmp, name), typeof data === 'string' ? data : JSON.stringify(data));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(tmp, outDir);
  onProgress({ phase: 'done', message: `Atlas ready: ${elements.length} meshes${mirrored ? ` (${mirrored} mirrored)` : ''}, ${concepts.length} named structures` });
  return index.counts;
}

module.exports = { assemble, baseName, swapSide, meshBox };
