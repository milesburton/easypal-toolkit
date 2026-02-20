/**
 * Verify that the generated DRM WAV files can be decoded successfully.
 * Runs the full decode pipeline in Node.js (mirrors drmDecoder.ts logic).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── DRM constants (identical to drmConstants.ts) ──────────────────────────────

const SAMPLE_RATE = 12_000;
const FFT_SIZE = 256;
const GUARD_SAMPLES = 64;
const SYMBOL_SAMPLES = FFT_SIZE + GUARD_SAMPLES;
const SYMBOLS_PER_FRAME = 15;
const CARRIER_BIN_OFFSET = 32;
const K_MIN = -10;
const K_MAX = 18;
const NUM_CARRIERS = K_MAX - K_MIN + 1;
const TIME_PILOT_CARRIERS = [-9, -3, 4, 8, 12];
const FREQ_PILOT_CELLS = [
  [0, -9],
  [0, 8],
  [5, -3],
  [5, 12],
  [10, 4],
  [14, -9],
  [14, 8],
];
const PILOT_BOOST = Math.sqrt(2);
const CONV_POLYNOMIALS = [0o133, 0o171, 0o145, 0o165, 0o117, 0o135];
const CONV_STATES = 64;
const PUNCTURE_MSC = [1, 1, 0, 1, 0, 0];
const MSC_SEGMENT_BYTES = 800;
const MSC_SEGMENT_HEADER_BYTES = 4;
const FAC_CELLS = [
  [0, -7],
  [0, 6],
];
const SDC_CELLS = [
  [0, -6],
  [0, -5],
  [0, -4],
  [0, 7],
  [0, 9],
  [0, 10],
];

const QAM16_SCALE = 1 / Math.sqrt(10);
const QAM16_CONSTELLATION = (() => {
  const pts = [];
  const vals = [-3, -1, 1, 3];
  const gray = [0, 1, 3, 2];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      pts[(gray[r] << 2) | gray[c]] = [vals[c] * QAM16_SCALE, vals[r] * QAM16_SCALE];
    }
  return pts;
})();

// ── CRC ───────────────────────────────────────────────────────────────────────

function crc8(data) {
  let crc = 0xff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
  }
  return crc ^ 0xff;
}
function crc16(data) {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

// ── Bit helpers ───────────────────────────────────────────────────────────────

function packBits(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  return bytes;
}

// ── Viterbi decoder ───────────────────────────────────────────────────────────

function popcount(x) {
  let n = x;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24) & 0xff;
}

function viterbiDecode(rxBits, puncture) {
  const K = 7,
    numStates = CONV_STATES,
    rate = CONV_POLYNOMIALS.length;
  const bitsPerInput = puncture.filter((p) => p).length;
  const numInputBits = Math.floor(rxBits.length / bitsPerInput);
  let pm = new Float64Array(numStates).fill(1e9);
  pm[0] = 0;
  const traceback = [];
  let rxIdx = 0;
  for (let step = 0; step < numInputBits; step++) {
    const newPm = new Float64Array(numStates).fill(1e9);
    const tb = new Int32Array(numStates).fill(-1);
    for (let s = 0; s < numStates; s++) {
      if (pm[s] >= 1e9) continue;
      for (const bit of [0, 1]) {
        const nextState = ((s >> 1) | (bit << (K - 2))) & (numStates - 1);
        let metric = pm[s];
        const fullState = (bit << (K - 1)) | s;
        let rxOffset = rxIdx;
        for (let i = 0; i < rate; i++) {
          if (!puncture[i % puncture.length]) continue;
          const parity = popcount(fullState & CONV_POLYNOMIALS[i]) & 1;
          if (parity !== (rxBits[rxOffset] ?? 0)) metric++;
          rxOffset++;
        }
        if (metric < newPm[nextState]) {
          newPm[nextState] = metric;
          tb[nextState] = s;
        }
      }
    }
    traceback.push(tb);
    pm = newPm;
    rxIdx += bitsPerInput;
  }
  let best = 0;
  for (let s = 1; s < numStates; s++) if (pm[s] < pm[best]) best = s;
  const decoded = [];
  let state = best;
  for (let step = traceback.length - 1; step >= 0; step--) {
    const prev = traceback[step][state];
    if (prev === -1) {
      decoded.unshift(0);
      state = 0;
      continue;
    }
    decoded.unshift((state >> (K - 2)) & 1);
    state = prev;
  }
  return decoded.slice(0, Math.max(0, decoded.length - (K - 1)));
}

// ── FAC decoder ───────────────────────────────────────────────────────────────

function decodeFAC(bits) {
  if (bits.length < 72) return null;
  const dataBits = bits.slice(0, 64);
  const receivedCrc = bits.slice(64, 72);
  const bytes = packBits(dataBits);
  const computed = crc8(bytes);
  const computedBits = [];
  for (let i = 7; i >= 0; i--) computedBits.push((computed >> i) & 1);
  if (!computedBits.every((b, i) => b === receivedCrc[i])) return null;
  const modeCode = (dataBits[0] << 1) | dataBits[1];
  return { mode: ['A', 'B', 'C', 'D'][modeCode] ?? 'B' };
}

// ── SDC decoder ───────────────────────────────────────────────────────────────

function decodeSDC(data) {
  if (data.length < 5) return null;
  const payload = data.slice(0, data.length - 2);
  const rxCrc = (data[data.length - 2] << 8) | data[data.length - 1];
  if (crc16(payload) !== rxCrc) return null;
  const payloadBytes = (payload[0] << 16) | (payload[1] << 8) | payload[2];
  return { payloadBytes };
}

// ── MSC reassembly ────────────────────────────────────────────────────────────

function deserialiseSegments(data) {
  const segments = [];
  let pos = 0;
  while (pos + MSC_SEGMENT_HEADER_BYTES + 2 <= data.length) {
    const segNo = (data[pos] << 8) | data[pos + 1];
    const totalSegments = (data[pos + 2] << 8) | data[pos + 3];
    pos += MSC_SEGMENT_HEADER_BYTES;
    const maxPayload = MSC_SEGMENT_BYTES - MSC_SEGMENT_HEADER_BYTES;
    const remainingDataBytes = data.length - pos - 2;
    const dataLen = Math.min(maxPayload, remainingDataBytes);
    if (dataLen <= 0) break;
    const segData = data.slice(pos, pos + dataLen);
    pos += dataLen;
    const crc = (data[pos] << 8) | data[pos + 1];
    pos += 2;
    segments.push({
      segNo,
      totalSegments,
      isLast: segNo === totalSegments - 1,
      data: segData,
      crc,
    });
  }
  return segments;
}

function reassembleMSC(segments, expectedTotal) {
  if (segments.length === 0) return null;
  const total = expectedTotal ?? segments[0].totalSegments;
  const map = new Map();
  for (const seg of segments) {
    const header = new Uint8Array(4);
    header[0] = (seg.segNo >> 8) & 0xff;
    header[1] = seg.segNo & 0xff;
    header[2] = (seg.totalSegments >> 8) & 0xff;
    header[3] = seg.totalSegments & 0xff;
    const combined = new Uint8Array(header.length + seg.data.length);
    combined.set(header);
    combined.set(seg.data, header.length);
    if (crc16(combined) === seg.crc && !map.has(seg.segNo)) map.set(seg.segNo, seg);
  }
  if (map.size < total) return null;
  const sorted = Array.from({ length: total }, (_, i) => map.get(i)).filter(Boolean);
  if (sorted.length < total) return null;
  const totalBytes = sorted.reduce((a, s) => a + s.data.length, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const seg of sorted) {
    result.set(seg.data, offset);
    offset += seg.data.length;
  }
  return result;
}

// ── FFT ───────────────────────────────────────────────────────────────────────

function bitReverseFFT(re, im, n) {
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let rev = 0,
      x = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
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
    const wRe = Math.cos(angle),
      wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let twRe = 1,
        twIm = 0;
      for (let j = 0; j < half; j++) {
        const u = i + j,
          v = u + half;
        const tRe = twRe * re[v] - twIm * im[v],
          tIm = twRe * im[v] + twIm * re[v];
        re[v] = re[u] - tRe;
        im[v] = im[u] - tIm;
        re[u] += tRe;
        im[u] += tIm;
        const next = twRe * wRe - twIm * wIm;
        twIm = twRe * wIm + twIm * wRe;
        twRe = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

// ── QAM demap ─────────────────────────────────────────────────────────────────

function demap16QAM(re, im) {
  let bestDist = Infinity,
    bestSym = 0;
  for (let s = 0; s < QAM16_CONSTELLATION.length; s++) {
    const [cRe, cIm] = QAM16_CONSTELLATION[s];
    const d = (re - cRe) ** 2 + (im - cIm) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestSym = s;
    }
  }
  return [(bestSym >> 3) & 1, (bestSym >> 2) & 1, (bestSym >> 1) & 1, bestSym & 1];
}
function demap4QAM(re, im) {
  return [re >= 0 ? (im >= 0 ? 0 : 1) : im >= 0 ? 1 : 0, im >= 0 ? 1 : 0];
}

// ── Interleaver ───────────────────────────────────────────────────────────────

function buildBijectiveFreqPermutation(n) {
  const bits = Math.ceil(Math.log2(Math.max(n, 2)));
  const perm = [],
    used = new Array(n).fill(false);
  for (let i = 0; perm.length < n; i++) {
    let rev = 0,
      x = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
    if (rev < n && !used[rev]) {
      perm.push(rev);
      used[rev] = true;
    }
  }
  return perm;
}
function buildInverse(perm) {
  const inv = new Array(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

const FREQ_PERM_16 = buildBijectiveFreqPermutation(16);
const FREQ_PERM_24 = buildBijectiveFreqPermutation(24);
const FREQ_PERM_16_INV = buildInverse(FREQ_PERM_16);
const FREQ_PERM_24_INV = buildInverse(FREQ_PERM_24);
const FREQ_GROUP_SIZES = [16, ...new Array(14).fill(24)];

function freqDeinterleave(cells) {
  const out = cells.map((c) => [c[0], c[1]]);
  let offset = 0;
  for (let sym = 0; sym < FREQ_GROUP_SIZES.length; sym++) {
    const groupSize = FREQ_GROUP_SIZES[sym];
    const inv = sym === 0 ? FREQ_PERM_16_INV : FREQ_PERM_24_INV;
    const group = cells.slice(offset, offset + groupSize);
    for (let i = 0; i < groupSize; i++) out[offset + inv[i]] = group[i];
    offset += groupSize;
  }
  return out;
}
function timeDeinterleave(cells, cols = 30) {
  const n = cells.length,
    rows = Math.ceil(n / cols);
  const out = Array.from({ length: n }, () => [0, 0]);
  let idx = 0;
  for (let col = 0; col < cols; col++)
    for (let row = 0; row < rows; row++) {
      const dst = row * cols + col;
      if (dst < n && idx < n) out[dst] = cells[idx++];
    }
  return out;
}

// ── Channel estimation & equalisation ─────────────────────────────────────────

function estimateChannel(symbols) {
  const H = symbols.map(() => Array.from({ length: NUM_CARRIERS }, () => [1, 0]));
  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    const pilotObs = [];
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      const isTP = TIME_PILOT_CARRIERS.includes(k);
      const isFP = FREQ_PILOT_CELLS.some(([s, kk]) => s === si && kk === k);
      if (isTP || isFP) {
        const [rxRe, rxIm] = sym[ki];
        pilotObs.push({ ki, hRe: rxRe / PILOT_BOOST, hIm: rxIm / PILOT_BOOST });
      }
    }
    if (pilotObs.length === 0) continue;
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const before = pilotObs.filter((p) => p.ki <= ki).at(-1);
      const after = pilotObs.find((p) => p.ki >= ki);
      if (!before && after) H[si][ki] = [after.hRe, after.hIm];
      else if (before && !after) H[si][ki] = [before.hRe, before.hIm];
      else if (before && after) {
        if (before.ki === after.ki) H[si][ki] = [before.hRe, before.hIm];
        else {
          const t = (ki - before.ki) / (after.ki - before.ki);
          H[si][ki] = [
            before.hRe + t * (after.hRe - before.hRe),
            before.hIm + t * (after.hIm - before.hIm),
          ];
        }
      }
    }
  }
  return H;
}
function equalise(symbols, H) {
  return symbols.map((sym, si) =>
    sym.map(([rxRe, rxIm], ki) => {
      const [hRe, hIm] = H[si][ki];
      const denom = hRe * hRe + hIm * hIm;
      if (denom < 1e-12) return [0, 0];
      return [(rxRe * hRe + rxIm * hIm) / denom, (rxIm * hRe - rxRe * hIm) / denom];
    })
  );
}

// ── OFDM demodulator ──────────────────────────────────────────────────────────

function ofdmDemodulate(samples, startPos, numFrames = 1) {
  const frames = [];
  for (let frame = 0; frame < numFrames; frame++) {
    const symbols = [];
    const frameStart = startPos + frame * SYMBOLS_PER_FRAME * SYMBOL_SAMPLES;
    for (let si = 0; si < SYMBOLS_PER_FRAME; si++) {
      const symStart = frameStart + si * SYMBOL_SAMPLES + GUARD_SAMPLES;
      const re = new Float64Array(FFT_SIZE),
        im = new Float64Array(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) re[i] = samples[symStart + i] ?? 0;
      fft(re, im, FFT_SIZE, false);
      const carriers = [];
      for (let ki = 0; ki < NUM_CARRIERS; ki++) {
        const k = K_MIN + ki;
        const bin = (CARRIER_BIN_OFFSET + k + FFT_SIZE) % FFT_SIZE;
        carriers.push([re[bin] / FFT_SIZE, im[bin] / FFT_SIZE]);
      }
      symbols.push(carriers);
    }
    frames.push(symbols);
  }
  return frames;
}

// ── Coarse sync ───────────────────────────────────────────────────────────────

function coarseSync(samples) {
  const L = GUARD_SAMPLES,
    D = FFT_SIZE;
  const maxSearch = Math.min(samples.length - SYMBOL_SAMPLES, 2 * SYMBOL_SAMPLES);
  let bestCorr = -1,
    bestPos = 0;
  for (let pos = 0; pos < maxSearch; pos++) {
    let corrRe = 0,
      eG = 0,
      eD = 0;
    for (let i = 0; i < L; i++) {
      const g = samples[pos + i] ?? 0,
        d = samples[pos + D + i] ?? 0;
      corrRe += g * d;
      eG += g * g;
      eD += d * d;
    }
    const norm = Math.sqrt(eG * eD);
    const mag = norm > 1e-12 ? Math.abs(corrRe) / norm : 0;
    if (mag > bestCorr) {
      bestCorr = mag;
      bestPos = pos;
    }
  }
  return bestPos;
}

// ── MSC slot calculator ───────────────────────────────────────────────────────

function getMSCSlots() {
  const facSet = new Set(FAC_CELLS.map(([s, k]) => `${s},${k}`));
  const sdcSet = new Set(SDC_CELLS.map(([s, k]) => `${s},${k}`));
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

// ── WAV reader ────────────────────────────────────────────────────────────────

function readWAV(buf) {
  const view = new DataView(buf.buffer || buf);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const numSamples = dataSize / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  return { samples, sampleRate };
}

// ── Decode ────────────────────────────────────────────────────────────────────

function decode(samples, inputSampleRate) {
  // Resample to 12 kHz if needed
  let resampled = samples;
  if (inputSampleRate !== SAMPLE_RATE) {
    const ratio = inputSampleRate / SAMPLE_RATE;
    const outLen = Math.floor(samples.length / ratio);
    resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio,
        lo = Math.floor(pos),
        frac = pos - lo;
      resampled[i] = (samples[lo] ?? 0) + frac * ((samples[lo + 1] ?? 0) - (samples[lo] ?? 0));
    }
  }

  const syncPos = coarseSync(resampled);
  const availSamples = resampled.length - syncPos;
  const numFrames = Math.max(1, Math.floor(availSamples / (SYMBOL_SAMPLES * SYMBOLS_PER_FRAME)));

  console.log(`  Sync position: ${syncPos}, frames to decode: ${numFrames}`);

  const demodFrames = ofdmDemodulate(resampled, syncPos, numFrames);

  const allMSCBits = [],
    allFACBits = [],
    allSDCBits = [];
  for (const symbols of demodFrames) {
    const H = estimateChannel(symbols);
    const eq = equalise(symbols, H);
    const mscCells = MSC_SLOTS.map(({ sym, ki }) => eq[sym][ki]);
    const deint = freqDeinterleave(timeDeinterleave(mscCells));
    for (const [re, im] of deint) allMSCBits.push(...demap16QAM(re, im));
    for (const [sym, k] of FAC_CELLS) {
      const ki = k - K_MIN;
      allFACBits.push(...demap4QAM(eq[sym][ki][0], eq[sym][ki][1]));
    }
    for (const [sym, k] of SDC_CELLS) {
      const ki = k - K_MIN;
      allSDCBits.push(...demap4QAM(eq[sym][ki][0], eq[sym][ki][1]));
    }
  }

  const facParams = decodeFAC(allFACBits.slice(0, 72));
  console.log(`  FAC decode: ${facParams ? `Mode ${facParams.mode}` : 'FAILED'}`);

  const sdcBytes = new Uint8Array(Math.ceil(allSDCBits.length / 8));
  for (let i = 0; i < allSDCBits.length; i++)
    if (allSDCBits[i]) sdcBytes[i >> 3] |= 1 << (7 - (i & 7));
  const sdcParams = decodeSDC(sdcBytes);
  console.log(`  SDC decode: ${sdcParams ? `payloadBytes=${sdcParams.payloadBytes}` : 'FAILED'}`);

  const decodedBits = viterbiDecode(allMSCBits, PUNCTURE_MSC);
  const decodedBytes = new Uint8Array(Math.ceil(decodedBits.length / 8));
  for (let i = 0; i < decodedBits.length; i++)
    if (decodedBits[i]) decodedBytes[i >> 3] |= 1 << (7 - (i & 7));

  const segments = deserialiseSegments(decodedBytes);
  console.log(`  Segments recovered: ${segments.length}`);

  const expectedSegs =
    sdcParams?.payloadBytes !== undefined
      ? Math.ceil(sdcParams.payloadBytes / (MSC_SEGMENT_BYTES - 4))
      : undefined;
  const reassembled = reassembleMSC(segments, expectedSegs);

  if (reassembled) {
    const isJpeg =
      reassembled.length > 3 &&
      reassembled[0] === 0xff &&
      reassembled[1] === 0xd8 &&
      reassembled[2] === 0xff;
    console.log(`  Reassembled: ${reassembled.length} bytes, JPEG=${isJpeg}`);
    return { ok: isJpeg, bytes: reassembled };
  }
  console.log('  Reassembly FAILED');
  return { ok: false };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = [
  resolve(ROOT, 'public/examples/DSSTV1.wav'),
  resolve(ROOT, 'public/examples/DSSTV2.wav'),
];

let allPassed = true;
for (const wavPath of files) {
  console.log(`\nDecoding: ${wavPath.split('/').at(-1)}`);
  const buf = readFileSync(wavPath);
  const { samples, sampleRate } = readWAV(buf);
  console.log(
    `  WAV: ${samples.length} samples @ ${sampleRate} Hz (${(samples.length / sampleRate).toFixed(1)}s)`
  );
  const result = decode(samples, sampleRate);
  if (result.ok) {
    console.log(`  ✓ DECODE SUCCESS — JPEG recovered (${result.bytes.length} bytes)`);
  } else {
    console.log(`  ✗ DECODE FAILED`);
    allPassed = false;
  }
}

console.log(
  allPassed ? '\n✓ All samples decode successfully!' : '\n✗ Some samples failed to decode.'
);
process.exit(allPassed ? 0 : 1);
