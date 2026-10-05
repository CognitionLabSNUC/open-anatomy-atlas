'use strict';
// Minimal, dependency-free ZIP reader (stored + deflate, Zip64 aware).
// Enough to unpack the BodyParts3D mesh archives without native tools.

const fs = require('fs');
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function u64(buf, off) {
  return Number(buf.readBigUInt64LE(off));
}

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('Not a ZIP file (end of central directory not found)');
}

function listEntries(buf) {
  const eocd = findEOCD(buf);
  let total = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // Zip64
  if (cdOffset === 0xffffffff || total === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === SIG_Z64_LOCATOR) {
      const z64 = u64(buf, loc + 8);
      if (buf.readUInt32LE(z64) !== SIG_Z64_EOCD) throw new Error('Corrupt Zip64 record');
      total = u64(buf, z64 + 32);
      cdOffset = u64(buf, z64 + 48);
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== SIG_CEN) throw new Error('Corrupt central directory at entry ' + n);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800) ? nameBuf.toString('utf8') : nameBuf.toString('latin1');

    // Zip64 extended information extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(buf, q); q += 8; }
        if (compSize === 0xffffffff) { compSize = u64(buf, q); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = u64(buf, q); q += 8; }
      }
      e += 4 + len;
    }

    entries.push({ name, method, compSize, size, localOffset, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== SIG_LOC) throw new Error('Corrupt local header for ' + entry.name);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} in ${entry.name}`);
}

class ZipArchive {
  constructor(fileOrBuffer) {
    this.path = Buffer.isBuffer(fileOrBuffer) ? null : fileOrBuffer;
    this.buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
    this.entries = listEntries(this.buf);
  }
  files() { return this.entries.filter(e => !e.isDir); }
  read(entry) { return extractEntry(this.buf, entry); }
  close() { this.buf = null; }
}

module.exports = { ZipArchive, listEntries, extractEntry };
