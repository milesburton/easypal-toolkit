/**
 * Forward error correction for DRM.
 *
 * Implements:
 *  - Rate-1/6 convolutional encoder with puncturing
 *  - Hard-decision Viterbi decoder
 *  - CRC-8 (FAC) and CRC-16 (SDC/MSC segment headers)
 */

import { CONV_POLYNOMIALS, CONV_STATES } from './drmConstants.js';

// ── Convolutional encoder ─────────────────────────────────────────────────────

/**
 * Encode bits with the DRM rate-1/6 mother code, then apply puncturing.
 *
 * @param bits    Input bits (0 or 1).
 * @param puncture  Puncture pattern of length 6. 1 = emit bit, 0 = discard.
 * @returns Punctured encoded bits.
 */
export function convEncode(bits: number[], puncture: readonly number[]): number[] {
  const output: number[] = [];
  let state = 0;
  const K = 7; // constraint length

  for (const bit of bits) {
    // Full K=7 shift register word: current input at bit (K-1)=6, previous K-1
    // bits in state[5..0].  This matches the DRM standard polynomial evaluation.
    const fullState = (bit << (K - 1)) | state;

    // Shift new bit into state register for the next step
    state = ((state >> 1) | (bit << (K - 2))) & (CONV_STATES - 1);

    // Compute one output bit per generator polynomial
    for (let i = 0; i < CONV_POLYNOMIALS.length; i++) {
      if (puncture[i % puncture.length]) {
        const parity = popcount(fullState & CONV_POLYNOMIALS[i]) & 1;
        output.push(parity);
      }
    }
  }

  // Flush encoder (K-1 tail bits of zero to drive state back to 0)
  for (let t = 0; t < K - 1; t++) {
    const fullState = state; // input bit = 0, so fullState = (0 << 6) | state = state
    state = (state >> 1) & (CONV_STATES - 1);
    for (let i = 0; i < CONV_POLYNOMIALS.length; i++) {
      if (puncture[i % puncture.length]) {
        const parity = popcount(fullState & CONV_POLYNOMIALS[i]) & 1;
        output.push(parity);
      }
    }
  }

  return output;
}

function popcount(x: number): number {
  let n = x;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  n = (n + (n >> 4)) & 0x0f0f0f0f;
  return ((n * 0x01010101) >>> 24) & 0xff;
}

// ── Viterbi decoder ───────────────────────────────────────────────────────────

const MAX_PM = 1e9;

/**
 * Hard-decision Viterbi decoder for the DRM rate-1/6 convolutional code.
 *
 * @param rxBits  Received (possibly corrupted) bits after puncture-expansion.
 *                Punctured positions should be filled with 0 (erasure).
 * @param puncture  Same puncture pattern used during encoding.
 * @returns Decoded information bits.
 */
export function viterbiDecode(rxBits: number[], puncture: readonly number[]): number[] {
  const K = 7;
  const numStates = CONV_STATES;
  const rate = CONV_POLYNOMIALS.length; // 6 output bits per input before puncturing

  // Expand puncture: determine how many received bits correspond to each input bit
  const bitsPerInput = puncture.filter((p) => p).length;

  const numInputBits = Math.floor(rxBits.length / bitsPerInput);
  const decoded: number[] = [];

  // Path metrics: one per state
  let pm = new Float64Array(numStates).fill(MAX_PM);
  pm[0] = 0;

  // Traceback table: [step][state] → previous state
  const traceback: Int32Array[] = [];

  let rxIdx = 0;

  for (let step = 0; step < numInputBits; step++) {
    const newPm = new Float64Array(numStates).fill(MAX_PM);
    const tb = new Int32Array(numStates).fill(-1);

    for (let s = 0; s < numStates; s++) {
      if (pm[s] >= MAX_PM) continue;

      // Try input bit = 0 and 1
      for (const bit of [0, 1]) {
        const nextState = ((s >> 1) | (bit << (K - 2))) & (numStates - 1);
        let metric = pm[s];

        // Full K=7 shift register word matching convEncode: current input at bit (K-1)=6,
        // previous state bits in s[5..0].
        const fullState = (bit << (K - 1)) | s;

        // Compute expected outputs for (state=s, input=bit)
        let rxOffset = rxIdx;
        for (let i = 0; i < rate; i++) {
          if (!puncture[i % puncture.length]) continue;
          const parity = popcount(fullState & CONV_POLYNOMIALS[i]) & 1;
          const rx = rxBits[rxOffset] ?? 0;
          if (parity !== rx) metric += 1; // Hamming distance
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

  // Traceback: find best final state
  let best = 0;
  for (let s = 1; s < numStates; s++) {
    if (pm[s] < pm[best]) best = s;
  }

  // Walk traceback
  let state = best;
  for (let step = traceback.length - 1; step >= 0; step--) {
    const prev = traceback[step][state];
    if (prev === -1) {
      decoded.unshift(0);
      state = 0;
      continue;
    }
    // Determine the input bit that caused the transition prev → state
    const inputBit = (state >> (K - 2)) & 1;
    decoded.unshift(inputBit);
    state = prev;
  }

  // Trim the K-1 = 6 tail bits that convEncode appended to flush the encoder.
  // These are always decoded as zeros and are not part of the original payload.
  return decoded.slice(0, Math.max(0, decoded.length - (K - 1)));
}

// ── CRC ───────────────────────────────────────────────────────────────────────

/**
 * CRC-8 used for FAC (polynomial 0xD5, no reflect).
 * Computed over the 64 FAC data bits packed into 8 bytes.
 */
export function crc8(data: Uint8Array): number {
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

/**
 * CRC-16-CCITT used for SDC and MSC segment headers.
 * Polynomial 0x1021, initial 0xFFFF, no input/output reflection.
 */
export function crc16(data: Uint8Array): number {
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

// ── Bit packing helpers ───────────────────────────────────────────────────────

/** Pack an array of bits (MSB first) into bytes. */
export function packBits(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return bytes;
}

/** Unpack bytes into an array of bits (MSB first). */
export function unpackBits(bytes: Uint8Array, numBits?: number): number[] {
  const total = numBits ?? bytes.length * 8;
  const bits: number[] = [];
  for (let i = 0; i < total; i++) {
    bits.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  }
  return bits;
}
