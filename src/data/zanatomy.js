'use strict';
// Z-Anatomy: the open-source 3D atlas built on BodyParts3D, completed with
// both sides of the body, ligaments, lymphatics, brain nuclei, Latin
// (Terminologia Anatomica) names and definitions.
//
// We use the per-system glTF export published in github.com/nqwrc/3d-anatomy
// (Draco-compressed .glb with the Z-Anatomy name on every object), pinned to a
// fixed commit so builds are reproducible. The Draco decoder (Apache-2.0) is
// downloaded from the same commit.

const fs = require('fs');
const path = require('path');
const { download } = require('./pipeline-download');
const { buildGraph, newConcept, link } = require('./graph');
const { assemble, baseName } = require('./assemble');
const { classifyName } = require('./classify');

const COMMIT = '8ca3b7421bcfbe88b85859eb1983d5cf79f21749';
const RAW = `https://raw.githubusercontent.com/nqwrc/3d-anatomy/${COMMIT}/public/`;
const SYSTEMS = {
  skeletal: { name: 'Skeletal system', cat: 'bone', allow: ['bone', 'cartilage'] },
  joints: { name: 'Joints and ligaments', cat: 'ligament', allow: ['ligament', 'cartilage', 'fascia'] },
  muscular: { name: 'Muscular system', cat: 'muscle', allow: ['muscle', 'ligament', 'fascia'] },
  cardiovascular: { name: 'Cardiovascular system', cat: 'organ', allow: ['artery', 'vein', 'organ'] },
  lymphatic: { name: 'Lymphatic system', cat: 'lymph', allow: [] },
  nervous: { name: 'Nervous system', cat: 'nervous', allow: [] },
  visceral: { name: 'Viscera', cat: 'organ', allow: ['organ', 'artery', 'vein', 'cartilage', 'muscle', 'fascia'] },
};
const FILES = [
  ...Object.keys(SYSTEMS).map(s => `models/${s}.glb`),
  'models/License.txt', 'data/definitions.json', 'data/lexicon.json', 'draco/draco_decoder.js',
];
// Components under non-commercial licences (see models/License.txt): the inner
// ear (University of Dundee, CC BY-NC-SA 4.0) and the kidney (lissiecowley, CC BY-NC 4.0).
const NON_COMMERCIAL = /^(cochlea|vestibule|kidney)\.(l|r)$/i;

const LICENSE_NOTE = [
  'BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan',
  'Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0',
  'Cranial Nerves and Foramina - by University of Dundee, CAHID - CC-BY 4.0',
  '"Brainder" and "White matter" from the University of Washington',
];

// ---------- download ----------

async function downloadZ({ rawDir, fetchImpl, onProgress = () => {} }) {
  fs.mkdirSync(rawDir, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(rawDir, f.replace('draco_decoder.js', 'draco_decoder.cjs'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(RAW + f, dest, { fetchImpl, onProgress, label: path.basename(f) });
  }
}

// ---------- glTF / Draco ----------

function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a .glb file');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const T = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = dv[get](base + i * stride + c * T.BYTES_PER_ELEMENT, true);
  return out;
}

function decodeDraco(D, json, bin, ext) {
  const bv = json.bufferViews[ext.bufferView];
  const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const decoder = new D.Decoder();
  const buffer = new D.DecoderBuffer();
  buffer.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
  const mesh = new D.Mesh();
  try {
    const st = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!st.ok()) throw new Error('Draco: ' + st.error_msg());
    const att = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
    const pa = new D.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, att, pa);
    const positions = new Float32Array(pa.size());
    for (let i = 0; i < positions.length; i++) positions[i] = pa.GetValue(i);
    D.destroy(pa);
    const nf = mesh.num_faces();
    const indices = new Uint32Array(nf * 3);
    const fa = new D.DracoInt32Array();
    for (let f = 0; f < nf; f++) {
      decoder.GetFaceFromMesh(mesh, f, fa);
      indices[f * 3] = fa.GetValue(0); indices[f * 3 + 1] = fa.GetValue(1); indices[f * 3 + 2] = fa.GetValue(2);
    }
    D.destroy(fa);
    return { positions, indices };
  } finally {
    D.destroy(mesh); D.destroy(buffer); D.destroy(decoder);
  }
}

// column-major 4x4 helpers
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const det3 = (m) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

// Returns [{ name, system, parentName, positions, indices }]
function extractGLB(buf, system, D) {
  const { json, bin } = readGLB(buf);
  const parent = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
  const world = new Map();
  const worldOf = (i) => {
    if (world.has(i)) return world.get(i);
    const m = parent.has(i) ? mul4(worldOf(parent.get(i)), trs(json.nodes[i])) : trs(json.nodes[i]);
    world.set(i, m);
    return m;
  };
  const cache = new Map();
  const meshData = (mi) => {
    if (cache.has(mi)) return cache.get(mi);
    const parts = [];
    for (const p of json.meshes[mi].primitives) {
      if ((p.mode ?? 4) !== 4) continue;
      const ext = p.extensions && p.extensions.KHR_draco_mesh_compression;
      if (ext) parts.push(decodeDraco(D, json, bin, ext));
      else parts.push({ positions: readAccessor(json, bin, p.attributes.POSITION), indices: p.indices !== undefined ? readAccessor(json, bin, p.indices) : null });
    }
    let V = 0, I = 0;
    for (const p of parts) { if (!p.indices) p.indices = Uint32Array.from({ length: p.positions.length / 3 }, (_, k) => k); V += p.positions.length; I += p.indices.length; }
    const positions = new Float32Array(V), indices = new Uint32Array(I);
    let vo = 0, io = 0;
    for (const p of parts) { positions.set(p.positions, vo); for (let k = 0; k < p.indices.length; k++) indices[io + k] = p.indices[k] + vo / 3; vo += p.positions.length; io += p.indices.length; }
    const r = { positions, indices };
    cache.set(mi, r);
    return r;
  };
  const nameOf = (i) => (json.nodes[i].extras && json.nodes[i].extras.za_name) || json.nodes[i].name || `node ${i}`;
  const out = [];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const src = meshData(n.mesh);
    if (!src.indices.length) return;
    const m = worldOf(i);
    const p = new Float32Array(src.positions.length);
    for (let v = 0; v < p.length; v += 3) {
      const x = src.positions[v], y = src.positions[v + 1], z = src.positions[v + 2];
      p[v] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const idx = Uint32Array.from(src.indices);
    if (det3(m) < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    out.push({ name: nameOf(i), system, parentName: parent.has(i) ? nameOf(parent.get(i)) : null, positions: p, indices: idx });
  });
  return out;
}

// "Calcaneus.l" -> "left calcaneus"; keeps acronyms such as "C1" intact.
function prettyName(za) {
  const m = /^(.*)\.(l|r)$/.exec(za);
  const base = m ? m[1] : za;
  const lower = /^[A-Z][a-z]/.test(base) ? base.charAt(0).toLowerCase() + base.slice(1) : base;
  return m ? `${m[2] === 'l' ? 'left' : 'right'} ${lower}` : lower;
}

function splitDefinition(text) {
  const m = /\s*(https?:\/\/\S+)\s*$/.exec(text || '');
  const clean = (t) => t.replace(/\s*={2,}[^=]+={2,}\s*/g, ' ').replace(/\s+/g, ' ').trim(); // drop wiki section headings
  return m ? { text: clean(text.slice(0, m.index)), url: m[1] } : { text: clean(text || ''), url: null };
}

// ---------- build ----------

async function buildZ({ rawDir, outDir, onProgress = () => {}, commercialSafe = false, mirror }) {
  const decoderPath = path.join(rawDir, 'draco', 'draco_decoder.cjs');
  if (!fs.existsSync(decoderPath)) throw new Error('Z-Anatomy files are missing. Download them first.');
  // The emscripten module exports a factory that resolves to the decoder.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const D = await require(decoderPath)();
  const readJSON = (f) => { const p = path.join(rawDir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}; };
  const lexicon = readJSON('data/lexicon.json');
  const definitions = readJSON('data/definitions.json');

  let items = [];
  const sysNames = Object.keys(SYSTEMS);
  for (let s = 0; s < sysNames.length; s++) {
    const sys = sysNames[s];
    onProgress({ phase: 'parse', loaded: s, total: sysNames.length, message: `Decoding ${SYSTEMS[sys].name.toLowerCase()}` });
    const file = path.join(rawDir, 'models', `${sys}.glb`);
    items = items.concat(extractGLB(fs.readFileSync(file), sys, D));
    await new Promise(r => setImmediate(r));
  }
  let excluded = 0;
  if (commercialSafe) { const before = items.length; items = items.filter(it => !NON_COMMERCIAL.test(it.name)); excluded = before - items.length; }

  const C = new Map();
  const root = newConcept(C, 'ZA-BODY', 'human body');
  for (const [sys, info] of Object.entries(SYSTEMS)) { newConcept(C, 'ZA-SYS-' + sys, info.name.charAt(0).toLowerCase() + info.name.slice(1)); link(C, root.id, 'ZA-SYS-' + sys, 'p'); }

  const glossaryFor = (za) => {
    const b = za.replace(/\.(l|r)$/, '');
    const lx = lexicon[b] || lexicon[b.replace(/^\((.*)\)$/, '$1')] || null;
    const df = definitions[b] || definitions[b.replace(/^\((.*)\)$/, '$1')] || null;
    return { la: lx && lx.la, def: df ? splitDefinition(df) : null };
  };

  const meshes = [];
  const nameToId = new Map();
  for (const it of items) {
    const id = 'ZA:' + it.name;
    nameToId.set(it.name, id);
    const c = newConcept(C, id, prettyName(it.name));
    const g = glossaryFor(it.name);
    if (g.la) c.la = g.la;
    if (g.def && g.def.text) c.def = g.def;
    c.direct.add(id);
    c.system = it.system;
    meshes.push({ key: id, name: c.name, positions: it.positions, indices: it.indices });
  }
  for (const it of items) {
    const id = nameToId.get(it.name);
    const pid = it.parentName && nameToId.get(it.parentName);
    link(C, pid || 'ZA-SYS-' + it.system, id, 'p');
  }
  // left/right pairs share a parent concept ("calcaneus" -> left + right)
  const pairs = new Map();
  for (const it of items) {
    const m = /^(.*)\.(l|r)$/.exec(it.name);
    if (!m) continue;
    const key = it.system + '|' + m[1] + '|' + (it.parentName || '');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(it);
  }
  for (const [key, list] of pairs) {
    if (list.length !== 2) continue;
    const base = key.split('|')[1];
    const pid = 'ZA-PAIR:' + key;
    const pc = newConcept(C, pid, prettyName(base));
    const g = glossaryFor(base);
    if (g.la) pc.la = g.la;
    if (g.def && g.def.text) pc.def = g.def;
    for (const it of list) {
      const id = nameToId.get(it.name);
      const c = C.get(id);
      for (const p of [...c.pp]) { C.get(p).pc.delete(id); c.pp.delete(p); link(C, p, pid, 'p'); }
      link(C, pid, id, 'p');
    }
  }

  const catOf = (it) => {
    const s = SYSTEMS[it.system];
    const c = classifyName(it.name.replace(/\.(l|r)$/, ''));
    return c && s.allow.includes(c) ? c : s.cat;
  };
  const cats = items.map(catOf);
  // "By type" tree: one group per display category
  const TYPE_NAMES = { fascia: 'fasciae', bone: 'bones and teeth', cartilage: 'cartilage', ligament: 'ligaments, fasciae and joints', muscle: 'muscles and tendons', artery: 'arteries', vein: 'veins', nervous: 'nervous system', organ: 'organs and viscera', lymph: 'lymphatic system' };
  items.forEach((it, i) => {
    const t = 'ZA-TYPE-' + cats[i];
    newConcept(C, t, TYPE_NAMES[cats[i]] || cats[i]);
    const id = nameToId.get(it.name);
    const pair = [...C.get(id).pp].find(p => p.startsWith('ZA-PAIR:'));
    link(C, t, pair || id, 'i');
    if (pair) link(C, pair, id, 'i');
  });

  const g = buildGraph(C, meshes, { category: (i) => cats[i] });
  const glossary = {};
  for (const c of g.concepts) {
    if (!c.la && !c.def) continue;
    const k = baseName(c.name);
    if (!glossary[k]) glossary[k] = { la: c.la, def: c.def };
  }
  return assemble({ meshes, ...g, outDir, onProgress, mirror, extraFiles: { 'glossary.json': glossary }, meta: {
    source: 'zanatomy', name: 'Z-Anatomy', version: COMMIT.slice(0, 7),
    attribution: 'Z-Anatomy (CC BY-SA 4.0), based on BodyParts3D © The Database Center for Life Science',
    license: commercialSafe ? 'CC BY-SA 4.0' : 'CC BY-NC-SA 4.0 (non-commercial: includes inner ear and kidney models)',
    licenseUrl: commercialSafe ? 'https://creativecommons.org/licenses/by-sa/4.0/' : 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    sourceUrl: 'https://www.z-anatomy.com/',
    notes: LICENSE_NOTE.concat(commercialSafe ? [`Commercial-safe build: ${excluded} non-commercial meshes left out.`] : [
      'Anatomy of the Inner Ear - by University of Dundee School of Medicine - CC-BY-NC-SA 4.0',
      'Kidney - by lissiecowley - CC-BY-NC 4.0',
    ]).concat(['Definitions: Wikipedia, CC BY-SA 3.0 / GFDL']),
  } });
}

module.exports = { downloadZ, buildZ, readGLB, extractGLB, prettyName, splitDefinition, COMMIT, NON_COMMERCIAL };
