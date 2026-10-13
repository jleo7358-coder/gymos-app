// LZFSE decoder (port of Apple's open-source reference implementation, BSD-3-Clause,
// Copyright (c) 2015-2016 Apple Inc.). Used to read .gymbackup files written by the
// native GymOS iPhone app. Also writes "uncompressed" LZFSE streams so backups made
// here can be opened by the native app too.

const MAGIC_END = 0x24787662;   // bvx$
const MAGIC_RAW = 0x2d787662;   // bvx-
const MAGIC_V1 = 0x31787662;    // bvx1
const MAGIC_V2 = 0x32787662;    // bvx2
const MAGIC_LZVN = 0x6e787662;  // bvxn

const L_SYMBOLS = 20, M_SYMBOLS = 20, D_SYMBOLS = 64, LIT_SYMBOLS = 256;
const L_STATES = 64, M_STATES = 64, D_STATES = 256, LIT_STATES = 1024;
const MATCHES_PER_BLOCK = 10000;
const LITERALS_PER_BLOCK = 4 * MATCHES_PER_BLOCK;

const L_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 5, 8];
const L_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 28, 60];
const M_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 8, 11];
const M_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 24, 56, 312];
const D_EXTRA = [
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
  4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7,
  8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11,
  12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15];
const D_BASE = [
  0, 1, 2, 3, 4, 6, 8, 10, 12, 16,
  20, 24, 28, 36, 44, 52, 60, 76, 92, 108,
  124, 156, 188, 220, 252, 316, 380, 444, 508, 636,
  764, 892, 1020, 1276, 1532, 1788, 2044, 2556, 3068, 3580,
  4092, 5116, 6140, 7164, 8188, 10236, 12284, 14332, 16380, 20476,
  24572, 28668, 32764, 40956, 49148, 57340, 65532, 81916, 98300, 114684,
  131068, 163836, 196604, 229372];

const FREQ_NBITS = [2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14, 2, 3, 2, 5, 2, 3, 2, 8, 2, 3, 2, 5, 2, 3, 2, 14];
const FREQ_VALUE = [0, 2, 1, 4, 0, 3, 1, -1, 0, 2, 1, 5, 0, 3, 1, -1, 0, 2, 1, 6, 0, 3, 1, -1, 0, 2, 1, 7, 0, 3, 1, -1];

class LzfseError extends Error {}
const fail = (msg) => { throw new LzfseError('LZFSE: ' + msg); };

const mask = (n) => (n <= 0 ? 0 : n >= 32 ? 0xffffffff : (0xffffffff >>> (32 - n)));
const clz32 = Math.clz32;

function byteAt(buf, i) { return i >= 0 && i < buf.length ? buf[i] : 0; }
function u16(buf, i) { return byteAt(buf, i) | (byteAt(buf, i + 1) << 8); }
function u32(buf, i) {
  return (byteAt(buf, i) | (byteAt(buf, i + 1) << 8) | (byteAt(buf, i + 2) << 16) | (byteAt(buf, i + 3) << 24)) >>> 0;
}
function i32(buf, i) { return u32(buf, i) | 0; }

// 32-bit FSE input stream, read backwards.
class InStream {
  constructor(buf) { this.buf = buf; this.accum = 0; this.nbits = 0; this.pos = 0; }
  init(n, pos, start) {
    if (n) {
      if (pos < start + 4) fail('stream init out of range');
      pos -= 4;
      this.accum = u32(this.buf, pos);
      this.nbits = n + 32;
    } else {
      if (pos < start + 3) fail('stream init out of range');
      pos -= 3;
      this.accum = (u32(this.buf, pos) & 0xffffff) >>> 0;
      this.nbits = 24;
    }
    if (this.nbits < 24 || this.nbits >= 32 || (this.accum >>> this.nbits) !== 0) fail('bad stream init');
    this.pos = pos;
  }
  flush(start) {
    const add = (31 - this.nbits) & -8;
    if (add > 0) {
      const p = this.pos - (add >> 3);
      if (p < start) fail('stream flush out of range');
      this.pos = p;
      const incoming = u32(this.buf, p);
      this.accum = (((this.accum << add) >>> 0) | (incoming & mask(add))) >>> 0;
      this.nbits += add;
    }
  }
  pull(n) {
    this.nbits -= n;
    if (this.nbits < 0) fail('stream underflow');
    const result = this.accum >>> this.nbits;
    this.accum = (this.accum & mask(this.nbits)) >>> 0;
    return result;
  }
}

function initDecoderTable(nstates, nsymbols, freq) {
  const k = new Int8Array(nstates), sym = new Uint8Array(nstates), delta = new Int32Array(nstates);
  const nclz = clz32(nstates);
  let sum = 0, t = 0;
  for (let i = 0; i < nsymbols; i++) {
    const f = freq[i];
    if (f === 0) continue;
    sum += f;
    if (sum > nstates) fail('bad frequency table');
    const kk = clz32(f) - nclz;
    const j0 = ((2 * nstates) >> kk) - f;
    for (let j = 0; j < f; j++, t++) {
      sym[t] = i;
      if (j < j0) { k[t] = kk; delta[t] = ((f + j) << kk) - nstates; }
      else { k[t] = kk - 1; delta[t] = (j - j0) << (kk - 1); }
    }
  }
  return { k, sym, delta };
}

function initValueDecoderTable(nstates, nsymbols, freq, vbitsTable, vbaseTable) {
  const total = new Uint8Array(nstates), vbits = new Uint8Array(nstates), delta = new Int32Array(nstates), vbase = new Int32Array(nstates);
  const nclz = clz32(nstates);
  let t = 0;
  for (let i = 0; i < nsymbols; i++) {
    const f = freq[i];
    if (f === 0) continue;
    const kk = clz32(f) - nclz;
    const j0 = ((2 * nstates) >> kk) - f;
    for (let j = 0; j < f; j++, t++) {
      if (t >= nstates) fail('bad value table');
      vbits[t] = vbitsTable[i];
      vbase[t] = vbaseTable[i];
      if (j < j0) { total[t] = kk + vbitsTable[i]; delta[t] = ((f + j) << kk) - nstates; }
      else { total[t] = kk - 1 + vbitsTable[i]; delta[t] = (j - j0) << (kk - 1); }
    }
  }
  return { total, vbits, delta, vbase };
}

function decodeSymbol(stateObj, table, input) {
  const s = stateObj.v;
  const sym = table.sym[s];
  stateObj.v = (table.delta[s] + input.pull(table.k[s])) & 0xffff;
  return sym;
}

function decodeValue(stateObj, table, input) {
  const s = stateObj.v;
  const bits = input.pull(table.total[s]);
  const vb = table.vbits[s];
  stateObj.v = (table.delta[s] + (bits >>> vb)) & 0xffff;
  return table.vbase[s] + (bits & mask(vb));
}

function sumFreq(arr) { let s = 0; for (const v of arr) s += v; return s; }

function readHeaderV2(src, p) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (p + 32 > src.length) fail('truncated v2 header');
  const v0 = dv.getBigUint64(p + 8, true), v1 = dv.getBigUint64(p + 16, true), v2 = dv.getBigUint64(p + 24, true);
  const f = (v, off, n) => Number((v >> BigInt(off)) & ((1n << BigInt(n)) - 1n));
  const h = {
    nRaw: u32(src, p + 4),
    nLiterals: f(v0, 0, 20),
    nLiteralPayload: f(v0, 20, 20),
    nMatches: f(v0, 40, 20),
    literalBits: f(v0, 60, 3) - 7,
    literalState: [f(v1, 0, 10), f(v1, 10, 10), f(v1, 20, 10), f(v1, 30, 10)],
    nLmdPayload: f(v1, 40, 20),
    lmdBits: f(v1, 60, 3) - 7,
    headerSize: f(v2, 0, 32),
    lState: f(v2, 32, 10), mState: f(v2, 42, 10), dState: f(v2, 52, 10),
  };
  const total = L_SYMBOLS + M_SYMBOLS + D_SYMBOLS + LIT_SYMBOLS;
  const freq = new Uint16Array(total);
  let q = p + 32;
  const end = p + h.headerSize;
  if (end > src.length) fail('truncated v2 header');
  if (q !== end) {
    let accum = 0, accumBits = 0;
    for (let i = 0; i < total; i++) {
      while (q < end && accumBits + 8 <= 32) { accum = (accum | (src[q] << accumBits)) >>> 0; accumBits += 8; q++; }
      const b = accum & 31;
      const n = FREQ_NBITS[b];
      let value;
      if (n === 8) value = 8 + ((accum >>> 4) & 0xf);
      else if (n === 14) value = 24 + ((accum >>> 4) & 0x3ff);
      else value = FREQ_VALUE[b];
      if (n > accumBits) fail('bad frequency header');
      freq[i] = value;
      accum = accum >>> n;
      accumBits -= n;
    }
    if (accumBits >= 8 || q !== end) fail('bad frequency header end');
  }
  h.lFreq = freq.subarray(0, 20);
  h.mFreq = freq.subarray(20, 40);
  h.dFreq = freq.subarray(40, 104);
  h.litFreq = freq.subarray(104, 360);
  return h;
}

function readHeaderV1(src, p) {
  const size = 772;
  if (p + size > src.length) fail('truncated v1 header');
  const h = {
    nRaw: u32(src, p + 4),
    nLiterals: u32(src, p + 12),
    nMatches: u32(src, p + 16),
    nLiteralPayload: u32(src, p + 20),
    nLmdPayload: u32(src, p + 24),
    literalBits: i32(src, p + 28),
    literalState: [u16(src, p + 32), u16(src, p + 34), u16(src, p + 36), u16(src, p + 38)],
    lmdBits: i32(src, p + 40),
    lState: u16(src, p + 44), mState: u16(src, p + 46), dState: u16(src, p + 48),
    headerSize: size,
  };
  const freq = new Uint16Array(360);
  for (let i = 0; i < 360; i++) freq[i] = u16(src, p + 50 + 2 * i);
  h.lFreq = freq.subarray(0, 20);
  h.mFreq = freq.subarray(20, 40);
  h.dFreq = freq.subarray(40, 104);
  h.litFreq = freq.subarray(104, 360);
  return h;
}

function checkHeader(h) {
  if (h.nLiterals > LITERALS_PER_BLOCK || h.nMatches > MATCHES_PER_BLOCK) fail('block too large');
  if (h.literalState.some((s) => s >= LIT_STATES)) fail('bad literal state');
  if (h.lState >= L_STATES || h.mState >= M_STATES || h.dState >= D_STATES) fail('bad lmd state');
  if (sumFreq(h.lFreq) > L_STATES || sumFreq(h.mFreq) > M_STATES || sumFreq(h.dFreq) > D_STATES || sumFreq(h.litFreq) > LIT_STATES) fail('bad frequencies');
}

// Returns new src position.
function decodeCompressedBlock(src, p, h, out) {
  checkHeader(h);
  p += h.headerSize;
  if (p + h.nLiteralPayload + h.nLmdPayload > src.length) fail('truncated block');

  const litTable = initDecoderTable(LIT_STATES, LIT_SYMBOLS, h.litFreq);
  const lTable = initValueDecoderTable(L_STATES, L_SYMBOLS, h.lFreq, L_EXTRA, L_BASE);
  const mTable = initValueDecoderTable(M_STATES, M_SYMBOLS, h.mFreq, M_EXTRA, M_BASE);
  const dTable = initValueDecoderTable(D_STATES, D_SYMBOLS, h.dFreq, D_EXTRA, D_BASE);

  // Literals
  const literals = new Uint8Array(LITERALS_PER_BLOCK + 64);
  {
    const input = new InStream(src);
    p += h.nLiteralPayload;
    input.init(h.literalBits, p, 0);
    const s0 = { v: h.literalState[0] }, s1 = { v: h.literalState[1] }, s2 = { v: h.literalState[2] }, s3 = { v: h.literalState[3] };
    for (let i = 0; i < h.nLiterals; i += 4) {
      input.flush(0);
      literals[i] = decodeSymbol(s0, litTable, input);
      literals[i + 1] = decodeSymbol(s1, litTable, input);
      input.flush(0);
      literals[i + 2] = decodeSymbol(s2, litTable, input);
      literals[i + 3] = decodeSymbol(s3, litTable, input);
    }
  }

  // L, M, D
  const lmdStart = p;
  const input = new InStream(src);
  input.init(h.lmdBits, p + h.nLmdPayload, lmdStart);
  const ls = { v: h.lState }, ms = { v: h.mState }, ds = { v: h.dState };
  let D = -1, lit = 0;
  out.ensure(h.nRaw);
  const blockEnd = out.len + h.nRaw;
  for (let n = h.nMatches; n > 0; n--) {
    input.flush(lmdStart);
    const L = decodeValue(ls, lTable, input);
    if (lit + L >= LITERALS_PER_BLOCK + 64) fail('literal overflow');
    input.flush(lmdStart);
    const M = decodeValue(ms, mTable, input);
    input.flush(lmdStart);
    const newD = decodeValue(ds, dTable, input);
    D = newD ? newD : D;
    if (D < 0 || D > out.len + L) fail('bad match distance');
    if (out.len + L + M > blockEnd) fail('block overflow');
    const buf = out.buf;
    let d = out.len;
    for (let i = 0; i < L; i++) buf[d++] = literals[lit++];
    for (let i = 0; i < M; i++, d++) buf[d] = buf[d - D];
    out.len = d;
  }
  return lmdStart + h.nLmdPayload;
}

const LZVN_KIND = (() => {
  // 0 sml_d, 1 med_d, 2 lrg_d, 3 pre_d, 4 sml_m, 5 lrg_m, 6 sml_l, 7 lrg_l, 8 nop, 9 eos, 10 udef
  const t = new Uint8Array(256).fill(10);
  for (let op = 0; op < 256; op++) {
    const low3 = op & 7;
    if (op >= 0xa0 && op <= 0xbf) t[op] = 1;
    else if (op === 0xe0) t[op] = 7;
    else if (op > 0xe0 && op <= 0xef) t[op] = 6;
    else if (op === 0xf0) t[op] = 5;
    else if (op > 0xf0) t[op] = 4;
    else if ((op >= 0x70 && op <= 0x7f) || (op >= 0xd0 && op <= 0xdf)) t[op] = 10;
    else if (op === 6) t[op] = 9;
    else if (op === 14 || op === 22) t[op] = 8;
    else if (op < 0x40 && low3 === 6) t[op] = 10; // 30,38,46,54,62 undefined (14/22 handled)
    else if (low3 === 7) t[op] = 2;
    else if (low3 === 6) t[op] = 3;
    else t[op] = 0;
  }
  return t;
})();

function decodeLzvnBlock(src, p, nPayload, nRaw, out) {
  out.ensure(nRaw);
  const end = p + nPayload;
  const buf = out.buf;
  const blockStart = out.len;
  const dstEnd = out.len + nRaw;
  let d = out.len;
  let D = 0;
  const copyLiteral = (L) => {
    if (p + L > end || d + L > dstEnd) fail('lzvn literal overflow');
    for (let i = 0; i < L; i++) buf[d++] = src[p++];
  };
  const copyMatch = (M) => {
    if (D === 0 || D > d) fail('lzvn bad distance');
    if (d + M > dstEnd) fail('lzvn match overflow');
    for (let i = 0; i < M; i++, d++) buf[d] = buf[d - D];
  };
  while (p < end) {
    const op = src[p];
    switch (LZVN_KIND[op]) {
      case 0: { // sml_d
        const L = (op >> 6) & 3, M = ((op >> 3) & 7) + 3;
        D = ((op & 7) << 8) | src[p + 1];
        p += 2; copyLiteral(L); copyMatch(M); break;
      }
      case 1: { // med_d
        const L = (op >> 3) & 3;
        const op23 = src[p + 1] | (src[p + 2] << 8);
        const M = (((op & 7) << 2) | (op23 & 3)) + 3;
        D = (op23 >> 2) & 0x3fff;
        p += 3; copyLiteral(L); copyMatch(M); break;
      }
      case 2: { // lrg_d
        const L = (op >> 6) & 3, M = ((op >> 3) & 7) + 3;
        D = src[p + 1] | (src[p + 2] << 8);
        p += 3; copyLiteral(L); copyMatch(M); break;
      }
      case 3: { // pre_d
        const L = (op >> 6) & 3, M = ((op >> 3) & 7) + 3;
        p += 1; copyLiteral(L); copyMatch(M); break;
      }
      case 4: { p += 1; copyMatch(op & 0xf); break; }          // sml_m
      case 5: { const M = src[p + 1] + 16; p += 2; copyMatch(M); break; } // lrg_m
      case 6: { p += 1; copyLiteral(op & 0xf); break; }        // sml_l
      case 7: { const L = src[p + 1] + 16; p += 2; copyLiteral(L); break; } // lrg_l
      case 8: { p += 1; break; }                               // nop
      case 9: { // eos
        p += 8;
        if (d !== dstEnd) fail('lzvn size mismatch');
        out.len = d;
        return end;
      }
      default: fail('lzvn undefined opcode');
    }
  }
  if (d - blockStart !== nRaw) fail('lzvn truncated');
  out.len = d;
  return end;
}

class Output {
  constructor(initial) { this.buf = new Uint8Array(Math.max(1024, initial)); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
}

/** Decode a complete LZFSE stream. */
export function lzfseDecode(src) {
  if (!(src instanceof Uint8Array)) src = new Uint8Array(src);
  const out = new Output(src.length * 4);
  let p = 0;
  for (;;) {
    if (p + 4 > src.length) fail('truncated stream');
    const magic = u32(src, p);
    if (magic === MAGIC_END) return out.buf.slice(0, out.len);
    if (magic === MAGIC_RAW) {
      const n = u32(src, p + 4);
      p += 8;
      if (p + n > src.length) fail('truncated raw block');
      out.ensure(n);
      out.buf.set(src.subarray(p, p + n), out.len);
      out.len += n;
      p += n;
    } else if (magic === MAGIC_LZVN) {
      const nRaw = u32(src, p + 4), nPayload = u32(src, p + 8);
      p += 12;
      if (p + nPayload > src.length) fail('truncated lzvn block');
      p = decodeLzvnBlock(src, p, nPayload, nRaw, out);
    } else if (magic === MAGIC_V2) {
      p = decodeCompressedBlock(src, p, readHeaderV2(src, p), out);
    } else if (magic === MAGIC_V1) {
      p = decodeCompressedBlock(src, p, readHeaderV1(src, p), out);
    } else {
      fail('invalid block magic');
    }
  }
}

/** Wrap raw bytes in a valid LZFSE stream using uncompressed blocks. */
export function lzfseStore(raw) {
  if (!(raw instanceof Uint8Array)) raw = new Uint8Array(raw);
  const out = new Uint8Array(raw.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC_RAW, true);
  dv.setUint32(4, raw.length, true);
  out.set(raw, 8);
  dv.setUint32(8 + raw.length, MAGIC_END, true);
  return out;
}
