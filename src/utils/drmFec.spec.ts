import { describe, expect, it } from 'vitest';
import { PUNCTURE_FAC, PUNCTURE_MSC } from './drmConstants.js';
import { convEncode, crc8, crc16, packBits, unpackBits, viterbiDecode } from './drmFec.js';

// ── convEncode / viterbiDecode round-trips ────────────────────────────────────

describe('convEncode / viterbiDecode round-trip', () => {
  it('recovers all-zero input (32 bits, PUNCTURE_MSC)', () => {
    const bits = new Array<number>(32).fill(0);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual(bits);
  });

  it('recovers all-one input (32 bits, PUNCTURE_MSC)', () => {
    const bits = new Array<number>(32).fill(1);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual(bits);
  });

  it('recovers alternating 0/1 pattern (32 bits, PUNCTURE_MSC)', () => {
    const bits = Array.from<number>({ length: 32 }, (_, i) => i % 2);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual(bits);
  });

  it('recovers a fixed 100-bit sequence with PUNCTURE_MSC', () => {
    // Fixed sequence avoids non-determinism from Math.random()
    const bits = Array.from<number>({ length: 100 }, (_, i) => (0xdeadbeef >> (i % 32)) & 1);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual(bits);
  });

  it('recovers a fixed 100-bit sequence with PUNCTURE_FAC', () => {
    const bits = Array.from<number>({ length: 100 }, (_, i) => (0xcafebabe >> (i % 32)) & 1);
    const encoded = convEncode(bits, PUNCTURE_FAC);
    const decoded = viterbiDecode(encoded, PUNCTURE_FAC);
    expect(decoded).toEqual(bits);
  });

  it('encoded bit count = (inputBits + K-1 tail) × kept_per_input (PUNCTURE_MSC)', () => {
    const bits = new Array<number>(50).fill(0);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const keptPerInput = PUNCTURE_MSC.filter((p) => p).length; // 3
    const K = 7;
    expect(encoded.length).toBe((bits.length + (K - 1)) * keptPerInput);
  });

  it('decoded length equals input length (tail bits trimmed)', () => {
    const bits = Array.from<number>({ length: 48 }, (_, i) => ((i * 7) % 3 === 0 ? 1 : 0));
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded.length).toBe(bits.length);
  });

  it('single-bit 0 round-trips', () => {
    const encoded = convEncode([0], PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual([0]);
  });

  it('single-bit 1 round-trips', () => {
    const encoded = convEncode([1], PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual([1]);
  });

  it('256-bit payload round-trips (PUNCTURE_MSC)', () => {
    const bits = Array.from<number>({ length: 256 }, (_, i) => (i * 13 + 7) % 2);
    const encoded = convEncode(bits, PUNCTURE_MSC);
    const decoded = viterbiDecode(encoded, PUNCTURE_MSC);
    expect(decoded).toEqual(bits);
  });
});

// ── packBits / unpackBits ─────────────────────────────────────────────────────

describe('packBits / unpackBits', () => {
  it('round-trips 8 bits (all ones)', () => {
    const bits = [1, 1, 1, 1, 1, 1, 1, 1];
    expect(Array.from(packBits(bits))).toEqual([0xff]);
    expect(unpackBits(new Uint8Array([0xff]), 8)).toEqual(bits);
  });

  it('round-trips 8 bits (alternating)', () => {
    const bits = [1, 0, 1, 0, 1, 0, 1, 0];
    expect(Array.from(packBits(bits))).toEqual([0xaa]);
    expect(unpackBits(new Uint8Array([0xaa]), 8)).toEqual(bits);
  });

  it('unpackBits respects numBits limit', () => {
    const result = unpackBits(new Uint8Array([0xff, 0x00]), 4);
    expect(result).toEqual([1, 1, 1, 1]);
  });
});

// ── CRC correctness ───────────────────────────────────────────────────────────

describe('crc8', () => {
  it('returns a byte-sized value (0–255)', () => {
    const val = crc8(new Uint8Array([0x01, 0x02, 0x03]));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(255);
  });

  it('same input always produces same CRC', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(crc8(data)).toBe(crc8(data));
  });

  it('different input produces different CRC (with high probability)', () => {
    expect(crc8(new Uint8Array([0x00]))).not.toBe(crc8(new Uint8Array([0x01])));
  });
});

describe('crc16', () => {
  it('returns a 16-bit value (0–65535)', () => {
    const val = crc16(new Uint8Array([0x01, 0x02, 0x03]));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(65535);
  });

  it('same input always produces same CRC', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(crc16(data)).toBe(crc16(data));
  });

  it('different input produces different CRC', () => {
    expect(crc16(new Uint8Array([0x00]))).not.toBe(crc16(new Uint8Array([0xff])));
  });
});
