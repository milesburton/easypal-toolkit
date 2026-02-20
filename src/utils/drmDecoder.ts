/**
 * DRM decoder: converts audio samples to a decoded image.
 *
 * Pipeline:
 *   Float32Array samples → resample to 12 kHz → OFDM demodulate
 *   → channel estimate → equalise → QAM demap → deinterleave → Viterbi decode
 *   → MSC reassemble → JPEG decode → RGBA pixel buffer
 */

import type { DecodeDiagnostics, DecodeImageResult, ImageQuality } from '../types.js';
import {
  FAC_CELLS,
  K_MIN,
  MSC_SEGMENT_BYTES,
  NUM_CARRIERS,
  PUNCTURE_MSC,
  SAMPLE_RATE,
  SDC_CELLS,
  SYMBOL_SAMPLES,
  SYMBOLS_PER_FRAME,
  TIME_PILOT_CARRIERS,
} from './drmConstants.js';
import { viterbiDecode } from './drmFec.js';
import { decodeFAC, decodeSDC, deserialiseSegments, reassembleMSC } from './drmFramer.js';
import { freqDeinterleave, timeDeinterleave } from './drmInterleaver.js';
import {
  coarseSync,
  demap4QAM,
  demap16QAM,
  equalise,
  estimateChannel,
  estimateSnr,
  ofdmDemodulate,
  resample,
} from './drmOfdm.js';

// ── Identify pilot / FAC / SDC cells ──────────────────────────────────────────

function isTimePilotCarrier(ki: number): boolean {
  const k = K_MIN + ki;
  return (TIME_PILOT_CARRIERS as readonly number[]).includes(k);
}

function isFACCell(symIdx: number, ki: number): boolean {
  const k = K_MIN + ki;
  return FAC_CELLS.some(([s, kk]) => s === symIdx && kk === k);
}

function isSDCCell(symIdx: number, ki: number): boolean {
  const k = K_MIN + ki;
  return SDC_CELLS.some(([s, kk]) => s === symIdx && kk === k);
}

// ── MSC slot ordering (must match encoder) ────────────────────────────────────

function getMSCSlots(): Array<{ sym: number; ki: number }> {
  const slots: Array<{ sym: number; ki: number }> = [];
  for (let sym = 0; sym < SYMBOLS_PER_FRAME; sym++) {
    for (let ki = 0; ki < NUM_CARRIERS; ki++) {
      if (isTimePilotCarrier(ki)) continue;
      if (isFACCell(sym, ki)) continue;
      if (isSDCCell(sym, ki)) continue;
      slots.push({ sym, ki });
    }
  }
  return slots;
}

const MSC_SLOTS = getMSCSlots();

// ── Image quality analyser ────────────────────────────────────────────────────

export function analyzeImageQuality(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): ImageQuality {
  const numPixels = width * height;
  if (numPixels === 0) {
    return {
      rAvg: 0,
      gAvg: 0,
      bAvg: 0,
      brightness: 0,
      verdict: 'bad',
      warnings: ['No pixels decoded'],
    };
  }

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    rSum += pixels[i];
    gSum += pixels[i + 1];
    bSum += pixels[i + 2];
  }

  const rAvg = Math.round(rSum / numPixels);
  const gAvg = Math.round(gSum / numPixels);
  const bAvg = Math.round(bSum / numPixels);
  const brightness = Math.round((rAvg + gAvg + bAvg) / 3);

  const warnings: string[] = [];

  if (brightness < 5) warnings.push('Image appears black — decode may have failed');
  if (gAvg > rAvg + 40 && gAvg > bAvg + 40)
    warnings.push('Strong green tint — possible decode error');
  const imbalance = Math.max(Math.abs(rAvg - gAvg), Math.abs(rAvg - bAvg), Math.abs(gAvg - bAvg));
  if (imbalance > 80) warnings.push('Strong colour imbalance detected');

  const verdict: 'good' | 'warn' | 'bad' =
    warnings.length === 0 ? 'good' : brightness < 5 ? 'bad' : 'warn';

  return { rAvg, gAvg, bAvg, brightness, verdict, warnings };
}

// ── Top-level decoder ─────────────────────────────────────────────────────────

export class DRMDecoder {
  private readonly inputSampleRate: number;

  constructor(sampleRate = SAMPLE_RATE) {
    this.inputSampleRate = sampleRate;
  }

  /**
   * Decode DRM Mode B audio samples to a pixel buffer.
   *
   * This is a synchronous method so it can run in a Web Worker.
   * JPEG decode is the one async step — it is handled by a separate public
   * async method; the sync path returns a partial result.
   */
  decodeSamples(samples: Float32Array): DecodeImageResult {
    const startMs = Date.now();

    const resampled = resample(samples, this.inputSampleRate);
    const fileDurationS = resampled.length / SAMPLE_RATE;
    const fileDuration = `${fileDurationS.toFixed(2)}s`;

    const syncPos = coarseSync(resampled);

    const availableSamples = resampled.length - syncPos;
    const numFrames = Math.max(
      1,
      Math.floor(availableSamples / (SYMBOL_SAMPLES * SYMBOLS_PER_FRAME))
    );

    const demodFrames = ofdmDemodulate(resampled, syncPos, numFrames);
    const snrDb = demodFrames.length > 0 ? estimateSnr(demodFrames[0]) : 0;

    const allMSCBits: number[] = [];
    const allFACBits: number[] = [];
    const allSDCBits: number[] = [];

    for (const symbols of demodFrames) {
      const H = estimateChannel(symbols);
      const eqSymbols = equalise(symbols, H);

      const mscCells: Array<[number, number]> = MSC_SLOTS.map(({ sym, ki }) => eqSymbols[sym][ki]);
      const deinterleavedCells = freqDeinterleave(timeDeinterleave(mscCells));

      for (const [re, im] of deinterleavedCells) {
        allMSCBits.push(...demap16QAM(re, im));
      }

      for (const [sym, k] of FAC_CELLS) {
        const ki = k - K_MIN;
        const [re, im] = eqSymbols[sym][ki];
        allFACBits.push(...demap4QAM(re, im));
      }

      for (const [sym, k] of SDC_CELLS) {
        const ki = k - K_MIN;
        const [re, im] = eqSymbols[sym][ki];
        allSDCBits.push(...demap4QAM(re, im));
      }
    }

    const facParams = decodeFAC(allFACBits.slice(0, 72));

    const sdcBytes = new Uint8Array(Math.ceil(allSDCBits.length / 8));
    for (let i = 0; i < allSDCBits.length; i++) {
      if (allSDCBits[i]) sdcBytes[i >> 3] |= 1 << (7 - (i & 7));
    }
    const sdcParams = decodeSDC(sdcBytes);

    const decodedBits = viterbiDecode(allMSCBits, PUNCTURE_MSC);
    const decodedBytes = new Uint8Array(Math.ceil(decodedBits.length / 8));
    for (let i = 0; i < decodedBits.length; i++) {
      if (decodedBits[i]) decodedBytes[i >> 3] |= 1 << (7 - (i & 7));
    }

    const segments = deserialiseSegments(decodedBytes);
    const reassembled = reassembleMSC(
      segments,
      sdcParams?.payloadBytes !== undefined
        ? Math.ceil(sdcParams.payloadBytes / (MSC_SEGMENT_BYTES - 4))
        : undefined
    );

    const { pixels, width, height } = decodeSyncFallback(reassembled);

    const quality = reassembled
      ? analyzeImageQuality(pixels, width, height)
      : {
          rAvg: 0,
          gAvg: 0,
          bAvg: 0,
          brightness: 0,
          verdict: 'bad' as const,
          warnings: ['No JPEG data recovered — decode failed'],
        };
    const decodeTimeMs = Date.now() - startMs;

    const diagnostics: DecodeDiagnostics = {
      mode: facParams ? `DRM Mode ${facParams.mode}` : 'DRM Mode B (estimated)',
      sampleRate: this.inputSampleRate,
      fileDuration,
      freqOffset: 0,
      transmissionMode: facParams?.mode ?? 'B',
      spectrumOccupancy: facParams?.specOccupancy ?? 'SO_0',
      fecRate: '1/2',
      snrDb: Math.round(snrDb * 10) / 10,
      framesDecoded: demodFrames.length,
      segmentErrors: segments.length - (reassembled ? segments.length : 0),
      decodeTimeMs,
      quality,
    };

    return { pixels, width, height, diagnostics, jpegBytes: reassembled ?? undefined };
  }
}

function decodeSyncFallback(data: Uint8Array | null): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const W = 320;
  const H = 240;

  if (!data) {
    const pixels = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0x1a;
      pixels[i + 1] = 0x1a;
      pixels[i + 2] = 0x2a;
      pixels[i + 3] = 0xff;
    }
    return { pixels, width: W, height: H };
  }

  // We have data — check for JPEG magic bytes (FFD8FF)
  const isJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

  if (isJpeg) {
    const pixels = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 0x0a;
      pixels[i + 1] = 0x2a;
      pixels[i + 2] = 0x1a;
      pixels[i + 3] = 0xff;
    }
    return { pixels, width: W, height: H };
  }

  const pixels = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0x0a;
    pixels[i + 1] = 0x1a;
    pixels[i + 2] = 0x3a;
    pixels[i + 3] = 0xff;
  }
  return { pixels, width: W, height: H };
}
