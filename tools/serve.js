#!/usr/bin/env node
'use strict';
// Run the atlas in any browser (no Electron needed):
//   node tools/serve.js [--port 8080] [--host 127.0.0.1] [--dir <dataDir>]
// Serves the UI at /, atlas files at /data/, and a small JSON API at /api/
// so the page can list installed atlases and switch between them.

const http = require('http');
const fs = require('fs');
const path = require('path');
const pipeline = require('../src/data/pipeline');
const { defaultDataDir } = require('./fetch-data-paths');

const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const port = Number(get('--port', process.env.PORT || 8080));
const host = get('--host', process.env.HOST || '127.0.0.1');
const dataDir = path.resolve(get('--dir', defaultDataDir()));
const uiDir = path.join(__dirname, '..', 'src', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
};

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname);
  try {
    if (rel === '/api/status') return sendJSON(res, 200, pipeline.status(dataDir));
    if (rel === '/api/active' && req.method === 'POST') return sendJSON(res, 200, pipeline.setActive(dataDir, url.searchParams.get('id')));
  } catch (e) { return sendJSON(res, 400, { error: e.message }); }

  let file;
  if (rel.startsWith('/data/')) file = pipeline.resolveDataFile(dataDir, rel.slice(6));
  else {
    const p = path.normalize(path.join(uiDir, rel === '/' ? 'index.html' : rel));
    file = p.startsWith(path.normalize(uiDir + path.sep)) ? p : null;
  }
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, host, () => {
  const st = pipeline.status(dataDir);
  console.log(`Open Anatomy Atlas: http://localhost:${port}${host !== '127.0.0.1' && host !== 'localhost' ? `  (listening on ${host})` : ''}`);
  const installed = st.atlases.filter(a => a.ready).map(a => a.id + (a.id === st.active ? ' (active)' : ''));
  console.log(installed.length ? `Atlases: ${installed.join(', ')}  in ${dataDir}` : `No atlas in ${dataDir} yet - run "npm run fetch-data" (showing the built-in demo model).`);
});
