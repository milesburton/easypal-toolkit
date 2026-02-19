import { describe, expect, it } from 'vitest';
import {
  freqDeinterleave,
  freqInterleave,
  timeDeinterleave,
  timeInterleave,
} from './drmInterleaver.js';

// Mode B SO_0: 16 + 14×24 = 352 MSC slots per frame
const N_MSC = 352;

function makeCells(n: number, offset = 1): Array<[number, number]> {
  // offset > 0 ensures no cell is [0,0], making zero-leakage detectable
  return Array.from<[number, number]>({ length: n }, (_, i) => [i + offset, (i + offset) * 2]);
}

// ── freqInterleave / freqDeinterleave ─────────────────────────────────────────

describe('freqInterleave / freqDeinterleave', () => {
  it('freqDeinterleave(freqInterleave(x)) === x for 352 MSC cells', () => {
    const input = makeCells(N_MSC);
    const result = freqDeinterleave(freqInterleave(input));
    for (let i = 0; i < N_MSC; i++) {
      expect(result[i][0]).toBe(input[i][0]);
      expect(result[i][1]).toBe(input[i][1]);
    }
  });

  it('freqInterleave(freqDeinterleave(x)) === x for 352 MSC cells', () => {
    const input = makeCells(N_MSC);
    const result = freqInterleave(freqDeinterleave(input));
    for (let i = 0; i < N_MSC; i++) {
      expect(result[i][0]).toBe(input[i][0]);
      expect(result[i][1]).toBe(input[i][1]);
    }
  });

  it('output length equals input length (forward)', () => {
    expect(freqInterleave(makeCells(N_MSC))).toHaveLength(N_MSC);
  });

  it('output length equals input length (inverse)', () => {
    expect(freqDeinterleave(makeCells(N_MSC))).toHaveLength(N_MSC);
  });

  it('freqInterleave actually reorders elements (not identity)', () => {
    const input = makeCells(N_MSC);
    const interleaved = freqInterleave(input);
    // Not all positions should be identical after permutation
    const unchanged = interleaved.filter((c, i) => c[0] === input[i][0]).length;
    expect(unchanged).toBeLessThan(N_MSC);
  });

  it('freqInterleave produces no [0,0] cells when input has none', () => {
    // All input cells have re >= 1, so any [0,0] in output indicates a bug
    const input = makeCells(N_MSC, 1);
    const result = freqInterleave(input);
    const hasZero = result.some(([re, im]) => re === 0 && im === 0);
    expect(hasZero).toBe(false);
  });

  it('freqDeinterleave produces no [0,0] cells when input has none', () => {
    const input = makeCells(N_MSC, 1);
    const result = freqDeinterleave(input);
    const hasZero = result.some(([re, im]) => re === 0 && im === 0);
    expect(hasZero).toBe(false);
  });

  it('each input cell appears exactly once in the interleaved output (bijective)', () => {
    const input = makeCells(N_MSC);
    const interleaved = freqInterleave(input);
    // The set of re values should be identical before and after permutation
    const inputRe = new Set(input.map(([re]) => re));
    const outputRe = new Set(interleaved.map(([re]) => re));
    expect(outputRe).toEqual(inputRe);
  });
});

// ── timeInterleave / timeDeinterleave ─────────────────────────────────────────

describe('timeInterleave / timeDeinterleave', () => {
  it('timeDeinterleave(timeInterleave(x)) === x for 352 MSC cells', () => {
    const input = makeCells(N_MSC);
    const result = timeDeinterleave(timeInterleave(input));
    for (let i = 0; i < N_MSC; i++) {
      expect(result[i][0]).toBe(input[i][0]);
      expect(result[i][1]).toBe(input[i][1]);
    }
  });

  it('timeInterleave(timeDeinterleave(x)) === x for 352 MSC cells', () => {
    const input = makeCells(N_MSC);
    const result = timeInterleave(timeDeinterleave(input));
    for (let i = 0; i < N_MSC; i++) {
      expect(result[i][0]).toBe(input[i][0]);
    }
  });

  it('output length equals input length', () => {
    expect(timeInterleave(makeCells(N_MSC))).toHaveLength(N_MSC);
    expect(timeDeinterleave(makeCells(N_MSC))).toHaveLength(N_MSC);
  });

  it('timeInterleave reorders elements (not identity)', () => {
    const input = makeCells(N_MSC);
    const interleaved = timeInterleave(input);
    const unchanged = interleaved.filter((c, i) => c[0] === input[i][0]).length;
    expect(unchanged).toBeLessThan(N_MSC);
  });
});

// ── Combined chain ─────────────────────────────────────────────────────────────

describe('combined interleaver chain (encoder order then decoder order)', () => {
  it('freqDeinterleave(timeDeinterleave(timeInterleave(freqInterleave(x)))) === x', () => {
    const input = makeCells(N_MSC);
    // Encoder applies: freq then time
    const encoded = timeInterleave(freqInterleave(input));
    // Decoder applies: timeDeinterleave then freqDeinterleave
    const decoded = freqDeinterleave(timeDeinterleave(encoded));
    for (let i = 0; i < N_MSC; i++) {
      expect(decoded[i][0]).toBe(input[i][0]);
      expect(decoded[i][1]).toBe(input[i][1]);
    }
  });

  it('combined chain produces no data loss (all input values present in output)', () => {
    const input = makeCells(N_MSC);
    const encoded = timeInterleave(freqInterleave(input));
    const decoded = freqDeinterleave(timeDeinterleave(encoded));
    const inputRe = new Set(input.map(([re]) => re));
    const outputRe = new Set(decoded.map(([re]) => re));
    expect(outputRe).toEqual(inputRe);
  });
});
