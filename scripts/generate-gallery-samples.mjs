/**
 * Generate DRM-encoded WAV gallery samples.
 *
 * Uses the canvas package to draw test images, then runs the full DRM
 * encoding pipeline to produce WAV files that the DRM decoder can
 * successfully decode.
 *
 * Run with:  node scripts/generate-gallery-samples.mjs
 *   or:      bun scripts/generate-gallery-samples.mjs
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── DRM constants ─────────────────────────────────────────────────────────────

const SAMPLE_RATE = 12_000;
const FFT_SIZE = 256;
const GUARD_SAMPLES = 64;
const SYMBOL_SAMPLES = FFT_SIZE + GUARD_SAMPLES; // 320
const SYMBOLS_PER_FRAME = 15;
const FRAMES_PER_SUPERFRAME = 3;
const CARRIER_BIN_OFFSET = Math.round(1500 / (SAMPLE_RATE / FFT_SIZE)); // 32
const K_MIN = -10;
const K_MAX = 18;
const NUM_CARRIERS = K_MAX - K_MIN + 1; // 29
const TIME_PILOT_CARRIERS = [-9, -3, 4, 8, 12];
const FREQ_PILOT_CELLS = [[0,-9],[0,8],[5,-3],[5,12],[10,4],[14,-9],[14,8]];
const PILOT_BOOST = Math.sqrt(2);
const CONV_POLYNOMIALS = [0o133, 0o171, 0o145, 0o165, 0o117, 0o135];
const CONV_STATES = 64;
const PUNCTURE_MSC = [1, 1, 0, 1, 0, 0];
// const PUNCTURE_FAC = [1, 1, 0, 1, 1, 0]; // unused in encoder
const MSC_SEGMENT_BYTES = 800;
const MSC_SEGMENT_HEADER_BYTES = 4;
const FAC_CELLS = [[0, -7],[0, 6]];
const SDC_CELLS = [[0,-6],[0,-5],[0,-4],[0,7],[0,9],[0,10]];

// QAM16 constellation
const QAM16_SCALE = 1 / Math.sqrt(10);
const QAM16_CONSTELLATION = (() => {
  const pts = [];
  const vals = [-3, -1, 1, 3];
  const grayRow = [0, 1, 3, 2];
  const grayCol = [0, 1, 3, 2];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const sym = (grayRow[row] << 2) | grayCol[col];
      pts[sym] = [vals[col] * QAM16_SCALE, vals[row] * QAM16_SCALE];
    }
  }
  return pts;
})();

const QAM4_CONSTELLATION = [
  [+1, +1], [-1, +1], [-1, -1], [+1, -1]
].map(([i, q]) => [i / Math.SQRT2, q / Math.SQRT2]);

// ── CRC ───────────────────────────────────────────────────────────────────────

function crc8(data) {
  const POLY = 0xd5;
  let crc = 0xff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ POLY) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc ^ 0xff;
}

function crc16(data) {
  const POLY = 0x1021;
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

// ── Bit helpers ───────────────────────────────────────────────────────────────

function packBits(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return bytes;
}

function unpackBits(bytes) {
  const bits = [];
  for (let i = 0; i < bytes.length * 8; i++) {
    bits.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  }
  return bits;
}

// ── Convolutional encoder ─────────────────────────────────────────────────────

function popcount(x) {
  let n = x;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24) & 0xff;
}

function convEncode(bits, puncture) {
  const output = [];
  let state = 0;
  const K = 7;
  for (const bit of bits) {
    const fullState = (bit << (K - 1)) | state;
    state = ((state >> 1) | (bit << (K - 2))) & (CONV_STATES - 1);
    for (let i = 0; i < CONV_POLYNOMIALS.length; i++) {
      if (puncture[i % puncture.length]) {
        output.push(popcount(fullState & CONV_POLYNOMIALS[i]) & 1);
      }
    }
  }
  for (let t = 0; t < K - 1; t++) {
    const fullState = state;
    state = (state >> 1) & (CONV_STATES - 1);
    for (let i = 0; i < CONV_POLYNOMIALS.length; i++) {
      if (puncture[i % puncture.length]) {
        output.push(popcount(fullState & CONV_POLYNOMIALS[i]) & 1);
      }
    }
  }
  return output;
}

// ── FAC / SDC ─────────────────────────────────────────────────────────────────

function encodeFAC() {
  const bits = new Array(64).fill(0);
  bits[0] = 0; bits[1] = 1; // Mode B
  bits[2] = 0; bits[3] = 0; bits[4] = 0; // SO_0
  bits[5] = 0; // short interleaver
  bits[6] = 0; bits[7] = 1; bits[8] = 1; // 16-QAM
  bits[9] = 0; bits[10] = 0; bits[11] = 1; // 4-QAM SDC
  bits[12] = 0; bits[13] = 0; // 1 service
  bits[14] = 1; // data
  bits[27] = 1; // service ID = 1
  const bytes = packBits(bits);
  const crcVal = crc8(bytes);
  const crcBits = unpackBits(new Uint8Array([crcVal]));
  return [...bits, ...crcBits];
}

function encodeSDC(payloadBytes, mimeType = 'image/jpeg') {
  const mimeBytes = new TextEncoder().encode(mimeType.slice(0, 32));
  const sdc = new Uint8Array(3 + mimeBytes.length + 1);
  const cl = Math.min(payloadBytes, 0xffffff);
  sdc[0] = (cl >> 16) & 0xff;
  sdc[1] = (cl >> 8) & 0xff;
  sdc[2] = cl & 0xff;
  sdc.set(mimeBytes, 3);
  sdc[3 + mimeBytes.length] = 0;
  const crcVal = crc16(sdc);
  const result = new Uint8Array(sdc.length + 2);
  result.set(sdc);
  result[sdc.length] = (crcVal >> 8) & 0xff;
  result[sdc.length + 1] = crcVal & 0xff;
  return result;
}

// ── MSC segmentation ──────────────────────────────────────────────────────────

function segmentMSC(fileData) {
  const segments = [];
  const maxPayload = MSC_SEGMENT_BYTES - MSC_SEGMENT_HEADER_BYTES;
  const totalSegments = Math.max(1, Math.ceil(fileData.length / maxPayload));
  for (let i = 0; i < totalSegments; i++) {
    const start = i * maxPayload;
    const end = Math.min(start + maxPayload, fileData.length);
    const data = fileData.slice(start, end);
    const header = new Uint8Array(4);
    header[0] = (i >> 8) & 0xff; header[1] = i & 0xff;
    header[2] = (totalSegments >> 8) & 0xff; header[3] = totalSegments & 0xff;
    const combined = new Uint8Array(header.length + data.length);
    combined.set(header); combined.set(data, header.length);
    const crc = crc16(combined);
    segments.push({ segNo: i, totalSegments, isLast: i === totalSegments - 1, data, crc });
  }
  return segments;
}

function serialiseSegment(seg) {
  const buf = new Uint8Array(MSC_SEGMENT_HEADER_BYTES + seg.data.length + 2);
  buf[0] = (seg.segNo >> 8) & 0xff; buf[1] = seg.segNo & 0xff;
  buf[2] = (seg.totalSegments >> 8) & 0xff; buf[3] = seg.totalSegments & 0xff;
  buf.set(seg.data, MSC_SEGMENT_HEADER_BYTES);
  buf[buf.length - 2] = (seg.crc >> 8) & 0xff;
  buf[buf.length - 1] = seg.crc & 0xff;
  return buf;
}

// ── Interleaver ───────────────────────────────────────────────────────────────

function buildBijectiveFreqPermutation(n) {
  const bits = Math.ceil(Math.log2(Math.max(n, 2)));
  const perm = [];
  const used = new Array(n).fill(false);
  for (let i = 0; perm.length < n; i++) {
    let rev = 0, x = i;
    for (let b = 0; b < bits; b++) { rev = (rev << 1) | (x & 1); x >>= 1; }
    if (rev < n && !used[rev]) { perm.push(rev); used[rev] = true; }
  }
  return perm;
}

const FREQ_PERM_16 = buildBijectiveFreqPermutation(16);
const FREQ_PERM_24 = buildBijectiveFreqPermutation(24);
const FREQ_GROUP_SIZES = [16, ...new Array(14).fill(24)];

function freqInterleave(cells) {
  const out = cells.map(c => [c[0], c[1]]);
  let offset = 0;
  for (let sym = 0; sym < FREQ_GROUP_SIZES.length; sym++) {
    const groupSize = FREQ_GROUP_SIZES[sym];
    const perm = sym === 0 ? FREQ_PERM_16 : FREQ_PERM_24;
    const group = cells.slice(offset, offset + groupSize);
    for (let i = 0; i < groupSize; i++) out[offset + perm[i]] = group[i];
    offset += groupSize;
  }
  return out;
}

function timeInterleave(cells, cols = 30) {
  const n = cells.length;
  const rows = Math.ceil(n / cols);
  const out = Array.from({ length: n }, () => [0, 0]);
  let idx = 0;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const src = row * cols + col;
      if (src < n) out[idx++] = cells[src];
    }
  }
  while (idx < n) out[idx++] = [0, 0];
  return out;
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function bitReverseFFT(re, im, n) {
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let rev = 0, x = i;
    for (let b = 0; b < bits; b++) { rev = (rev << 1) | (x & 1); x >>= 1; }
    if (rev > i) {
      [re[i], re[rev]] = [re[rev], re[i]];
      [im[i], im[rev]] = [im[rev], im[i]];
    }
  }
}

function fft(re, im, n, inverse) {
  bitReverseFFT(re, im, n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let twRe = 1, twIm = 0;
      for (let j = 0; j < half; j++) {
        const u = i + j, v = u + half;
        const tRe = twRe * re[v] - twIm * im[v];
        const tIm = twRe * im[v] + twIm * re[v];
        re[v] = re[u] - tRe; im[v] = im[u] - tIm;
        re[u] += tRe; im[u] += tIm;
        const next = twRe * wRe - twIm * wIm;
        twIm = twRe * wIm + twIm * wRe;
        twRe = next;
      }
    }
  }
  if (inverse) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
}

// ── QAM mapping ───────────────────────────────────────────────────────────────

function map16QAM(bits) {
  const sym = (bits[0] << 3) | (bits[1] << 2) | (bits[2] << 1) | bits[3];
  return QAM16_CONSTELLATION[sym % QAM16_CONSTELLATION.length];
}

function map4QAM(bits) {
  const sym = (bits[0] << 1) | bits[1];
  return QAM4_CONSTELLATION[sym % QAM4_CONSTELLATION.length];
}

// ── OFDM modulator ────────────────────────────────────────────────────────────

function ofdmModulate(dataCells) {
  const output = new Float32Array(SYMBOLS_PER_FRAME * SYMBOL_SAMPLES);
  const cellMaps = Array.from({ length: SYMBOLS_PER_FRAME }, () => new Map());
  for (const cell of dataCells) {
    if (cell.symbolIdx >= 0 && cell.symbolIdx < SYMBOLS_PER_FRAME) {
      cellMaps[cell.symbolIdx].set(cell.carrierIdx, { re: cell.re, im: cell.im });
    }
  }
  for (let symIdx = 0; symIdx < SYMBOLS_PER_FRAME; symIdx++) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    const cells = cellMaps[symIdx];
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      const bin = (CARRIER_BIN_OFFSET + k + FFT_SIZE) % FFT_SIZE;
      const isTimePilot = TIME_PILOT_CARRIERS.includes(k);
      const isFreqPilot = FREQ_PILOT_CELLS.some(([s, kk]) => s === symIdx && kk === k);
      if (isTimePilot || isFreqPilot) {
        re[bin] = PILOT_BOOST; im[bin] = 0;
      } else {
        const cell = cells.get(ki);
        re[bin] = cell?.re ?? 0; im[bin] = cell?.im ?? 0;
      }
    }
    fft(re, im, FFT_SIZE, true);
    const symStart = symIdx * SYMBOL_SAMPLES;
    for (let i = 0; i < GUARD_SAMPLES; i++) {
      output[symStart + i] = re[FFT_SIZE - GUARD_SAMPLES + i];
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      output[symStart + GUARD_SAMPLES + i] = re[i];
    }
  }
  const peak = output.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak > 1e-9) { const s = 0.9 / peak; for (let i = 0; i < output.length; i++) output[i] *= s; }
  return output;
}

// ── WAV writer ────────────────────────────────────────────────────────────────

function writeWAV(samples, sampleRate) {
  const numSamples = samples.length;
  const byteRate = sampleRate * 2;
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// ── MSC slot calculator ───────────────────────────────────────────────────────

function getMSCSlots() {
  const facSet = new Set(FAC_CELLS.map(([sym, k]) => `${sym},${k}`));
  const sdcSet = new Set(SDC_CELLS.map(([sym, k]) => `${sym},${k}`));
  const slots = [];
  for (let sym = 0; sym < SYMBOLS_PER_FRAME; sym++) {
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      if (TIME_PILOT_CARRIERS.includes(k)) continue;
      if (facSet.has(`${sym},${k}`)) continue;
      if (sdcSet.has(`${sym},${k}`)) continue;
      slots.push({ sym, ki });
    }
  }
  return slots;
}

const MSC_SLOTS = getMSCSlots();
const MSC_BITS_PER_FRAME = MSC_SLOTS.length * 4;

// ── Top-level encoder ─────────────────────────────────────────────────────────

function encodeJpegToDrmWav(jpegBytes) {
  console.log(`  JPEG size: ${jpegBytes.length} bytes`);

  const segments = segmentMSC(jpegBytes);
  console.log(`  Segments: ${segments.length}`);

  const payloadParts = segments.map(serialiseSegment);
  const totalLen = payloadParts.reduce((a, b) => a + b.length, 0);
  const payload = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of payloadParts) { payload.set(part, offset); offset += part.length; }

  const payloadBits = unpackBits(payload);
  const encodedMSC = convEncode(payloadBits, PUNCTURE_MSC);
  console.log(`  Encoded MSC bits: ${encodedMSC.length}`);

  const bitsPerSuperframe = MSC_BITS_PER_FRAME * FRAMES_PER_SUPERFRAME;
  const numSuperframes = Math.ceil(encodedMSC.length / bitsPerSuperframe);
  console.log(`  Superframes needed: ${numSuperframes}`);

  const totalBitsNeeded = numSuperframes * bitsPerSuperframe;
  const paddedMSC = [...encodedMSC, ...new Array(totalBitsNeeded - encodedMSC.length).fill(0)];

  const facBits = encodeFAC();
  const sdcBytes = encodeSDC(jpegBytes.length);
  const sdcBits = unpackBits(sdcBytes);

  const allFrames = [];

  for (let sf = 0; sf < numSuperframes; sf++) {
    for (let f = 0; f < FRAMES_PER_SUPERFRAME; f++) {
      const frameNo = sf * FRAMES_PER_SUPERFRAME + f;
      const mscFrameBits = paddedMSC.slice(frameNo * MSC_BITS_PER_FRAME, (frameNo + 1) * MSC_BITS_PER_FRAME);

      const mscCells = [];
      for (let i = 0; i < MSC_SLOTS.length; i++) {
        const bits4 = mscFrameBits.slice(i * 4, i * 4 + 4);
        mscCells.push(map16QAM(bits4.length === 4 ? bits4 : [0, 0, 0, 0]));
      }

      const interleavedCells = timeInterleave(freqInterleave(mscCells));
      const dataCells = [];

      for (let ci = 0; ci < MSC_SLOTS.length && ci < interleavedCells.length; ci++) {
        const { sym, ki } = MSC_SLOTS[ci];
        const [re, im] = interleavedCells[ci];
        dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
      }

      const facBitsPerFrame = FAC_CELLS.length * 2;
      const facBitOffset = (frameNo * facBitsPerFrame) % facBits.length;
      for (let fi = 0; fi < FAC_CELLS.length; fi++) {
        const [sym, k] = FAC_CELLS[fi];
        const ki = k - K_MIN;
        const bits2 = facBits.slice(facBitOffset + fi * 2, facBitOffset + fi * 2 + 2);
        const [re, im] = map4QAM(bits2.length === 2 ? bits2 : [0, 0]);
        dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
      }

      const sdcBitsPerFrame = SDC_CELLS.length * 2;
      const sdcBitOffset = (frameNo * sdcBitsPerFrame) % sdcBits.length;
      for (let si = 0; si < SDC_CELLS.length; si++) {
        const [sym, k] = SDC_CELLS[si];
        const ki = k - K_MIN;
        const bits2 = sdcBits.slice(sdcBitOffset + si * 2, sdcBitOffset + si * 2 + 2);
        const [re, im] = map4QAM(bits2.length === 2 ? bits2 : [0, 0]);
        dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
      }

      allFrames.push(ofdmModulate(dataCells));
    }
  }

  const totalSamples = allFrames.reduce((a, b) => a + b.length, 0);
  const combined = new Float32Array(totalSamples);
  let pos = 0;
  for (const frame of allFrames) { combined.set(frame, pos); pos += frame.length; }

  const durationS = totalSamples / SAMPLE_RATE;
  console.log(`  WAV duration: ${durationS.toFixed(2)}s (${totalSamples} samples at ${SAMPLE_RATE} Hz)`);
  return writeWAV(combined, SAMPLE_RATE);
}

// ── Image generators ──────────────────────────────────────────────────────────

function generateSample1(width = 160, height = 120) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#1a237e');
  grad.addColorStop(0.5, '#4a148c');
  grad.addColorStop(1, '#880e4f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Title text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EasyPal DRM', width / 2, 22);

  ctx.font = '10px sans-serif';
  ctx.fillText('Sample 1', width / 2, 38);

  // Horizontal rule
  ctx.strokeStyle = '#80cbc4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, 46); ctx.lineTo(width - 10, 46);
  ctx.stroke();

  // Info text
  ctx.fillStyle = '#b2ebf2';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  const lines = ['Mode B · SO_0', '16-QAM · FEC 1/2', 'fs = 12 kHz'];
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 8, 60 + i * 13);

  // Colour bars at bottom
  const barW = Math.floor(width / 7);
  const colors = ['#f44336','#ff9800','#ffeb3b','#4caf50','#2196f3','#9c27b0','#ffffff'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * barW, height - 22, barW, 22);
  });

  return canvas.toBuffer('image/jpeg', { quality: 0.6 });
}

function generateSample2(width = 160, height = 120) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#060c06';
  ctx.fillRect(0, 0, width, height);

  // Grid lines (sparse to keep filesize small)
  ctx.strokeStyle = '#1b5e20';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < width; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 16) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  // Spectrum envelope (deterministic - no random)
  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const freq = (x / width) * 3000;
    let amp = 0;
    if (freq > 1000 && freq < 2400) {
      amp = 0.4 + 0.25 * Math.sin((freq - 1500) * 0.05);
    }
    const y = height * 0.55 - amp * height * 0.35;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#69f0ae';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SPECTRUM', width / 2, 16);

  // Bottom bar
  ctx.fillStyle = '#1b5e20';
  ctx.fillRect(0, height - 22, width, 22);
  ctx.fillStyle = '#c8e6c9';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EasyPal DRM · Sample 2', width / 2, height - 8);

  return canvas.toBuffer('image/jpeg', { quality: 0.55 });
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Generating DRM gallery samples...\n');

const samples = [
  {
    name: 'Digital SSTV Sample 1',
    jpegFn: generateSample1,
    wavPath: resolve(ROOT, 'public/examples/DSSTV1.wav'),
    pngPath: resolve(ROOT, 'public/gallery/dsstv1.png'),
  },
  {
    name: 'Digital SSTV Sample 2',
    jpegFn: generateSample2,
    wavPath: resolve(ROOT, 'public/examples/DSSTV2.wav'),
    pngPath: resolve(ROOT, 'public/gallery/dsstv2.png'),
  },
];

for (const sample of samples) {
  console.log(`\nGenerating: ${sample.name}`);

  const jpegBytes = sample.jpegFn();
  console.log(`  Generated JPEG: ${jpegBytes.length} bytes`);

  // Save image thumbnail (JPEG bytes, named .png for gallery compatibility)
  writeFileSync(sample.pngPath, jpegBytes);
  console.log(`  Saved: ${sample.pngPath}`);

  const wavBuffer = encodeJpegToDrmWav(jpegBytes);
  writeFileSync(sample.wavPath, wavBuffer);
  console.log(`  Saved: ${sample.wavPath}`);
}

console.log('\nDone! Gallery samples generated successfully.');
console.log('Run the app and click "Try decoding" to verify decode succeeds.');
