/**
 * DRM time and frequency interleaving/deinterleaving.
 *
 * DRM uses two levels of interleaving on the MSC:
 *   1. Frequency interleaving: shuffles cells within each OFDM symbol group.
 *   2. Time interleaving: spreads cells across multiple frames (short = 1 frame).
 *
 * The frequency interleaver operates on the flat MSC cell array, which is
 * laid out symbol-major.  Each symbol group is permuted independently using
 * a bijective bit-reversal mapping sized to that group.
 *
 * Mode B SO_0 MSC slot layout (29 carriers, 15 symbols):
 *   - sym 0: 29 − 5 time_pilots − 2 FAC − 6 SDC = 16 MSC slots
 *   - sym 1–14: 29 − 5 time_pilots = 24 MSC slots each
 *   Total: 16 + 14×24 = 352 MSC slots per frame.
 *
 * Reference: ETSI ES 201 980 §8.4, QSSTV src/drmtx/common/interleaver/.
 */

// ── Bijective frequency permutation builder ───────────────────────────────────

/**
 * Build a bijective (one-to-one, onto) bit-reversal permutation of length n.
 *
 * Standard bit-reversal over 2^ceil(log2(n)) is not bijective for non-powers
 * of two because multiple indices may map to the same reversed value.  This
 * implementation enumerates the 2^k bit-reversal values in order and keeps
 * only the first occurrence of each value < n, yielding a bijection.
 */
function buildBijectiveFreqPermutation(n: number): number[] {
  const bits = Math.ceil(Math.log2(Math.max(n, 2)));
  const perm: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  for (let i = 0; perm.length < n; i++) {
    let rev = 0;
    let x = i;
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

function buildInverse(perm: number[]): number[] {
  const inv = new Array<number>(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

// Precomputed bijective permutations for the two group sizes.
const FREQ_PERM_16 = buildBijectiveFreqPermutation(16);
const FREQ_PERM_24 = buildBijectiveFreqPermutation(24);
const FREQ_PERM_16_INV = buildInverse(FREQ_PERM_16);
const FREQ_PERM_24_INV = buildInverse(FREQ_PERM_24);

/**
 * Sizes of each symbol's MSC slot group, in symbol order.
 * sym 0 = 16 slots, sym 1–14 = 24 slots each.
 */
const FREQ_GROUP_SIZES = [16, ...new Array<number>(14).fill(24)] as const;

// ── Frequency interleaver ─────────────────────────────────────────────────────

/**
 * Frequency-interleave the flat MSC cell array.
 *
 * @param cells  Flat array of [re, im] pairs in symbol-major order (352 elements for Mode B SO_0).
 * @returns New array with cells permuted per symbol group.
 */
export function freqInterleave(cells: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = cells.map((c) => [c[0], c[1]]);
  let offset = 0;
  for (let sym = 0; sym < FREQ_GROUP_SIZES.length; sym++) {
    const groupSize = FREQ_GROUP_SIZES[sym];
    const perm = sym === 0 ? FREQ_PERM_16 : FREQ_PERM_24;
    const group = cells.slice(offset, offset + groupSize);
    for (let i = 0; i < groupSize; i++) {
      out[offset + perm[i]] = group[i];
    }
    offset += groupSize;
  }
  return out;
}

/**
 * Frequency-deinterleave the flat MSC cell array.
 * Exact inverse of freqInterleave.
 */
export function freqDeinterleave(cells: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = cells.map((c) => [c[0], c[1]]);
  let offset = 0;
  for (let sym = 0; sym < FREQ_GROUP_SIZES.length; sym++) {
    const groupSize = FREQ_GROUP_SIZES[sym];
    const inv = sym === 0 ? FREQ_PERM_16_INV : FREQ_PERM_24_INV;
    const group = cells.slice(offset, offset + groupSize);
    for (let i = 0; i < groupSize; i++) {
      out[offset + inv[i]] = group[i];
    }
    offset += groupSize;
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
