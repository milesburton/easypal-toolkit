/**
 * DRM FAC / SDC / MSC channel framing.
 *
 * Handles:
 *  - FAC encoding/decoding (Fast Access Channel – 64-bit header + 8-bit CRC)
 *  - SDC encoding/decoding (Service Description Channel – service metadata)
 *  - MSC segmentation / reassembly (Main Service Channel – file payload)
 *
 * This implements a simplified subset of ETSI ES 201 980 adequate for
 * self-consistent encode/decode of JPEG image payloads.
 *
 * Reference: ETSI ES 201 980 §6, §7; QSSTV drmtx/common/FAC/, SDC/, DataIO.
 */

import { FAC_BITS, MSC_SEGMENT_BYTES, MSC_SEGMENT_HEADER_BYTES } from './drmConstants.js';
import { crc8, crc16, packBits, unpackBits } from './drmFec.js';

// ── FAC ───────────────────────────────────────────────────────────────────────

export interface FACParams {
  /** DRM robustness mode string, e.g. "B". */
  mode: string;
  /** Spectrum occupancy identifier, e.g. "SO_0". */
  specOccupancy: string;
  /** MSC QAM order: 4 or 16. */
  mscQam: 4 | 16;
  /** Interleaver depth in frames (1 = short). */
  interleaveDepth: number;
  /** Number of audio/data services. */
  numServices: number;
  /** Service type: 0 = audio, 1 = data. */
  serviceType: number;
}

/**
 * Encode FAC bits for Mode B, SO_0, 16-QAM, short interleaver, 1 data service.
 * Returns 72 bits (64 data + 8-bit CRC).
 */
export function encodeFAC(): number[] {
  const bits = new Array<number>(64).fill(0);

  // Bit layout (simplified from ETSI ES 201 980 Table 60):
  // [0-1]   Robustness mode: 01 = Mode B
  // [2-4]   Spectrum occupancy: 000 = SO_0
  // [5]     Interleaver depth: 0 = short (1 frame)
  // [6-8]   MSC mode: 011 = 16-QAM, protection level 0
  // [9-11]  SDC mode: 001 = 4-QAM
  // [12-13] Number of services – 1: 00 = 1 service
  // [14]    MSC / audio flag: 0 = audio/data, 1 = data only → 1
  // [15-20] Audio coding, SBR, AC channel: don't care for data → 0
  // [21-27] Service identifier (arbitrary): 0x01 → 0000001
  // [28-31] Language: 0000 (not specified)
  // [32-35] Programme type: 0000 (not specified)
  // [36-39] Country code: 0000
  // [40-63] Reserved: 0

  bits[0] = 0;
  bits[1] = 1; // Mode B
  bits[2] = 0;
  bits[3] = 0;
  bits[4] = 0; // SO_0
  bits[5] = 0; // short interleaver
  bits[6] = 0;
  bits[7] = 1;
  bits[8] = 1; // 16-QAM MSC
  bits[9] = 0;
  bits[10] = 0;
  bits[11] = 1; // 4-QAM SDC
  bits[12] = 0;
  bits[13] = 0; // 1 service
  bits[14] = 1; // data service
  bits[21] = 0;
  bits[22] = 0;
  bits[23] = 0;
  bits[24] = 0;
  bits[25] = 0;
  bits[26] = 0;
  bits[27] = 1; // service ID = 1

  const bytes = packBits(bits);
  const crc = crc8(bytes);
  const crcBits = unpackBits(new Uint8Array([crc]), 8);

  return [...bits, ...crcBits];
}

/**
 * Decode FAC bits. Returns null if CRC check fails.
 */
export function decodeFAC(bits: number[]): FACParams | null {
  if (bits.length < FAC_BITS) return null;

  const dataBits = bits.slice(0, 64);
  const receivedCrc = bits.slice(64, 72);

  const bytes = packBits(dataBits);
  const computed = crc8(bytes);
  const computedBits = unpackBits(new Uint8Array([computed]), 8);

  const crcOk = computedBits.every((b, i) => b === receivedCrc[i]);
  if (!crcOk) return null;

  const modeCode = (dataBits[0] << 1) | dataBits[1];
  const modeNames = ['A', 'B', 'C', 'D'];
  const mode = modeNames[modeCode] ?? 'B';

  const so = (dataBits[2] << 2) | (dataBits[3] << 1) | dataBits[4];
  const specOccupancy = `SO_${so}`;

  const interleaveDepth = dataBits[5] === 0 ? 1 : 6;

  const mscMode = (dataBits[6] << 2) | (dataBits[7] << 1) | dataBits[8];
  const mscQam: 4 | 16 = mscMode >= 3 ? 16 : 4;

  const numServices = ((dataBits[12] << 1) | dataBits[13]) + 1;
  const serviceType = dataBits[14];

  return { mode, specOccupancy, mscQam, interleaveDepth, numServices, serviceType };
}

// ── SDC ───────────────────────────────────────────────────────────────────────

export interface SDCParams {
  /** Total byte length of the MSC payload. */
  payloadBytes: number;
  /** MIME type string (e.g. "image/jpeg"). */
  mimeType: string;
}

/** Maximum byte length encodeable in SDC with this layout. */
const SDC_MAX_PAYLOAD_BYTES = 0xffffff; // 24-bit field

/**
 * Encode SDC for a data service carrying `payloadBytes` of JPEG data.
 * Returns a Uint8Array to be embedded in the SDC channel cells.
 */
export function encodeSDC(payloadBytes: number, mimeType = 'image/jpeg'): Uint8Array {
  // Simplified SDC layout:
  // Bytes 0-2: payload byte length (24-bit big-endian)
  // Bytes 3-N: null-terminated MIME type string (max 32 chars)
  const mimeBytes = new TextEncoder().encode(mimeType.slice(0, 32));
  const sdc = new Uint8Array(3 + mimeBytes.length + 1);
  const clampedLen = Math.min(payloadBytes, SDC_MAX_PAYLOAD_BYTES);
  sdc[0] = (clampedLen >> 16) & 0xff;
  sdc[1] = (clampedLen >> 8) & 0xff;
  sdc[2] = clampedLen & 0xff;
  sdc.set(mimeBytes, 3);
  sdc[3 + mimeBytes.length] = 0; // null terminator

  // Append CRC-16
  const withoutCrc = sdc;
  const crc = crc16(withoutCrc);
  const result = new Uint8Array(sdc.length + 2);
  result.set(sdc);
  result[sdc.length] = (crc >> 8) & 0xff;
  result[sdc.length + 1] = crc & 0xff;
  return result;
}

/**
 * Decode SDC bytes. Returns null if CRC fails.
 */
export function decodeSDC(data: Uint8Array): SDCParams | null {
  if (data.length < 5) return null;

  const payload = data.slice(0, data.length - 2);
  const receivedCrc = (data[data.length - 2] << 8) | data[data.length - 1];
  const computed = crc16(payload);

  if (computed !== receivedCrc) return null;

  const payloadBytes = (payload[0] << 16) | (payload[1] << 8) | payload[2];

  // Find null terminator for MIME string
  let end = 3;
  while (end < payload.length && payload[end] !== 0) end++;
  const mimeType = new TextDecoder().decode(payload.slice(3, end));

  return { payloadBytes, mimeType };
}

// ── MSC segmentation ──────────────────────────────────────────────────────────

export interface MSCSegment {
  /** Segment number (0-based). */
  segNo: number;
  /** Total number of segments. */
  totalSegments: number;
  /** Whether this is the last segment. */
  isLast: boolean;
  /** Payload bytes (without header). */
  data: Uint8Array;
  /** CRC-16 of header + data. */
  crc: number;
}

/**
 * Split `fileData` into MSC segments with headers and CRC.
 */
export function segmentMSC(fileData: Uint8Array): MSCSegment[] {
  const segments: MSCSegment[] = [];
  const totalBytes = fileData.length;
  const maxPayload = MSC_SEGMENT_BYTES - MSC_SEGMENT_HEADER_BYTES;
  const totalSegments = Math.max(1, Math.ceil(totalBytes / maxPayload));

  for (let i = 0; i < totalSegments; i++) {
    const start = i * maxPayload;
    const end = Math.min(start + maxPayload, totalBytes);
    const data = fileData.slice(start, end);

    // Header: [segNo hi, segNo lo, totalSegs hi, totalSegs lo]
    const header = new Uint8Array(MSC_SEGMENT_HEADER_BYTES);
    header[0] = (i >> 8) & 0xff;
    header[1] = i & 0xff;
    header[2] = (totalSegments >> 8) & 0xff;
    header[3] = totalSegments & 0xff;

    const combined = new Uint8Array(header.length + data.length);
    combined.set(header);
    combined.set(data, header.length);
    const crc = crc16(combined);

    segments.push({
      segNo: i,
      totalSegments,
      isLast: i === totalSegments - 1,
      data,
      crc,
    });
  }

  return segments;
}

/**
 * Reassemble MSC segments back into a file.
 * Returns null if any segment is missing or has a CRC error.
 */
export function reassembleMSC(segments: MSCSegment[], expectedTotal?: number): Uint8Array | null {
  if (segments.length === 0) return null;

  const total = expectedTotal ?? segments[0].totalSegments;

  // Sort and deduplicate by segNo
  const map = new Map<number, MSCSegment>();
  for (const seg of segments) {
    // Verify CRC
    const header = new Uint8Array(MSC_SEGMENT_HEADER_BYTES);
    header[0] = (seg.segNo >> 8) & 0xff;
    header[1] = seg.segNo & 0xff;
    header[2] = (seg.totalSegments >> 8) & 0xff;
    header[3] = seg.totalSegments & 0xff;

    const combined = new Uint8Array(header.length + seg.data.length);
    combined.set(header);
    combined.set(seg.data, header.length);
    const crc = crc16(combined);

    if (crc !== seg.crc) continue; // discard corrupt segments
    if (!map.has(seg.segNo)) map.set(seg.segNo, seg);
  }

  // Check all segments present
  if (map.size < total) return null;

  const sorted = Array.from({ length: total }, (_, i) => map.get(i)).filter(
    (s): s is MSCSegment => s !== undefined
  );

  if (sorted.length < total) return null;

  const totalBytes = sorted.reduce((acc, s) => acc + s.data.length, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const seg of sorted) {
    result.set(seg.data, offset);
    offset += seg.data.length;
  }

  return result;
}

/**
 * Serialise a single MSCSegment to bytes for embedding in the MSC bitstream.
 * Format: [header (4 bytes)] [data] [CRC hi] [CRC lo]
 */
export function serialiseSegment(seg: MSCSegment): Uint8Array {
  const buf = new Uint8Array(MSC_SEGMENT_HEADER_BYTES + seg.data.length + 2);
  buf[0] = (seg.segNo >> 8) & 0xff;
  buf[1] = seg.segNo & 0xff;
  buf[2] = (seg.totalSegments >> 8) & 0xff;
  buf[3] = seg.totalSegments & 0xff;
  buf.set(seg.data, MSC_SEGMENT_HEADER_BYTES);
  buf[buf.length - 2] = (seg.crc >> 8) & 0xff;
  buf[buf.length - 1] = seg.crc & 0xff;
  return buf;
}

/**
 * Deserialise bytes from the MSC bitstream back into MSCSegment objects.
 */
export function deserialiseSegments(data: Uint8Array): MSCSegment[] {
  const segments: MSCSegment[] = [];
  let pos = 0;

  while (pos + MSC_SEGMENT_HEADER_BYTES + 2 <= data.length) {
    const segNo = (data[pos] << 8) | data[pos + 1];
    const totalSegments = (data[pos + 2] << 8) | data[pos + 3];
    pos += MSC_SEGMENT_HEADER_BYTES;

    // Compute how much data is in this segment
    const maxPayload = MSC_SEGMENT_BYTES - MSC_SEGMENT_HEADER_BYTES;
    const isLast = segNo === totalSegments - 1;
    const remainingDataBytes = data.length - pos - 2; // subtract trailing CRC
    const dataLen = Math.min(maxPayload, remainingDataBytes);

    if (dataLen <= 0) break;

    const segData = data.slice(pos, pos + dataLen);
    pos += dataLen;

    const crc = (data[pos] << 8) | data[pos + 1];
    pos += 2;

    segments.push({ segNo, totalSegments, isLast, data: segData, crc });
  }

  return segments;
}
