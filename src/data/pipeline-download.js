'use strict';
// Streaming, resumable-by-file download with progress.

const fs = require('fs');

async function download(url, dest, { fetchImpl = globalThis.fetch, onProgress = () => {}, label } = {}) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    onProgress({ phase: 'download', file: label, loaded: 1, total: 1, message: `${label}: already downloaded` });
    return dest;
  }
  if (!fetchImpl) throw new Error('No fetch implementation available (Node 18+ required).');
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  // With gzip/br transfer encoding, Content-Length is the compressed size while
  // fetch hands us decompressed bytes, so it can't be used as the expected size.
  const encoded = /gzip|br|deflate|zstd/i.test(res.headers.get('content-encoding') || '');
  const total = encoded ? 0 : Number(res.headers.get('content-length')) || 0;
  const part = dest + '.part';
  const out = fs.createWriteStream(part);
  let loaded = 0, lastEmit = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      const now = Date.now();
      if (now - lastEmit > 200) {
        lastEmit = now;
        onProgress({ phase: 'download', file: label, loaded, total, message: `Downloading ${label}` });
      }
    }
  } catch (e) {
    out.destroy();
    throw new Error(`Download interrupted for ${label}: ${e.message}`);
  }
  await new Promise((res2, rej) => out.end(err => (err ? rej(err) : res2())));
  if (total && loaded < total) throw new Error(`Incomplete download for ${label} (${loaded} of ${total} bytes)`);
  fs.renameSync(part, dest);
  onProgress({ phase: 'download', file: label, loaded, total: total || loaded, message: `${label} downloaded` });
  return dest;
}

module.exports = { download };
