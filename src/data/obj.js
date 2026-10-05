'use strict';
// Fast, tolerant Wavefront OBJ parser (positions + faces only; normals are
// recomputed so meshes with missing/inconsistent normals still shade well).

class GrowF32 {
  constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}
class GrowU32 {
  constructor(n = 8192) { this.a = new Uint32Array(n); this.n = 0; }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
  done() { return this.a.slice(0, this.n); }
}

function parseOBJ(text) {
  const pos = new GrowF32();
  const idx = new GrowU32();
  let vcount = 0;
  const face = [];
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const c0 = text.charCodeAt(start);
    const c1 = text.charCodeAt(start + 1);
    if (c0 === 118 /* v */ && (c1 === 32 || c1 === 9)) {
      const parts = text.slice(start + 2, end).trim().split(/\s+/);
      pos.push3(+parts[0], +parts[1], +parts[2]);
      vcount++;
    } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9)) {
      const toks = text.slice(start + 2, end).trim().split(/\s+/);
      face.length = 0;
      for (const t of toks) {
        const s = t.indexOf('/');
        let v = parseInt(s === -1 ? t : t.slice(0, s), 10);
        if (Number.isNaN(v)) continue;
        v = v < 0 ? vcount + v : v - 1;
        if (v >= 0 && v < vcount) face.push(v);
      }
      for (let k = 1; k + 1 < face.length; k++) idx.push3(face[0], face[k], face[k + 1]);
    }
    start = end + 1;
  }
  return { positions: pos.done(), indices: idx.done() };
}

function computeNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

module.exports = { parseOBJ, computeNormals };
