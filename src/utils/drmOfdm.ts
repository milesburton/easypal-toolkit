/**
 * OFDM modulator and demodulator for DRM Mode B.
 *
 * Modulation pipeline (TX):
 *   Complex cell map → IFFT → prepend guard interval → upconvert to audio band → real samples
 *
 * Demodulation pipeline (RX):
 *   Real samples → coarse timing sync → remove guard → FFT → extract active carriers
 *
 * FFT: In-place Cooley-Tukey radix-2 decimation-in-time (DIT).
 *
 * Reference: ETSI ES 201 980, Dream DRM receiver source.
 */

import {
  CARRIER_BIN_OFFSET,
  FFT_SIZE,
  FREQ_PILOT_CELLS,
  GUARD_SAMPLES,
  K_MIN,
  NUM_CARRIERS,
  PILOT_BOOST,
  QAM16_CONSTELLATION,
  SAMPLE_RATE,
  SYMBOL_SAMPLES,
  SYMBOLS_PER_FRAME,
  TIME_PILOT_CARRIERS,
} from './drmConstants.js';

// ── In-place radix-2 FFT/IFFT ─────────────────────────────────────────────────

/**
 * Bit-reversal permutation for an array of length n (must be power of 2).
 */
function bitReverse(re: Float64Array, im: Float64Array, n: number): void {
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let rev = 0;
    let x = i;
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

/**
 * In-place Cooley-Tukey radix-2 DIT FFT / IFFT.
 * @param re     Real part (modified in-place).
 * @param im     Imaginary part (modified in-place).
 * @param n      Transform size (power of 2).
 * @param inverse  If true, computes IFFT (normalised by 1/n).
 */
export function fft(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  bitReverse(re, im, n);

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let twRe = 1;
      let twIm = 0;

      for (let j = 0; j < half; j++) {
        const u = i + j;
        const v = u + half;

        const tRe = twRe * re[v] - twIm * im[v];
        const tIm = twRe * im[v] + twIm * re[v];

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

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// ── Pilot cell generation ─────────────────────────────────────────────────────

/** Known pilot value (normalised): fixed phase reference. */
const PILOT_RE = PILOT_BOOST;
const PILOT_IM = 0;

/** Returns true if (symbolIdx, carrierIdx) is a time pilot cell. */
function isTimePilot(carrier: number): boolean {
  return (TIME_PILOT_CARRIERS as readonly number[]).includes(carrier);
}

/** Returns true if (symbolIdx, carrierIdx) is a frequency pilot cell. */
function isFreqPilot(symbolIdx: number, carrier: number): boolean {
  return FREQ_PILOT_CELLS.some(([s, k]) => s === symbolIdx && k === carrier);
}

// ── OFDM modulator (TX) ───────────────────────────────────────────────────────

/**
 * A single OFDM data cell: complex value assigned to one subcarrier in one symbol.
 */
export interface OFDMCell {
  /** Subcarrier index relative to K_MIN (0 = lowest active carrier). */
  carrierIdx: number;
  /** Symbol index within the frame (0 … SYMBOLS_PER_FRAME-1). */
  symbolIdx: number;
  re: number;
  im: number;
}

/**
 * Modulate one DRM transmission frame of data cells to audio samples.
 *
 * Pilot cells are inserted automatically; caller provides only MSC/FAC/SDC data cells.
 *
 * @param dataCells  Data cells to embed; each carries re/im value for a (symbol, carrier) slot.
 * @returns PCM samples at SAMPLE_RATE Hz (mono, float, normalised to ~±1).
 */
export function ofdmModulate(dataCells: OFDMCell[]): Float32Array {
  const output = new Float32Array(SYMBOLS_PER_FRAME * SYMBOL_SAMPLES);

  // Build per-symbol cell maps
  const cellMaps: Map<number, { re: number; im: number }>[] = Array.from(
    { length: SYMBOLS_PER_FRAME },
    () => new Map()
  );

  for (const cell of dataCells) {
    const sym = cell.symbolIdx;
    if (sym < 0 || sym >= SYMBOLS_PER_FRAME) continue;
    cellMaps[sym].set(cell.carrierIdx, { re: cell.re, im: cell.im });
  }

  for (let symIdx = 0; symIdx < SYMBOLS_PER_FRAME; symIdx++) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);

    const cells = cellMaps[symIdx];

    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki; // relative subcarrier index
      const bin = (CARRIER_BIN_OFFSET + k + FFT_SIZE) % FFT_SIZE;

      if (isTimePilot(k) || isFreqPilot(symIdx, k)) {
        re[bin] = PILOT_RE;
        im[bin] = PILOT_IM;
      } else {
        const cell = cells.get(ki);
        re[bin] = cell?.re ?? 0;
        im[bin] = cell?.im ?? 0;
      }
    }

    // IFFT
    fft(re, im, FFT_SIZE, true);

    // Assemble symbol with cyclic prefix
    const symStart = symIdx * SYMBOL_SAMPLES;

    // Guard interval = last GUARD_SAMPLES samples of IFFT output
    for (let i = 0; i < GUARD_SAMPLES; i++) {
      output[symStart + i] = re[FFT_SIZE - GUARD_SAMPLES + i];
    }
    // Useful part
    for (let i = 0; i < FFT_SIZE; i++) {
      output[symStart + GUARD_SAMPLES + i] = re[i];
    }
  }

  // Normalise to prevent clipping (typical OFDM peak factor)
  const peak = output.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak > 1e-9) {
    const scale = 0.9 / peak;
    for (let i = 0; i < output.length; i++) output[i] *= scale;
  }

  return output;
}

// ── Coarse timing synchronisation (RX) ───────────────────────────────────────

/**
 * Guard-interval correlation to estimate the start of the first OFDM symbol.
 *
 * The cyclic prefix (guard interval) is a copy of the last GUARD_SAMPLES samples
 * of the useful symbol.  We maximise the magnitude of the correlation between
 * the guard interval and the corresponding useful part, sliding over the input.
 *
 * @param samples  Input audio samples (at SAMPLE_RATE).
 * @param searchLen  How many samples to search (default: 2 × SYMBOL_SAMPLES).
 * @returns Estimated sample index of the start of the first symbol's guard interval.
 */
export function coarseSync(samples: Float32Array, searchLen?: number): number {
  const L = GUARD_SAMPLES;
  const D = FFT_SIZE;
  const maxSearch = searchLen ?? Math.min(samples.length - SYMBOL_SAMPLES, 2 * SYMBOL_SAMPLES);

  let bestCorr = -1;
  let bestPos = 0;

  for (let pos = 0; pos < maxSearch; pos++) {
    let corrRe = 0;
    let energyGuard = 0;
    let energyData = 0;

    for (let i = 0; i < L; i++) {
      const g = samples[pos + i] ?? 0; // guard sample
      const d = samples[pos + D + i] ?? 0; // corresponding useful part sample
      corrRe += g * d; // real-valued signal, so corr is real
      energyGuard += g * g;
      energyData += d * d;
    }

    const norm = Math.sqrt(energyGuard * energyData);
    const mag = norm > 1e-12 ? Math.abs(corrRe) / norm : 0;

    if (mag > bestCorr) {
      bestCorr = mag;
      bestPos = pos;
    }
  }

  return bestPos;
}

// ── OFDM demodulator (RX) ────────────────────────────────────────────────────

/**
 * Demodulate audio samples into raw complex cell values for all active carriers.
 *
 * @param samples   Audio samples at SAMPLE_RATE.
 * @param startPos  Sample index of the start of the first symbol (from coarseSync).
 * @param numFrames Number of frames to demodulate (default 1).
 * @returns Array of frames; each frame is an array of SYMBOLS_PER_FRAME symbol arrays,
 *          each containing NUM_CARRIERS complex values [re, im].
 */
export function ofdmDemodulate(
  samples: Float32Array,
  startPos: number,
  numFrames = 1
): Array<Array<Array<[number, number]>>> {
  const frames: Array<Array<Array<[number, number]>>> = [];

  for (let frame = 0; frame < numFrames; frame++) {
    const symbols: Array<Array<[number, number]>> = [];
    const frameStart = startPos + frame * SYMBOLS_PER_FRAME * SYMBOL_SAMPLES;

    for (let symIdx = 0; symIdx < SYMBOLS_PER_FRAME; symIdx++) {
      const symStart = frameStart + symIdx * SYMBOL_SAMPLES + GUARD_SAMPLES;

      const re = new Float64Array(FFT_SIZE);
      const im = new Float64Array(FFT_SIZE);

      for (let i = 0; i < FFT_SIZE; i++) {
        re[i] = samples[symStart + i] ?? 0;
      }

      fft(re, im, FFT_SIZE, false);

      const carriers: Array<[number, number]> = [];
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

// ── Channel estimation and equalisation ──────────────────────────────────────

/**
 * Estimate complex channel response at each carrier in each symbol, using
 * known pilot cells.  Interpolates linearly between pilots.
 *
 * @param symbols  Demodulated symbols from one frame (SYMBOLS_PER_FRAME × NUM_CARRIERS × [re, im]).
 * @returns Per-symbol, per-carrier channel estimate [re, im].
 */
export function estimateChannel(
  symbols: Array<Array<[number, number]>>
): Array<Array<[number, number]>> {
  const H: Array<Array<[number, number]>> = symbols.map(() =>
    Array.from({ length: NUM_CARRIERS }, () => [1, 0] as [number, number])
  );

  for (let symIdx = 0; symIdx < symbols.length; symIdx++) {
    const sym = symbols[symIdx];

    // Collect pilot observations at known positions
    const pilotObs: Array<{ ki: number; hRe: number; hIm: number }> = [];

    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      if (isTimePilot(k) || isFreqPilot(symIdx, k)) {
        const [rxRe, rxIm] = sym[ki];
        // Divide by known pilot value (PILOT_RE, PILOT_IM) = (PILOT_BOOST, 0)
        pilotObs.push({
          ki,
          hRe: rxRe / PILOT_BOOST,
          hIm: rxIm / PILOT_BOOST,
        });
      }
    }

    if (pilotObs.length === 0) continue;

    // Linear interpolation between pilots
    // Extrapolate to edges using nearest pilot
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const before = pilotObs.filter((p) => p.ki <= ki).at(-1);
      const after = pilotObs.find((p) => p.ki >= ki);

      if (!before && after) {
        H[symIdx][ki] = [after.hRe, after.hIm];
      } else if (before && !after) {
        H[symIdx][ki] = [before.hRe, before.hIm];
      } else if (before && after) {
        if (before.ki === after.ki) {
          H[symIdx][ki] = [before.hRe, before.hIm];
        } else {
          const t = (ki - before.ki) / (after.ki - before.ki);
          H[symIdx][ki] = [
            before.hRe + t * (after.hRe - before.hRe),
            before.hIm + t * (after.hIm - before.hIm),
          ];
        }
      }
    }
  }

  return H;
}

/**
 * Apply channel equalisation: divide received cells by channel estimate.
 *
 * @param symbols  Raw demodulated cells.
 * @param H        Channel estimate from estimateChannel.
 * @returns Equalised cells.
 */
export function equalise(
  symbols: Array<Array<[number, number]>>,
  H: Array<Array<[number, number]>>
): Array<Array<[number, number]>> {
  return symbols.map((sym, si) =>
    sym.map(([rxRe, rxIm], ki) => {
      const [hRe, hIm] = H[si][ki];
      const denom = hRe * hRe + hIm * hIm;
      if (denom < 1e-12) return [0, 0] as [number, number];
      // Complex division: (rx / h) = (rx · h*) / |h|²
      return [(rxRe * hRe + rxIm * hIm) / denom, (rxIm * hRe - rxRe * hIm) / denom] as [
        number,
        number,
      ];
    })
  );
}

// ── QAM demapping ─────────────────────────────────────────────────────────────

/**
 * Hard-decision 16-QAM demapper.
 * Returns 4 bits per cell (MSB first).
 */
export function demap16QAM(re: number, im: number): number[] {
  let bestDist = Infinity;
  let bestSym = 0;

  for (let s = 0; s < QAM16_CONSTELLATION.length; s++) {
    const [cRe, cIm] = QAM16_CONSTELLATION[s];
    const d = (re - cRe) ** 2 + (im - cIm) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestSym = s;
    }
  }

  // Return 4 bits (Gray coded symbol index)
  return [(bestSym >> 3) & 1, (bestSym >> 2) & 1, (bestSym >> 1) & 1, bestSym & 1];
}

/**
 * Hard-decision 4-QAM (QPSK) demapper.
 * Returns 2 bits per cell.
 */
export function demap4QAM(re: number, im: number): number[] {
  const i = re >= 0 ? 1 : 0;
  const q = im >= 0 ? 1 : 0;
  // Gray coding: 00=NE, 01=SE, 10=NW, 11=SW
  return [i ^ q, q];
}

// ── SNR estimation ────────────────────────────────────────────────────────────

/**
 * Estimate SNR in dB from pilot cell error.
 *
 * Compares received pilot cells against their known value.
 * SNR = signal power / noise power = PILOT_BOOST² / mean squared error.
 */
export function estimateSnr(symbols: Array<Array<[number, number]>>): number {
  let signalPower = 0;
  let noisePower = 0;
  let count = 0;

  for (let symIdx = 0; symIdx < symbols.length; symIdx++) {
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      if (isTimePilot(k) || isFreqPilot(symIdx, k)) {
        const [rxRe, rxIm] = symbols[symIdx][ki];
        const errRe = rxRe - PILOT_BOOST;
        const errIm = rxIm - PILOT_IM;
        signalPower += PILOT_BOOST ** 2;
        noisePower += errRe ** 2 + errIm ** 2;
        count++;
      }
    }
  }

  if (count === 0 || noisePower < 1e-15) return 40; // assume good SNR
  return 10 * Math.log10(signalPower / noisePower);
}

// ── Resampler ─────────────────────────────────────────────────────────────────

/**
 * Simple linear-interpolation resampler.
 * Used to convert input audio (e.g. 44100 Hz, 48000 Hz) to SAMPLE_RATE (12000 Hz).
 */
export function resample(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SAMPLE_RATE) return input;
  const ratio = inputRate / SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const frac = pos - lo;
    const a = input[lo] ?? 0;
    const b = input[lo + 1] ?? 0;
    out[i] = a + frac * (b - a);
  }
  return out;
}
