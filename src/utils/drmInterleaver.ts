/**
 * DRM time and frequency interleaving/deinterleaving.
 *
 * DRM uses two levels of interleaving on the MSC:
 *   1. Frequency interleaving: shuffles cells within each OFDM symbol.
 *   2. Time interleaving: spreads cells across multiple frames (short = 1 frame).
 *
 * The interleaving patterns here are simplified approximations of the DRM
 * standard tables, which are sufficient for an ideal (noise-free) channel
 * and for self-decoding of our own encoded frames.
 *
 * Reference: ETSI ES 201 980 §8.4, QSSTV src/drmtx/common/interleaver/.
 */

import { NUM_CARRIERS } from './drmConstants.js';

// ── Frequency interleaver ─────────────────────────────────────────────────────

/**
 * Generate the frequency interleaving permutation for Mode B, SO_0.
 * Uses a simple bit-reversal permutation of the carrier indices within
 * the active band.  This is a practical approximation; the exact DRM
 * permutation is defined by a specific PRBS generator (spec §8.4.2).
 */
function buildFreqPermutation(len: number): Uint8Array {
  // Bit-reversal permutation for the active carrier window
  const bits = Math.ceil(Math.log2(len));
  const perm = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let rev = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
    perm[i] = rev % len;
  }
  return perm;
}

const FREQ_PERM = buildFreqPermutation(NUM_CARRIERS);
const FREQ_PERM_INV = (() => {
  const inv = new Uint8Array(NUM_CARRIERS);
  for (let i = 0; i < NUM_CARRIERS; i++) inv[FREQ_PERM[i]] = i;
  return inv;
})();

/**
 * Frequency-interleave a single OFDM symbol's payload cells in-place.
 * @param cells  Array of [re, im] pairs, length = NUM_CARRIERS.
 */
export function freqInterleave(cells: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = Array.from({ length: cells.length }, () => [0, 0]);
  for (let i = 0; i < cells.length; i++) {
    out[FREQ_PERM[i]] = cells[i];
  }
  return out;
}

/**
 * Frequency-deinterleave a single OFDM symbol's payload cells.
 */
export function freqDeinterleave(cells: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = Array.from({ length: cells.length }, () => [0, 0]);
  for (let i = 0; i < cells.length; i++) {
    out[FREQ_PERM_INV[i]] = cells[i];
  }
  return out;
}

// ── Time interleaver ──────────────────────────────────────────────────────────

/**
 * Short-depth time interleaver (1 frame = 400 ms).
 *
 * Interleaves `cells` from a single frame by re-ordering them according to
 * a row-column transpose of a matrix of width `cols`.  The DRM standard uses
 * a more complex permutation but this gives equivalent spread for one-frame depth.
 *
 * @param cells  Flat array of [re, im] cells.
 * @param cols   Number of columns in the interleaver matrix (default = 30).
 * @returns Interleaved cells.
 */
export function timeInterleave(cells: Array<[number, number]>, cols = 30): Array<[number, number]> {
  const n = cells.length;
  const rows = Math.ceil(n / cols);
  const out: Array<[number, number]> = Array.from({ length: n }, () => [0, 0] as [number, number]);
  // Write row-by-row, read column-by-column
  let idx = 0;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const src = row * cols + col;
      if (src < n) {
        out[idx++] = cells[src];
      }
    }
  }
  // Pad if needed (shouldn't happen in practice)
  while (idx < n) out[idx++] = [0, 0];
  return out;
}

/**
 * Reverse of timeInterleave.
 */
export function timeDeinterleave(
  cells: Array<[number, number]>,
  cols = 30
): Array<[number, number]> {
  const n = cells.length;
  const rows = Math.ceil(n / cols);
  const out: Array<[number, number]> = Array.from({ length: n }, () => [0, 0] as [number, number]);
  let idx = 0;
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const dst = row * cols + col;
      if (dst < n && idx < n) {
        out[dst] = cells[idx++];
      }
    }
  }
  return out;
}
