'use strict';
// Builds the app's compact atlas format (index.json + meshes.bin) from the
// BodyParts3D distribution: tab-separated concept lists + OBJ meshes (inside
// zip archives or plain folders).
//
// Source data: BodyParts3D, (c) The Database Center for Life Science,
// licensed under CC Attribution 4.0 International.

const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('./zip');
const { parseOBJ } = require('./obj');
const { buildGraph, newConcept, link } = require('./graph');
const { assemble } = require('./assemble');

const LIST_FILES = {
  partofParts: 'partof_parts_list_e.txt',
  isaParts: 'isa_parts_list_e.txt',
  partofRel: 'partof_inclusion_relation_list.txt',
  isaRel: 'isa_inclusion_relation_list.txt',
  partofElem: 'partof_element_parts.txt',
  isaElem: 'isa_element_parts.txt',
};

const ATTRIBUTION = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';

const tick = () => new Promise(r => setImmediate(r));

// ---------- tables ----------

function parseTSV(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return { header: [], rows: [] };
  const first = lines[0].split('\t').map(s => s.trim());
  const looksLikeData = /^(FMA|BP|FJ)\d/i.test(first[0]);
  const header = looksLikeData ? [] : first.map(h => h.toLowerCase());
  const rows = (looksLikeData ? lines : lines.slice(1)).map(l => l.split('\t').map(s => s.trim()));
  return { header, rows };
}

function colIndex(header, preds, fallback) {
  for (const p of preds) {
    const i = header.findIndex(p);
    if (i >= 0) return i;
  }
  return fallback;
}

function findListFile(dirs, name) {
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readLists(dirs) {
  const out = {};
  for (const [k, name] of Object.entries(LIST_FILES)) {
    const p = findListFile(dirs, name);
    out[k] = p ? parseTSV(fs.readFileSync(p, 'utf8')) : null;
  }
  return out;
}

function elementKey(name) {
  const base = path.basename(String(name)).replace(/\.obj$/i, '');
  const m = /^(FJ\d+M?)(?=_|$)/i.exec(base);
  return m ? m[1].toUpperCase() : base;
}

// ---------- mesh sources ----------

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collectObjSources(sources) {
  const map = new Map();
  const archives = [];
  for (const src of sources) {
    if (!src || !fs.existsSync(src)) continue;
    const st = fs.statSync(src);
    const files = st.isDirectory() ? walk(src, []) : [src];
    for (const f of files) {
      if (/\.obj$/i.test(f)) {
        const k = elementKey(f);
        if (!map.has(k)) map.set(k, () => fs.readFileSync(f, 'latin1'));
      } else if (/\.zip$/i.test(f)) {
        const zip = new ZipArchive(f);
        archives.push(zip);
        for (const e of zip.files()) {
          if (!/\.obj$/i.test(e.name)) continue;
          const k = elementKey(e.name);
          if (!map.has(k)) map.set(k, () => zip.read(e).toString('latin1'));
        }
      }
    }
  }
  return { map, archives };
}

// ---------- build ----------

const META_40 = {
  source: 'bp3d40', name: 'BodyParts3D', version: '4.0',
  attribution: ATTRIBUTION, license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/',
};

// Reads the BodyParts3D concept lists into a concept map.
function conceptsFromLists(lists, C = new Map()) {
  for (const key of ['partofParts', 'isaParts']) {
    const t = lists[key]; if (!t) continue;
    const ci = colIndex(t.header, [h => h.includes('concept'), h => h === 'id'], 0);
    const ni = colIndex(t.header, [h => h === 'en', h => h.includes('name'), h => h.includes('en')], t.rows[0] ? t.rows[0].length - 1 : 1);
    for (const r of t.rows) newConcept(C, r[ci], r[ni]);
  }
  for (const [key, tree] of [['partofRel', 'p'], ['isaRel', 'i']]) {
    const t = lists[key]; if (!t) continue;
    const pi = colIndex(t.header, [h => h.includes('parent') && h.includes('id')], 0);
    const pn = colIndex(t.header, [h => h.includes('parent') && h.includes('name')], 1);
    const ki = colIndex(t.header, [h => h.includes('child') && h.includes('id')], 2);
    const kn = colIndex(t.header, [h => h.includes('child') && h.includes('name')], 3);
    for (const r of t.rows) {
      newConcept(C, r[pi], r[pn]); newConcept(C, r[ki], r[kn]);
      link(C, r[pi], r[ki], tree);
    }
  }
  for (const key of ['partofElem', 'isaElem']) {
    const t = lists[key]; if (!t) continue;
    const ci = colIndex(t.header, [h => h.includes('concept'), h => h === 'id'], 0);
    const ni = colIndex(t.header, [h => h === 'name', h => h.includes('name'), h => h === 'en'], 1);
    const ei = colIndex(t.header, [h => h.includes('element'), h => h.includes('file')], 2);
    for (const r of t.rows) {
      const c = newConcept(C, r[ci], r[ni]);
      if (c && r[ei]) c.direct.add(elementKey(r[ei]));
    }
  }
  return C;
}

async function parseMeshes(objs, onProgress) {
  const keys = [...objs.keys()].sort();
  const meshes = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    try {
      const m = parseOBJ(objs.get(k)());
      if (m.indices.length >= 3 && m.positions.length >= 9) meshes.push({ key: k, ...m });
    } catch (e) {
      onProgress({ phase: 'warn', message: `Skipped ${k}: ${e.message}` });
    }
    if (i % 20 === 0) {
      onProgress({ phase: 'parse', loaded: i + 1, total: keys.length, message: `Parsing meshes ${i + 1}/${keys.length}` });
      await tick();
    }
  }
  if (!meshes.length) throw new Error('All meshes were empty or unreadable.');
  return meshes;
}

async function buildDataset({ sources, listDirs = [], outDir, onProgress = () => {}, meta = {}, mirror }) {
  onProgress({ phase: 'index', message: 'Reading structure lists' });
  const lists = readLists(listDirs.concat(sources.filter(s => s && fs.existsSync(s) && fs.statSync(s).isDirectory())));
  const { map: objs, archives } = collectObjSources(sources);
  if (objs.size === 0) throw new Error('No OBJ meshes found in the provided sources.');
  const C = conceptsFromLists(lists);
  const meshes = await parseMeshes(objs, onProgress);
  for (const a of archives) a.close();
  const g = buildGraph(C, meshes, { keepUnnamed: true });
  return assemble({ meshes, ...g, outDir, onProgress, meta: Object.assign({}, META_40, meta), mirror });
}

module.exports = { buildDataset, parseTSV, elementKey, readLists, collectObjSources, conceptsFromLists, parseMeshes, LIST_FILES, ATTRIBUTION };
