#!/usr/bin/env node
'use strict';
// Builds a static copy of the app plus atlas data, ready for GitHub Pages or
// any static web host (no server code needed).
//
//   node tools/build-site.js [--out site] [--atlases bp3d43,zanatomy] [--default bp3d43]
//                            [--dir <dataDir>] [--part-mb 90] [--skip-missing]
//
// Atlases must already be built (npm run fetch-data:43 etc.). Mesh files are
// split into parts below GitHub's 100 MB file limit.

const fs = require('fs');
const path = require('path');
const pipeline = require('../src/data/pipeline');
const { defaultDataDir } = require('./fetch-data-paths');

const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const out = path.resolve(get('--out', 'site'));
const dataDir = path.resolve(get('--dir', defaultDataDir()));
const partBytes = Math.round(Number(get('--part-mb', 90)) * 1048576);
const status = pipeline.status(dataDir);
const installed = status.atlases.filter(a => a.ready).map(a => a.id);
const wanted = (get('--atlases', installed.join(',')) || '').split(',').map(s => s.trim()).filter(Boolean);
const uiDir = path.join(__dirname, '..', 'src', 'renderer');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function splitFile(file, dir, prefix) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const parts = [];
  const buf = Buffer.alloc(Math.min(partBytes, 16 * 1048576));
  for (let off = 0, n = 0; off < size; n++) {
    const name = `${prefix}.part${n}.bin`;
    const end = Math.min(size, off + partBytes);
    const ofd = fs.openSync(path.join(dir, name), 'w');
    while (off < end) {
      const len = fs.readSync(fd, buf, 0, Math.min(buf.length, end - off), off);
      fs.writeSync(ofd, buf, 0, len);
      off += len;
    }
    fs.closeSync(ofd);
    parts.push({ file: name, size: fs.statSync(path.join(dir, name)).size });
  }
  fs.closeSync(fd);
  return parts;
}

function main() {
  let missing = wanted.filter(id => !installed.includes(id));
  if (missing.length && args.includes('--skip-missing')) {
    console.warn(`Skipping atlases that are not installed: ${missing.join(', ')}`);
    for (const m of missing) wanted.splice(wanted.indexOf(m), 1);
    missing = [];
  }
  if (missing.length) { console.error(`Not installed: ${missing.join(', ')}. Build them first (npm run fetch-data:43, fetch-data:zanatomy, fetch-data).`); process.exit(1); }
  if (!wanted.length) console.warn('No atlases installed: the site will show the demo mannequin only.');

  fs.rmSync(out, { recursive: true, force: true });
  copyDir(uiDir, out);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  const dataOut = path.join(out, 'data');
  fs.mkdirSync(dataOut, { recursive: true });

  const zGlossary = path.join(pipeline.atlasPaths(dataDir, 'zanatomy').build, 'glossary.json');
  const manifest = { generated: new Date().toISOString(), default: get('--default', wanted.includes('bp3d43') ? 'bp3d43' : wanted[0]), atlases: [] };
  let totalBytes = 0;

  for (const id of wanted) {
    const build = pipeline.atlasPaths(dataDir, id).build;
    const dst = path.join(dataOut, id);
    fs.mkdirSync(dst, { recursive: true });
    const index = JSON.parse(fs.readFileSync(path.join(build, 'index.json'), 'utf8'));
    index.parts = splitFile(path.join(build, 'meshes.bin'), dst, 'meshes');
    fs.writeFileSync(path.join(dst, 'index.json'), JSON.stringify(index));
    if (fs.existsSync(zGlossary)) fs.copyFileSync(zGlossary, path.join(dst, 'glossary.json'));
    const bytes = index.parts.reduce((t, p) => t + p.size, 0);
    totalBytes += bytes;
    const src = pipeline.SOURCES[id];
    manifest.atlases.push({
      id, title: src.title, summary: src.summary, license: index.license, attribution: index.attribution,
      name: index.name, version: index.version, counts: index.counts, size: `${(bytes / 1048576).toFixed(0)} MB`,
    });
    if (/NC/.test(index.license || '')) console.warn(`Note: ${id} is licensed ${index.license}. Only publish it on a non-commercial site, or rebuild with --commercial-safe.`);
    console.log(`${id}: ${index.parts.length} part(s), ${(bytes / 1048576).toFixed(0)} MB`);
  }
  fs.writeFileSync(path.join(dataOut, 'atlases.json'), JSON.stringify(manifest, null, 1));
  console.log(`Site written to ${out} (${(totalBytes / 1048576).toFixed(0)} MB of atlas data).`);
  if (totalBytes > 950 * 1048576) console.warn('Warning: GitHub Pages sites should stay under 1 GB. Publish fewer atlases.');
}

main();
