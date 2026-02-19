import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RATE } from './drmConstants.js';
import { analyzeImageQuality, DRMDecoder } from './drmDecoder.js';
import { DRMEncoder } from './drmEncoder.js';

/** Build a tiny image File using node-canvas (mocked in setup.ts). */
function makeTinyImageFile(): File {
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  ctx.fillStyle = '#4080c0';
  ctx.fillRect(0, 0, 8, 8);
  let jpegBlob: Blob | null = null;
  canvas.toBlob(
    (b) => {
      jpegBlob = b;
    },
    'image/jpeg',
    0.5
  );
  if (!jpegBlob) throw new Error('toBlob did not fire synchronously');
  return new File([jpegBlob], 'test.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
  const noop = () => undefined;
  vi.stubGlobal('createImageBitmap', async () => ({ width: 8, height: 8, close: noop }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return { drawImage: noop };
      }
      convertToBlob(): Promise<Blob> {
        const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);
        return Promise.resolve(new Blob([fakeJpeg], { type: 'image/jpeg' }));
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Parse a WAV blob to a Float32Array of samples. */
async function wavToFloat32(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const dataSizeBytes = view.getUint32(40, true);
  const numSamples = dataSizeBytes / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  }
  return samples;
}

describe('DRMDecoder', () => {
  it('can be constructed with default sample rate', () => {
    const decoder = new DRMDecoder();
    expect(decoder).toBeDefined();
  });

  it('can be constructed with a custom sample rate', () => {
    const decoder = new DRMDecoder(48000);
    expect(decoder).toBeDefined();
  });

  it('decodeSamples returns a DecodeImageResult with required fields', () => {
    const decoder = new DRMDecoder(SAMPLE_RATE);
    // Feed a short burst of noise
    const noise = new Float32Array(SAMPLE_RATE * 2).map(() => Math.random() * 0.1 - 0.05);
    const result = decoder.decodeSamples(noise);

    expect(result).toHaveProperty('pixels');
    expect(result).toHaveProperty('width');
    expect(result).toHaveProperty('height');
    expect(result).toHaveProperty('diagnostics');
    expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('diagnostics contains all required DRM fields', () => {
    const decoder = new DRMDecoder(SAMPLE_RATE);
    const noise = new Float32Array(SAMPLE_RATE).fill(0);
    const { diagnostics } = decoder.decodeSamples(noise);

    expect(diagnostics).toHaveProperty('mode');
    expect(diagnostics).toHaveProperty('sampleRate');
    expect(diagnostics).toHaveProperty('fileDuration');
    expect(diagnostics).toHaveProperty('framesDecoded');
    expect(diagnostics).toHaveProperty('segmentErrors');
    expect(diagnostics).toHaveProperty('snrDb');
    expect(diagnostics).toHaveProperty('transmissionMode');
    expect(diagnostics).toHaveProperty('spectrumOccupancy');
    expect(diagnostics).toHaveProperty('fecRate');
    expect(diagnostics).toHaveProperty('decodeTimeMs');
  });

  it('diagnostics.sampleRate reflects the input sample rate', () => {
    const decoder = new DRMDecoder(44100);
    const silence = new Float32Array(44100);
    const { diagnostics } = decoder.decodeSamples(silence);
    expect(diagnostics.sampleRate).toBe(44100);
  });

  it('framesDecoded is at least 1 when given sufficient input', () => {
    const decoder = new DRMDecoder(SAMPLE_RATE);
    // Provide at least one full DRM frame of samples (4800 samples + guard)
    const input = new Float32Array(SAMPLE_RATE * 2).fill(0);
    const { diagnostics } = decoder.demodFrameCount(input);
    expect(diagnostics).toBeGreaterThanOrEqual(1);
  });

  it('round-trip: encode then decode produces non-null pixel result', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const wav = await encoder.encodeImage(file);
    const samples = await wavToFloat32(wav);

    const decoder = new DRMDecoder(SAMPLE_RATE);
    const result = decoder.decodeSamples(samples);

    // Pixels should be non-empty (decode ran, even if imperfect)
    expect(result.pixels.length).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    // At least one frame was processed
    expect(result.diagnostics.framesDecoded).toBeGreaterThan(0);
  });
});

describe('analyzeImageQuality', () => {
  it('returns bad verdict for all-black pixels', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(0);
    // Set alpha to 255
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const q = analyzeImageQuality(pixels, 4, 4);
    expect(q.verdict).toBe('bad');
    expect(q.brightness).toBe(0);
  });

  it('returns good verdict for balanced grey pixels', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 128; // R
      pixels[i + 1] = 128; // G
      pixels[i + 2] = 128; // B
      pixels[i + 3] = 255; // A
    }
    const q = analyzeImageQuality(pixels, 4, 4);
    expect(q.verdict).toBe('good');
    expect(q.rAvg).toBe(128);
    expect(q.gAvg).toBe(128);
    expect(q.bAvg).toBe(128);
  });

  it('returns bad for empty pixel array', () => {
    const q = analyzeImageQuality(new Uint8ClampedArray(0), 0, 0);
    expect(q.verdict).toBe('bad');
    expect(q.warnings.length).toBeGreaterThan(0);
  });
});

// Helper to expose framesDecoded count without going through full API
declare module './drmDecoder.js' {
  interface DRMDecoder {
    demodFrameCount(samples: Float32Array): { diagnostics: number };
  }
}
// Monkey-patch for test
DRMDecoder.prototype.demodFrameCount = function (this: DRMDecoder, samples: Float32Array) {
  const result = this.decodeSamples(samples);
  return { diagnostics: result.diagnostics.framesDecoded };
};
