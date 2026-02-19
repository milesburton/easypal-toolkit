import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RATE, SYMBOL_SAMPLES } from './drmConstants.js';
import { DRMEncoder } from './drmEncoder.js';

/**
 * Build a tiny image File using a regular canvas (mocked via node-canvas in setup.ts).
 * OffscreenCanvas is not available in the happy-dom test environment.
 */
function makeTinyImageFile(): File {
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 8, 8);
  // node-canvas toBlob is synchronous via the setup.ts shim
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

  // Mock OffscreenCanvas for the encoder's internal image-to-JPEG pipeline
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
        // Return a minimal valid JPEG stub (SOI + EOI markers)
        const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);
        return Promise.resolve(new Blob([fakeJpeg], { type: 'image/jpeg' }));
      }
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DRMEncoder', () => {
  it('encodeImage returns a Blob', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const result = await encoder.encodeImage(file);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(44);
  });

  it('encodeImage output is a valid WAV file (RIFF header)', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const blob = await encoder.encodeImage(file);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getUint32(0, false)).toBe(0x52494646); // "RIFF"
    expect(view.getUint32(8, false)).toBe(0x57415645); // "WAVE"
    expect(view.getUint32(12, false)).toBe(0x666d7420); // "fmt "
  });

  it('WAV is encoded at 12 000 Hz sample rate', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const blob = await encoder.encodeImage(file);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
  });

  it('WAV is 16-bit mono PCM', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const blob = await encoder.encodeImage(file);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
  });

  it('output length is a whole number of OFDM symbols', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const blob = await encoder.encodeImage(file);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const numSamples = view.getUint32(40, true) / 2; // 16-bit samples
    expect(numSamples % SYMBOL_SAMPLES).toBe(0);
  });

  it('PCM samples are within [-1, 1] range', async () => {
    const file = makeTinyImageFile();
    const encoder = new DRMEncoder();
    const blob = await encoder.encodeImage(file);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const numSamples = view.getUint32(40, true) / 2;
    let maxVal = 0;
    for (let i = 0; i < numSamples; i++) {
      maxVal = Math.max(maxVal, Math.abs(view.getInt16(44 + i * 2, true) / 32768));
    }
    expect(maxVal).toBeLessThanOrEqual(1.0);
    expect(maxVal).toBeGreaterThan(0.01);
  });
});
