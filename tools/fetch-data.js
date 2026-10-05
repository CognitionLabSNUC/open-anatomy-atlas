#!/usr/bin/env node
'use strict';
// Download and build anatomy atlases without launching the app.
//
//   node tools/fetch-data.js [--source bp3d40|bp3d43|zanatomy] [options]
//
//   --source bp3d40      BodyParts3D 4.0 bulk download (default; 99%-simplified)
//   --source bp3d43      BodyParts3D 4.3, full resolution, from the Anatomography server
//   --source zanatomy    Z-Anatomy (non-commercial; add --commercial-safe to leave out
//                        the inner ear and kidney models and get CC BY-SA 4.0)
//   --core               bp3d40 only: regional (part-of) meshes only, 62 MB
//   --no-mirror          do not add mirrored copies of one-sided muscles
//   --import <paths...>  build BodyParts3D from files you downloaded yourself
//                        (zips/.txt, or a 4.3 folder containing metadata/ and objs/)
//   --rebuild <source>   rebuild an installed atlas from its downloaded files
//   --use <source>       make an installed atlas the one the app shows
//   --list               show installed atlases
//   --dir <dataDir>      data folder (default: the app's folder, see below)
//
// Default data folder (shared with the app):
//   Linux:   ~/.config/open-anatomy-atlas/dataset
//   macOS:   ~/Library/Application Support/open-anatomy-atlas/dataset
//   Windows: %APPDATA%\open-anatomy-atlas\dataset

const path = require('path');
const pipeline = require('../src/data/pipeline');
const { defaultDataDir } = require('./fetch-data-paths');

async function main() {
  const args = process.argv.slice(2);
  let dataDir = defaultDataDir();
  let source = 'bp3d40', variant = 'full', commercialSafe = false, mirror, rebuild = null, use = null, list = false;
  const imports = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--core') variant = 'core';
    else if (a === '--source') source = args[++i];
    else if (a === '--commercial-safe') commercialSafe = true;
    else if (a === '--no-mirror') mirror = { categories: [] };
    else if (a === '--rebuild') rebuild = args[++i];
    else if (a === '--use') use = args[++i];
    else if (a === '--list') list = true;
    else if (a === '--dir') dataDir = path.resolve(args[++i]);
    else if (a === '--import') { while (args[i + 1] && !args[i + 1].startsWith('--')) imports.push(path.resolve(args[++i])); }
    else if (a === '-h' || a === '--help') { console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(2, 24).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
    else { console.error(`Unknown option: ${a} (try --help)`); process.exit(2); }
  }

  if (list || use) {
    if (use) pipeline.setActive(dataDir, use);
    const st = pipeline.status(dataDir);
    for (const a of st.atlases) {
      const mark = a.id === st.active ? '*' : ' ';
      console.log(`${mark} ${a.id.padEnd(9)} ${a.ready ? `${a.counts.elements} meshes, ${a.counts.concepts} structures${a.counts.mirrored ? `, ${a.counts.mirrored} mirrored` : ''}` : 'not installed'}   ${a.title}`);
    }
    console.log('\n* = shown by the app.  Data folder: ' + dataDir);
    return;
  }
  if (!pipeline.SOURCES[source]) { console.error(`Unknown source "${source}". Use bp3d40, bp3d43 or zanatomy.`); process.exit(2); }

  let lastLine = '';
  const onProgress = ev => {
    let line = ev.message || ev.phase;
    if (ev.total > 1 && ev.phase === 'download' && ev.loaded > 1000) line += ` ${(ev.loaded / 1048576).toFixed(1)} / ${(ev.total / 1048576).toFixed(1)} MB`;
    if (ev.phase === 'warn') { console.warn('\n' + line); return; }
    if (line !== lastLine && process.stdout.isTTY) process.stdout.write('\r\x1b[K' + line);
    else if (line !== lastLine) console.log(line);
    lastLine = line;
  };

  console.log(`Data folder: ${dataDir}`);
  let result;
  if (imports.length) result = await pipeline.importLocal({ dataDir, files: imports, onProgress, mirror });
  else if (rebuild) result = await pipeline.rebuild({ dataDir, source: rebuild, onProgress, commercialSafe, mirror });
  else {
    console.log(`Source: ${pipeline.SOURCES[source].title} (${pipeline.SOURCES[source].size})`);
    result = await pipeline.prepare({ dataDir, source, variant, onProgress, commercialSafe, mirror });
  }
  const c = result.counts;
  console.log(`\nDone: ${c.elements} meshes${c.mirrored ? ` (${c.mirrored} mirrored)` : ''}, ${c.concepts} named structures, ${c.triangles.toLocaleString()} triangles.`);
  console.log(`The app now shows: ${result.active}`);
}

main().catch(e => { console.error('\nError:', e.message); process.exit(1); });
