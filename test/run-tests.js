#!/usr/bin/env node
'use strict';
// Dependency-free test-suite for the data pipeline:  npm test

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const { ZipArchive } = require('../src/data/zip');
const { parseOBJ, computeNormals } = require('../src/data/obj');
const { parseTSV, elementKey, buildDataset } = require('../src/data/bp3d');
const { classify } = require('../src/data/classify');
const pipeline = require('../src/data/pipeline');

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- tiny zip writer for fixtures ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function writeZip(file, entries, method = 8) {
  const locals = [], cents = [];
  let off = 0;
  for (const [name, data] of entries) {
    const nb = Buffer.from(name);
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); cents.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(cents);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));

test('zip: reads deflated and stored entries', () => {
  for (const m of [0, 8]) {
    const f = path.join(tmp, `t${m}.zip`);
    writeZip(f, [['a/x.txt', Buffer.from('hello')], ['b.obj', Buffer.from('v 0 0 0\n'.repeat(100))]], m);
    const z = new ZipArchive(f);
    assert.strictEqual(z.files().length, 2);
    assert.strictEqual(z.read(z.files()[0]).toString(), 'hello');
    assert.strictEqual(z.read(z.files()[1]).length, 800);
  }
});

test('obj: triangulates polygons, handles slashes and negative indices', () => {
  const m = parseOBJ('# c\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1 4//1\nf -4 -3 -2\n');
  assert.strictEqual(m.positions.length, 12);
  assert.deepStrictEqual([...m.indices], [0, 1, 2, 0, 2, 3, 0, 1, 2]);
  const n = computeNormals(m.positions, m.indices);
  assert.ok(Math.abs(Math.abs(n[2]) - 1) < 1e-6);
});

test('tsv: strips BOM, detects header, CRLF', () => {
  const t = parseTSV('﻿concept id\tname\telement file id\r\nFMA1\tx\tFJ1\r\n');
  assert.deepStrictEqual(t.header, ['concept id', 'name', 'element file id']);
  assert.deepStrictEqual(t.rows, [['FMA1', 'x', 'FJ1']]);
  assert.strictEqual(parseTSV('FMA1\tx\tFJ1\n').rows.length, 1);
});

test('element keys from different file naming schemes', () => {
  assert.strictEqual(elementKey('dir/FJ1234.obj'), 'FJ1234');
  assert.strictEqual(elementKey('FJ1234_BP567_FMA7163_Skin.obj'), 'FJ1234');
});

test('classification of typical FMA names', () => {
  const cases = { 'left femur': 'bone', 'right biceps brachii': 'muscle', 'arch of aorta': 'artery', 'left internal jugular vein': 'vein',
    'right sciatic nerve': 'nervous', 'left occipital lobe': 'nervous', 'anterior cruciate ligament': 'ligament', 'thyroid cartilage': 'cartilage',
    'liver': 'organ', 'skin': 'skin', 'upper lobe of left lung': 'organ', 'right lower first molar tooth': 'bone' };
  for (const [n, c] of Object.entries(cases)) assert.strictEqual(classify([n]), c, n);
  assert.strictEqual(classify(['thing', 'skeletal system']), 'bone');
});

test('build: full pipeline from BodyParts3D-style files', async () => {
  const sample = path.join(tmp, 'sample');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'make-sample-data.js'), sample], { stdio: 'ignore' });
  const objDir = path.join(sample, 'partof_BP3D_4.0_obj_99');
  const zipFile = path.join(sample, 'partof_BP3D_4.0_obj_99.zip');
  writeZip(zipFile, fs.readdirSync(objDir).map(f => ['partof_BP3D_4.0_obj_99/' + f, fs.readFileSync(path.join(objDir, f))]));
  const lists = path.join(tmp, 'lists');
  fs.mkdirSync(lists);
  for (const f of fs.readdirSync(sample)) if (f.endsWith('.txt')) fs.copyFileSync(path.join(sample, f), path.join(lists, f));

  const dataDir = path.join(tmp, 'data');
  const res = await pipeline.importLocal({ dataDir, files: [zipFile, ...fs.readdirSync(lists).map(f => path.join(lists, f))] });
  assert.ok(pipeline.status(dataDir).ready);
  const idx = JSON.parse(fs.readFileSync(path.join(pipeline.atlasPaths(dataDir, 'bp3d40').build, 'index.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(pipeline.atlasPaths(dataDir, 'bp3d40').build, 'meshes.bin'));
  assert.strictEqual(bin.length, idx.buffers.indices[0] + idx.buffers.indices[1]);
  assert.strictEqual(res.counts.elements, 41);

  const find = (n) => idx.elements.find(e => idx.concepts[e.c].name === n);
  const ctr = (e) => [(e.b[0] + e.b[3]) / 2, (e.b[1] + e.b[4]) / 2, (e.b[2] + e.b[5]) / 2];
  // orientation: feet at 0, metres, head up, sternum in front (+Z) of the spine, patient's left at +X
  assert.strictEqual(idx.bbox[1], 0);
  assert.ok(idx.bbox[4] > 1.5 && idx.bbox[4] < 2.0, 'height in metres');
  assert.ok(ctr(find('skull'))[1] > ctr(find('left femur'))[1], 'head above legs');
  assert.ok(ctr(find('sternum'))[2] > ctr(find('thoracic vertebral column'))[2], 'sternum in front');
  assert.ok(ctr(find('left femur'))[0] > 0 && ctr(find('right femur'))[0] < 0, 'left is +X');
  assert.ok(ctr(find('heart'))[0] > 0, 'heart on the patient’s left');
  // categories + hierarchy
  assert.strictEqual(find('left femur').t, 'bone');
  assert.strictEqual(find('left biceps brachii').t, 'muscle');
  const limb = idx.concepts.find(c => c.name === 'left upper limb');
  assert.strictEqual(limb.el.length, 5);
  assert.ok(!idx.concepts.some(c => c.name === 'structure without mesh'), 'concepts without meshes pruned');
  assert.ok(idx.concepts.some(c => c.name === 'FJ9999' && c.orphan), 'unnamed meshes kept');
  assert.ok(idx.roots.partof.map(r => idx.concepts[r].name).includes('human body'));
  // index buffer references valid vertices
  const V = idx.buffers.positions[1] / 12;
  const I = new Uint32Array(bin.buffer, bin.byteOffset + idx.buffers.indices[0], idx.buffers.indices[1] / 4);
  let max = 0; for (const v of I) if (v > max) max = v;
  assert.ok(max < V);
});

test('mirroring: one-sided muscles get a flagged copy on the other side', async () => {
  const sample = path.join(tmp, 'sample');
  const objDir = path.join(sample, 'partof_BP3D_4.0_obj_99');
  const rows = fs.readFileSync(path.join(sample, 'partof_element_parts.txt'), 'utf8').split(/\r?\n/).map(l => l.split('\t'));
  const fjOf = (n) => rows.find(r => r[1] === n)[2];
  const dir = path.join(tmp, 'onesided');
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(objDir)) fs.copyFileSync(path.join(objDir, f), path.join(dir, f));
  for (const n of ['left biceps brachii', 'left gastrocnemius']) fs.rmSync(path.join(dir, fjOf(n) + '.obj'));
  const dataDir = path.join(tmp, 'data-mirror');
  const res = await pipeline.importLocal({ dataDir, files: [dir, ...fs.readdirSync(sample).filter(f => f.endsWith('.txt')).map(f => path.join(sample, f))] });
  assert.strictEqual(res.counts.mirrored, 2);
  const idx = JSON.parse(fs.readFileSync(path.join(pipeline.atlasPaths(dataDir, 'bp3d40').build, 'index.json'), 'utf8'));
  const m = idx.concepts.find(c => c.name === 'left biceps brachii');
  assert.ok(m && m.mirrored, 'mirrored concept named for the other side');
  const e = idx.elements[m.el[0]];
  assert.ok(e.m === 1 && (e.b[0] + e.b[3]) / 2 > 0, 'copy sits on the patient’s left');
  const orig = idx.elements.find(x => idx.concepts[x.c].name === 'right biceps brachii');
  assert.ok(Math.abs((e.b[0] + e.b[3]) / 2 + (orig.b[0] + orig.b[3]) / 2) < 0.01, 'mirror image across the midline');
  assert.ok(idx.concepts.find(c => c.name === 'human body').el.includes(m.el[0]), 'ancestors include the copy');
  // a second build with mirroring off adds nothing
  const r2 = await pipeline.importLocal({ dataDir: path.join(tmp, 'data-nomirror'), files: [dir, ...fs.readdirSync(sample).filter(f => f.endsWith('.txt')).map(f => path.join(sample, f))], mirror: { categories: [] } });
  assert.strictEqual(r2.counts.mirrored, 0);
});

test('BodyParts3D 4.3 manifest and mesh index parsing', () => {
  const { parseFMA2Obj, parseObj2FMA } = require('../src/data/bp3d43');
  const man = parseFMA2Obj('# Data Version\t4.3\rFMA1\tis_a\tFJ1+FJ2M\rFMA2\tpart_of\tFJ3\r');
  assert.deepStrictEqual(man.map(r => r.fj), [['FJ1', 'FJ2M'], ['FJ3']]);
  const map = parseObj2FMA('<tr>\n<td class="art_id">FJ2M</td>\n<td class="rep_id">BP9</td>\n<td class="cdi_name">FMA7</td>\n<td class="cdi_name_e">Long head of left biceps brachii</td>\n</tr><tr><td class="art_id">CX1</td></tr>');
  assert.deepStrictEqual(map, [{ fj: 'FJ2M', bp: 'BP9', fma: 'FMA7', name: 'Long head of left biceps brachii' }]);
});

test('Z-Anatomy names, definitions and glTF node transforms', () => {
  const { prettyName, splitDefinition, extractGLB } = require('../src/data/zanatomy');
  assert.strictEqual(prettyName('Calcaneus.l'), 'left calcaneus');
  assert.strictEqual(prettyName('Atlas (C1)'), 'atlas (C1)');
  assert.deepStrictEqual(splitDefinition('The femur is a bone. https://en.wikipedia.org/wiki/Femur'), { text: 'The femur is a bone.', url: 'https://en.wikipedia.org/wiki/Femur' });
  // minimal non-Draco glb: one triangle, used by a parent (translated) and a mirrored child
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint16Array([0, 1, 2, 0]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = {
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'A.r', mesh: 0, translation: [10, 0, 0], children: [1] }, { name: 'B.l', mesh: 0, scale: [-1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
  };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  const body = Buffer.concat([chunk(0x4e4f534a, js), chunk(0x004e4942, bin)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  const items = extractGLB(Buffer.concat([head, body]), 'skeletal', null);
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual([...items[0].positions.slice(0, 3)], [10, 0, 0]);
  assert.deepStrictEqual([...items[1].positions.slice(3, 6)], [9, 0, 0], 'child: parent translate then mirror');
  assert.deepStrictEqual([...items[1].indices], [0, 2, 1], 'mirrored node flips winding');
  assert.strictEqual(items[1].parentName, 'A.r');
});

test('download: compressed responses are not mistaken for incomplete ones', async () => {
  const text = Buffer.from('x'.repeat(1746));
  const fakeFetch = async () => new Response(text, { headers: { 'content-length': '812', 'content-encoding': 'gzip' } });
  const dest = path.join(tmp, 'License.txt');
  await pipeline.download('https://example.invalid/License.txt', dest, { fetchImpl: fakeFetch, label: 'License.txt' });
  assert.strictEqual(fs.statSync(dest).size, 1746);
});

test('download: streams to disk with progress, skips existing', async () => {
  const body = Buffer.alloc(300000, 7);
  const fakeFetch = async () => new Response(body, { headers: { 'content-length': String(body.length) } });
  const dest = path.join(tmp, 'dl.bin');
  const events = [];
  await pipeline.download('https://example.invalid/x', dest, { fetchImpl: fakeFetch, onProgress: e => events.push(e), label: 'x' });
  assert.strictEqual(fs.statSync(dest).size, body.length);
  assert.ok(events.length >= 1);
  let called = false;
  await pipeline.download('https://example.invalid/x', dest, { fetchImpl: async () => { called = true; }, label: 'x' });
  assert.ok(!called);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
