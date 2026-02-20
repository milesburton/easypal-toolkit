/**
 * DRM encoder: converts an image File to a DRM Mode B OFDM audio WAV.
 *
 * Pipeline:
 *   Image file → JPEG (Canvas API) → MSC segments → convolutional encode
 *   → interleave → 16-QAM map → cell-map → OFDM modulate → WAV blob
 */

import {
  FAC_CELLS,
  FRAMES_PER_SUPERFRAME,
  K_MIN,
  NUM_CARRIERS,
  PUNCTURE_MSC,
  QAM4_CONSTELLATION,
  QAM16_CONSTELLATION,
  SAMPLE_RATE,
  SDC_CELLS,
  SYMBOLS_PER_FRAME,
  TIME_PILOT_CARRIERS,
} from './drmConstants.js';
import { convEncode, unpackBits } from './drmFec.js';
import { encodeFAC, encodeSDC, segmentMSC, serialiseSegment } from './drmFramer.js';
import { freqInterleave, timeInterleave } from './drmInterleaver.js';
import { type OFDMCell, ofdmModulate } from './drmOfdm.js';

// ── JPEG image extraction ────────────────────────────────────────────────────

/**
 * Draw a File (image) to an offscreen canvas and return its JPEG bytes.
 */
async function imageFileToJpeg(file: File, quality = 0.8): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get OffscreenCanvas 2D context');

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}

// ── QAM mapping ──────────────────────────────────────────────────────────────

/** Map 4 bits → 16-QAM complex point. */
function map16QAM(bits: number[]): [number, number] {
  const sym = (bits[0] << 3) | (bits[1] << 2) | (bits[2] << 1) | bits[3];
  return QAM16_CONSTELLATION[sym % QAM16_CONSTELLATION.length];
}

/** Map 2 bits → 4-QAM (QPSK) complex point. */
function map4QAM(bits: number[]): [number, number] {
  const sym = (bits[0] << 1) | bits[1];
  return QAM4_CONSTELLATION[sym % QAM4_CONSTELLATION.length];
}

// ── MSC bitstream → OFDM data cells ──────────────────────────────────────────

/**
 * Determine which (symbolIdx, carrierIdx) pairs are available for MSC data
 * in a single frame (i.e. not occupied by pilots, FAC, or SDC).
 */
function getMSCSlots(): Array<{ sym: number; ki: number }> {
  const slots: Array<{ sym: number; ki: number }> = [];

  const facSet = new Set(FAC_CELLS.map(([sym, k]) => `${sym},${k}`));
  const sdcSet = new Set(SDC_CELLS.map(([sym, k]) => `${sym},${k}`));
  const timePilotSet = new Set(TIME_PILOT_CARRIERS);

  for (let sym = 0; sym < SYMBOLS_PER_FRAME; sym++) {
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      const k = K_MIN + ki;
      if (timePilotSet.has(k)) continue; // time pilot
      if (facSet.has(`${sym},${k}`)) continue; // FAC cell
      if (sdcSet.has(`${sym},${k}`)) continue; // SDC cell
      slots.push({ sym, ki });
    }
  }

  return slots;
}

const MSC_SLOTS = getMSCSlots();
const MSC_BITS_PER_FRAME = MSC_SLOTS.length * 4; // 16-QAM = 4 bits/cell

// ── WAV writer ────────────────────────────────────────────────────────────────

function writeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataBytes = numSamples * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataBytes, true);

  // PCM samples
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }

  return buffer;
}

// ── Top-level encoder ─────────────────────────────────────────────────────────

export class DRMEncoder {
  /**
   * Encode an image File as a DRM Mode B OFDM audio WAV blob.
   */
  async encodeImage(file: File): Promise<Blob> {
    // Step 1: JPEG-compress the image
    const jpegBytes = await imageFileToJpeg(file);

    // Step 2: Segment the JPEG data into MSC segments
    const segments = segmentMSC(jpegBytes);

    // Step 3: Serialise all segments into a flat payload byte array
    const payloadParts = segments.map(serialiseSegment);
    const totalLen = payloadParts.reduce((a, b) => a + b.length, 0);
    const payload = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of payloadParts) {
      payload.set(part, offset);
      offset += part.length;
    }

    // Step 4: Convolutional encode the payload
    const payloadBits = unpackBits(payload);
    const encodedMSC = convEncode(payloadBits, PUNCTURE_MSC);

    // Step 5: Distribute encoded bits across superframes
    const bitsPerSuperframe = MSC_BITS_PER_FRAME * FRAMES_PER_SUPERFRAME;
    const numSuperframes = Math.ceil(encodedMSC.length / bitsPerSuperframe);

    // Pad to a whole number of superframes
    const totalBitsNeeded = numSuperframes * bitsPerSuperframe;
    const paddedMSC = [...encodedMSC, ...new Array(totalBitsNeeded - encodedMSC.length).fill(0)];

    // Step 6: Build FAC bits
    const facBits = encodeFAC(); // 72 bits

    // Step 7: Build SDC bytes
    const sdcBytes = encodeSDC(jpegBytes.length);
    const sdcBits = unpackBits(sdcBytes);

    // Step 8: Render all frames to audio
    const allFrames: Float32Array[] = [];

    for (let sf = 0; sf < numSuperframes; sf++) {
      for (let f = 0; f < FRAMES_PER_SUPERFRAME; f++) {
        const frameNo = sf * FRAMES_PER_SUPERFRAME + f;
        const mscFrameBits = paddedMSC.slice(
          frameNo * MSC_BITS_PER_FRAME,
          (frameNo + 1) * MSC_BITS_PER_FRAME
        );

        // Interleave MSC bits (time interleaving across MSC_SLOTS)
        // Convert bits → complex cells first, then interleave
        const mscCells: Array<[number, number]> = [];
        for (let i = 0; i < MSC_SLOTS.length; i++) {
          const bits4 = mscFrameBits.slice(i * 4, i * 4 + 4);
          mscCells.push(map16QAM(bits4.length === 4 ? bits4 : [0, 0, 0, 0]));
        }

        const interleavedCells = timeInterleave(freqInterleave(mscCells));

        // Build OFDMCell list
        const dataCells: OFDMCell[] = [];

        // MSC cells
        for (let ci = 0; ci < MSC_SLOTS.length && ci < interleavedCells.length; ci++) {
          const { sym, ki } = MSC_SLOTS[ci];
          const [re, im] = interleavedCells[ci];
          dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
        }

        // FAC cells (4-QAM, 2 cells × 2 bits/cell = 4 FAC bits per frame).
        // Cycle through the full 72-bit FAC word across frames.
        const facBitsPerFrame = FAC_CELLS.length * 2;
        const facBitOffset = (frameNo * facBitsPerFrame) % facBits.length;
        for (let fi = 0; fi < FAC_CELLS.length; fi++) {
          const [sym, k] = FAC_CELLS[fi];
          const ki = k - K_MIN;
          const bits2 = facBits.slice(facBitOffset + fi * 2, facBitOffset + fi * 2 + 2);
          const [re, im] = map4QAM(bits2.length === 2 ? bits2 : [0, 0]);
          dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
        }

        // SDC cells (4-QAM, 6 cells × 2 bits/cell = 12 SDC bits per frame).
        // Spread the full SDC message across frames so the decoder can recover it.
        const sdcBitsPerFrame = SDC_CELLS.length * 2;
        const sdcBitOffset = (frameNo * sdcBitsPerFrame) % sdcBits.length;
        for (let si = 0; si < SDC_CELLS.length; si++) {
          const [sym, k] = SDC_CELLS[si];
          const ki = k - K_MIN;
          const bits2 = sdcBits.slice(sdcBitOffset + si * 2, sdcBitOffset + si * 2 + 2);
          const [re, im] = map4QAM(bits2.length === 2 ? bits2 : [0, 0]);
          dataCells.push({ symbolIdx: sym, carrierIdx: ki, re, im });
        }

        const frameSamples = ofdmModulate(dataCells);
        allFrames.push(frameSamples);
      }
    }

    // Step 9: Concatenate all frame samples
    const totalSamples = allFrames.reduce((a, b) => a + b.length, 0);
    const combined = new Float32Array(totalSamples);
    let pos = 0;
    for (const frame of allFrames) {
      combined.set(frame, pos);
      pos += frame.length;
    }

    // Step 10: Write WAV
    const wav = writeWAV(combined, SAMPLE_RATE);
    return new Blob([wav], { type: 'audio/wav' });
  }
}
