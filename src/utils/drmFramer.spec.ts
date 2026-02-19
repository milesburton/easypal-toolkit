import { describe, expect, it } from 'vitest';
import { MSC_SEGMENT_BYTES, MSC_SEGMENT_HEADER_BYTES } from './drmConstants.js';
import {
  decodeFAC,
  decodeSDC,
  deserialiseSegments,
  encodeFAC,
  encodeSDC,
  reassembleMSC,
  segmentMSC,
  serialiseSegment,
} from './drmFramer.js';

// ── MSC segmentation and serialisation ───────────────────────────────────────

const MAX_PAYLOAD = MSC_SEGMENT_BYTES - MSC_SEGMENT_HEADER_BYTES; // 796 bytes per segment

function makePayload(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => i & 0xff);
}

function serialiseAll(data: Uint8Array): Uint8Array {
  const segs = segmentMSC(data);
  const parts = segs.map(serialiseSegment);
  const flat = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let off = 0;
  for (const p of parts) {
    flat.set(p, off);
    off += p.length;
  }
  return flat;
}

describe('segmentMSC', () => {
  it('single small payload → 1 segment', () => {
    const segs = segmentMSC(makePayload(100));
    expect(segs).toHaveLength(1);
    expect(segs[0].segNo).toBe(0);
    expect(segs[0].totalSegments).toBe(1);
    expect(segs[0].isLast).toBe(true);
  });

  it('exact max-payload → 1 segment', () => {
    const segs = segmentMSC(makePayload(MAX_PAYLOAD));
    expect(segs).toHaveLength(1);
  });

  it('max-payload + 1 → 2 segments', () => {
    const segs = segmentMSC(makePayload(MAX_PAYLOAD + 1));
    expect(segs).toHaveLength(2);
    expect(segs[1].isLast).toBe(true);
  });

  it('2000-byte payload → 3 segments', () => {
    const segs = segmentMSC(makePayload(2000));
    expect(segs).toHaveLength(3);
    expect(segs[0].segNo).toBe(0);
    expect(segs[1].segNo).toBe(1);
    expect(segs[2].segNo).toBe(2);
    expect(segs[2].isLast).toBe(true);
  });

  it('segment data sizes sum to payload size', () => {
    const data = makePayload(1500);
    const segs = segmentMSC(data);
    const total = segs.reduce((a, s) => a + s.data.length, 0);
    expect(total).toBe(data.length);
  });
});

describe('serialiseSegment / deserialiseSegments', () => {
  it('single segment: serialise then deserialise recovers data', () => {
    const data = makePayload(100);
    const [seg] = segmentMSC(data);
    const flat = serialiseSegment(seg);
    const recovered = deserialiseSegments(flat);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].segNo).toBe(0);
    expect(Array.from(recovered[0].data)).toEqual(Array.from(seg.data));
  });

  it('single max-payload segment round-trips', () => {
    const data = makePayload(MAX_PAYLOAD);
    const [seg] = segmentMSC(data);
    const flat = serialiseSegment(seg);
    const recovered = deserialiseSegments(flat);
    expect(recovered).toHaveLength(1);
    expect(Array.from(recovered[0].data)).toEqual(Array.from(seg.data));
  });

  it('2-segment payload: both segments recovered', () => {
    const data = makePayload(MAX_PAYLOAD + 50);
    const flat = serialiseAll(data);
    const recovered = deserialiseSegments(flat);
    expect(recovered).toHaveLength(2);
    expect(recovered[0].segNo).toBe(0);
    expect(recovered[1].segNo).toBe(1);
  });

  it('3-segment payload: all 3 segments recovered with correct data', () => {
    const data = makePayload(2000);
    const segs = segmentMSC(data);
    const flat = serialiseAll(data);
    const recovered = deserialiseSegments(flat);
    expect(recovered).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(recovered[i].segNo).toBe(i);
      expect(recovered[i].totalSegments).toBe(segs[i].totalSegments);
      expect(Array.from(recovered[i].data)).toEqual(Array.from(segs[i].data));
    }
  });
});

describe('reassembleMSC', () => {
  it('single-byte payload reassembles correctly', () => {
    const data = new Uint8Array([0xab]);
    const flat = serialiseAll(data);
    const segs = deserialiseSegments(flat);
    const result = reassembleMSC(segs);
    expect(result).not.toBeNull();
    if (!result) throw new Error('reassembleMSC returned null');
    expect(Array.from(result)).toEqual([0xab]);
  });

  it('100-byte payload reassembles to exact original bytes', () => {
    const data = makePayload(100);
    const flat = serialiseAll(data);
    const segs = deserialiseSegments(flat);
    const result = reassembleMSC(segs);
    expect(result).not.toBeNull();
    if (!result) throw new Error('reassembleMSC returned null');
    expect(Array.from(result)).toEqual(Array.from(data));
  });

  it('1500-byte payload full round-trip', () => {
    const data = makePayload(1500);
    const flat = serialiseAll(data);
    const segs = deserialiseSegments(flat);
    const result = reassembleMSC(segs);
    expect(result).not.toBeNull();
    if (!result) throw new Error('reassembleMSC returned null');
    expect(Array.from(result)).toEqual(Array.from(data));
  });

  it('returns null when a segment is missing', () => {
    const data = makePayload(2000);
    const segs = segmentMSC(data);
    // Provide only the first segment (missing segs 1 and 2)
    const result = reassembleMSC([segs[0]]);
    expect(result).toBeNull();
  });

  it('returns null for empty segment list', () => {
    expect(reassembleMSC([])).toBeNull();
  });

  it('returns null when CRC is corrupted', () => {
    const data = makePayload(50);
    const segs = segmentMSC(data);
    // Corrupt the CRC of the only segment
    const corrupted = { ...segs[0], crc: segs[0].crc ^ 0x1234 };
    const result = reassembleMSC([corrupted]);
    expect(result).toBeNull();
  });
});

// ── FAC encode / decode ────────────────────────────────────────────────────────

describe('encodeFAC / decodeFAC', () => {
  it('encodeFAC produces 72 bits', () => {
    const bits = encodeFAC();
    expect(bits).toHaveLength(72);
  });

  it('decodeFAC returns non-null for a freshly encoded FAC word', () => {
    const bits = encodeFAC();
    const params = decodeFAC(bits);
    expect(params).not.toBeNull();
  });

  it('decodeFAC returns correct mode (B)', () => {
    const params = decodeFAC(encodeFAC());
    expect(params?.mode).toBe('B');
  });

  it('decodeFAC returns correct spectrum occupancy (SO_0)', () => {
    const params = decodeFAC(encodeFAC());
    expect(params?.specOccupancy).toBe('SO_0');
  });

  it('decodeFAC returns correct MSC QAM order (16)', () => {
    const params = decodeFAC(encodeFAC());
    expect(params?.mscQam).toBe(16);
  });

  it('decodeFAC returns null when CRC bit is flipped', () => {
    const bits = encodeFAC();
    bits[64] = bits[64] ^ 1; // flip first CRC bit
    expect(decodeFAC(bits)).toBeNull();
  });

  it('decodeFAC returns null for too-short input', () => {
    expect(decodeFAC(new Array(10).fill(0))).toBeNull();
  });
});

// ── SDC encode / decode ────────────────────────────────────────────────────────

describe('encodeSDC / decodeSDC', () => {
  it('encodeSDC returns a Uint8Array', () => {
    const result = encodeSDC(1000);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('decodeSDC returns correct payload length', () => {
    const sdc = encodeSDC(12345);
    const params = decodeSDC(sdc);
    expect(params).not.toBeNull();
    expect(params?.payloadBytes).toBe(12345);
  });

  it('decodeSDC returns correct MIME type', () => {
    const sdc = encodeSDC(1000, 'image/jpeg');
    const params = decodeSDC(sdc);
    expect(params?.mimeType).toBe('image/jpeg');
  });

  it('decodeSDC returns null when CRC is corrupted', () => {
    const sdc = encodeSDC(1000);
    sdc[sdc.length - 1] ^= 0xff; // corrupt last CRC byte
    expect(decodeSDC(sdc)).toBeNull();
  });

  it('decodeSDC returns null for too-short input', () => {
    expect(decodeSDC(new Uint8Array([0x00, 0x01]))).toBeNull();
  });
});
