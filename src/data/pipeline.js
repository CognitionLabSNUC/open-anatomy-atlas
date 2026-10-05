'use strict';
// Download + build pipeline shared by the desktop app, the CLI and browser mode.
//
// Layout of the data folder:
//   <dataDir>/atlases/<source>/raw     downloaded files
//   <dataDir>/atlases/<source>/build   index.json, meshes.bin (+ glossary.json)
//   <dataDir>/active.json              which atlas the app shows

const fs = require('fs');
const path = require('path');
const { download } = require('./pipeline-download');
const { buildDataset, LIST_FILES } = require('./bp3d');

const BASE_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/';
const MESH_ARCHIVES = {
  partof: { file: 'partof_BP3D_4.0_obj_99.zip', approxMB: 62 },
  isa: { file: 'isa_BP3D_4.0_obj_99.zip', approxMB: 136 },
};
const VARIANTS = { full: ['partof', 'isa'], core: ['partof'] };

const SOURCES = {
  bp3d43: {
    title: 'BodyParts3D 4.3, full resolution',
    summary: 'The latest BodyParts3D release: 3,210 full-resolution meshes, including the left-side muscles BodyParts3D mirrored itself. Downloaded from the Anatomography server in batches; takes 10-30 minutes.',
    size: 'about 200-300 MB',
    license: 'CC BY 4.0',
  },
  bp3d40: {
    title: 'BodyParts3D 4.0, simplified',
    summary: 'The official bulk download: 99%-simplified meshes. Quick and light, but many muscles exist on the right side only (the app mirrors them).',
    size: 'about 200 MB (62 MB for the regional set)',
    license: 'CC BY 4.0',
  },
  zanatomy: {
    title: 'Z-Anatomy',
    summary: 'BodyParts3D completed by the Z-Anatomy project: both sides, ligaments, lymphatics, brain nuclei, Latin names and definitions. Non-commercial use only, because of the inner ear and kidney models (a commercial-safe build leaves those out).',
    size: 'about 21 MB',
    license: 'CC BY-NC-SA 4.0',
  },
};

// ---------- paths, status, active atlas ----------

function atlasPaths(dataDir, id) {
  const root = path.join(dataDir, 'atlases', id);
  return { root, raw: path.join(root, 'raw'), build: path.join(root, 'build'), index: path.join(root, 'build', 'index.json') };
}

// Earlier versions stored a single BodyParts3D 4.0 atlas directly in <dataDir>.
function migrateLegacy(dataDir) {
  const oldBuild = path.join(dataDir, 'build');
  if (!fs.existsSync(path.join(oldBuild, 'index.json'))) return;
  const p = atlasPaths(dataDir, 'bp3d40');
  if (fs.existsSync(p.index)) return;
  fs.mkdirSync(p.root, { recursive: true });
  fs.renameSync(oldBuild, p.build);
  const oldRaw = path.join(dataDir, 'raw');
  if (fs.existsSync(oldRaw)) fs.renameSync(oldRaw, p.raw);
  if (!fs.existsSync(path.join(dataDir, 'active.json'))) fs.writeFileSync(path.join(dataDir, 'active.json'), JSON.stringify({ id: 'bp3d40' }));
}

function readIndexInfo(file) {
  try {
    const idx = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ready: true, name: idx.name, version: idx.version, counts: idx.counts, builtAt: idx.builtAt, attribution: idx.attribution, license: idx.license };
  } catch (e) {
    return { ready: false, error: 'Atlas index is unreadable: ' + e.message };
  }
}

function listAtlases(dataDir) {
  migrateLegacy(dataDir);
  return Object.keys(SOURCES).map(id => {
    const p = atlasPaths(dataDir, id);
    const info = fs.existsSync(p.index) ? readIndexInfo(p.index) : { ready: false };
    return { id, ...SOURCES[id], ...info };
  });
}

function activeId(dataDir) {
  const atlases = listAtlases(dataDir);
  let id = null;
  try { id = JSON.parse(fs.readFileSync(path.join(dataDir, 'active.json'), 'utf8')).id; } catch (_) { /* none yet */ }
  const ready = atlases.filter(a => a.ready);
  if (ready.some(a => a.id === id)) return id;
  return ready.length ? ready[0].id : null;
}

function setActive(dataDir, id) {
  if (!SOURCES[id]) throw new Error('Unknown atlas: ' + id);
  if (!fs.existsSync(atlasPaths(dataDir, id).index)) throw new Error('That atlas is not installed yet.');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'active.json'), JSON.stringify({ id }));
  return status(dataDir);
}

function status(dataDir) {
  const atlases = listAtlases(dataDir);
  const active = activeId(dataDir);
  const a = atlases.find(x => x.id === active);
  return { ready: !!a, dataDir, active, atlases, ...(a ? { name: a.name, version: a.version, counts: a.counts, builtAt: a.builtAt, attribution: a.attribution } : {}) };
}

// Maps a request path under /data/ to a file. "index.json" and "meshes.bin"
// come from the active atlas; "glossary.json" from Z-Anatomy when installed.
function resolveDataFile(dataDir, rel) {
  rel = String(rel).replace(/^\/+/, '');
  if (rel.includes('..')) return null;
  if (rel === 'glossary.json') {
    const f = path.join(atlasPaths(dataDir, 'zanatomy').build, 'glossary.json');
    return fs.existsSync(f) ? f : null;
  }
  const first = rel.split('/')[0];
  if (SOURCES[first]) return path.join(atlasPaths(dataDir, first).build, rel.slice(first.length + 1));
  const id = activeId(dataDir);
  return id ? path.join(atlasPaths(dataDir, id).build, rel) : null;
}

// ---------- build / download ----------

async function fetchLists(rawDir, opts) {
  for (const f of Object.values(LIST_FILES)) await download(BASE_URL + f, path.join(rawDir, f), { ...opts, label: f });
}

async function prepare({ dataDir, source = 'bp3d40', variant = 'full', fetchImpl, onProgress = () => {}, commercialSafe = false, mirror }) {
  if (!SOURCES[source]) throw new Error('Unknown data source: ' + source);
  migrateLegacy(dataDir);
  const p = atlasPaths(dataDir, source);
  fs.mkdirSync(p.raw, { recursive: true });
  const dl = { fetchImpl, onProgress };
  let counts;

  if (source === 'bp3d40') {
    await fetchLists(p.raw, dl);
    const zips = [];
    for (const a of VARIANTS[variant] || VARIANTS.full) {
      const { file } = MESH_ARCHIVES[a];
      zips.push(await download(BASE_URL + file, path.join(p.raw, file), { ...dl, label: file }));
    }
    counts = await buildDataset({ sources: zips, listDirs: [p.raw], outDir: p.build, onProgress, mirror });
  } else if (source === 'bp3d43') {
    const { download43, build43 } = require('./bp3d43');
    await fetchLists(p.raw, dl); // names and hierarchy
    await download43({ rawDir: p.raw, onProgress }); // uses Node's fetch for cookie handling
    counts = await build43({ rawDir: p.raw, listDir: p.raw, outDir: p.build, onProgress, mirror });
  } else {
    const { downloadZ, buildZ } = require('./zanatomy');
    await downloadZ({ rawDir: p.raw, fetchImpl, onProgress });
    counts = await buildZ({ rawDir: p.raw, outDir: p.build, onProgress, commercialSafe, mirror });
  }
  setActive(dataDir, source);
  return { ...status(dataDir), counts };
}

// Rebuild an installed source from its downloaded files (e.g. after an app update).
async function rebuild({ dataDir, source, onProgress = () => {}, commercialSafe = false, mirror }) {
  const p = atlasPaths(dataDir, source);
  if (!fs.existsSync(p.raw)) throw new Error('Nothing downloaded for ' + source);
  let counts;
  if (source === 'bp3d40') {
    const zips = Object.values(MESH_ARCHIVES).map(a => path.join(p.raw, a.file)).filter(f => fs.existsSync(f));
    if (!zips.length) throw new Error('The downloaded BodyParts3D 4.0 archives are not in ' + p.raw + '. Download again, or use --import with your files.');
    counts = await buildDataset({ sources: zips, listDirs: [p.raw], outDir: p.build, onProgress, mirror });
  } else if (source === 'bp3d43') {
    counts = await require('./bp3d43').build43({ rawDir: p.raw, listDir: p.raw, outDir: p.build, onProgress, mirror });
  } else {
    counts = await require('./zanatomy').buildZ({ rawDir: p.raw, outDir: p.build, onProgress, commercialSafe, mirror });
  }
  return { ...status(dataDir), counts };
}

// Build BodyParts3D from files the user already has (zip archives, OBJ folders,
// .txt lists). A folder containing metadata/FMA2Obj.txt is treated as 4.3.
async function importLocal({ dataDir, files, onProgress = () => {}, mirror }) {
  migrateLegacy(dataDir);
  const is43 = files.find(f => fs.existsSync(path.join(f, 'metadata', 'FMA2Obj.txt')));
  if (is43) {
    const p = atlasPaths(dataDir, 'bp3d43');
    fs.mkdirSync(p.raw, { recursive: true });
    for (const f of files) if (/\.txt$/i.test(f)) fs.copyFileSync(f, path.join(p.raw, path.basename(f)));
    // 4.0 lists add names and hierarchy for composite structures; fetch them if possible.
    try { await fetchLists(p.raw, { onProgress }); } catch (e) { onProgress({ phase: 'warn', message: 'Could not download the BodyParts3D lists (' + e.message + '); group names will be limited.' }); }
    const listDir = p.raw;
    const counts = await require('./bp3d43').build43({ rawDir: is43, listDir, outDir: p.build, onProgress, mirror });
    setActive(dataDir, 'bp3d43');
    return { ...status(dataDir), counts };
  }
  const p = atlasPaths(dataDir, 'bp3d40');
  fs.mkdirSync(p.raw, { recursive: true });
  const sources = [];
  const listDirs = [p.raw];
  for (const f of files) {
    const st = fs.statSync(f);
    if (st.isDirectory()) { sources.push(f); listDirs.push(f); continue; }
    if (/\.txt$/i.test(f)) { fs.copyFileSync(f, path.join(p.raw, path.basename(f))); continue; }
    if (/\.(zip|obj)$/i.test(f)) sources.push(f);
    listDirs.push(path.dirname(f));
  }
  for (const a of Object.values(MESH_ARCHIVES)) {
    const z = path.join(p.raw, a.file);
    if (fs.existsSync(z) && !sources.includes(z)) sources.push(z);
  }
  if (!sources.length) throw new Error('Select at least one .zip archive, .obj file or folder of meshes.');
  const counts = await buildDataset({ sources, listDirs, outDir: p.build, onProgress, mirror });
  setActive(dataDir, 'bp3d40');
  return { ...status(dataDir), counts };
}

function remove(dataDir, id) {
  if (id) fs.rmSync(atlasPaths(dataDir, id).root, { recursive: true, force: true });
  else fs.rmSync(dataDir, { recursive: true, force: true });
  return status(dataDir);
}

module.exports = {
  BASE_URL, MESH_ARCHIVES, VARIANTS, SOURCES,
  atlasPaths, listAtlases, activeId, setActive, status, resolveDataFile,
  download, prepare, rebuild, importLocal, remove,
  paths: (dataDir) => atlasPaths(dataDir, activeId(dataDir) || 'bp3d40'),
};
