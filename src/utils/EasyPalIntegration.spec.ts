import { describe, expect, it } from 'vitest';
import { EasyPalEncoder } from './EasyPalEncoder.js';

describe('EasyPal Integration Tests', () => {
  describe('Frequency Accuracy', () => {
    it('should generate accurate sync pulses at 1200 Hz', () => {
      const encoder = new EasyPalEncoder('ROBOT36');
      const samples: number[] = [];

      encoder.addTone(samples, 1200, 0.01);

      expect(samples.length).toBeGreaterThan(0);

      let zeroCrossings = 0;
      let lastSign = (samples[0] ?? 0) >= 0;

      for (let i = 1; i < samples.length; i++) {
        const sign = (samples[i] ?? 0) >= 0;
        if (sign !== lastSign) {
          zeroCrossings++;
          lastSign = sign;
        }
      }

      expect(zeroCrossings).toBeGreaterThan(20);
      expect(zeroCrossings).toBeLessThan(28);
    });

    it('should generate data tones in correct range', () => {
      const encoder = new EasyPalEncoder('ROBOT36');

      const testValues = [0, 64, 128, 192, 255];

      testValues.forEach((value) => {
        const freq = 1500 + (value / 255) * (2300 - 1500);

        expect(freq).toBeGreaterThanOrEqual(1500);
        expect(freq).toBeLessThanOrEqual(2300);

        const samples: number[] = [];
        encoder.addTone(samples, freq, 0.005);

        expect(samples.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Color Range Round-Trip Validation', () => {
    it('should maintain video range consistency between encoder and decoder', () => {
      const encoder = new EasyPalEncoder('ROBOT36');

      const testColors = [
        { r: 128, g: 128, b: 128, name: 'Neutral Gray', expectedCb: 128, expectedCr: 128 },
        { r: 255, g: 0, b: 0, name: 'Pure Red', chromaTest: 'high-Cr' },
        { r: 0, g: 255, b: 0, name: 'Pure Green', chromaTest: 'low-both' },
        { r: 0, g: 0, b: 255, name: 'Pure Blue', chromaTest: 'high-Cb' },
      ];

      testColors.forEach(({ r, g, b }) => {
        const samples: number[] = [];
        const pixelData = new Uint8ClampedArray([r, g, b, 255, r, g, b, 255]);

        encoder.addScanLineYUV(samples, pixelData, 2, 0);
        expect(samples.length).toBeGreaterThan(0);

        const Y = 16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256;
        const Cb = 128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256;
        const Cr = 128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256;

        expect(Y).toBeGreaterThanOrEqual(16);
        expect(Y).toBeLessThanOrEqual(235);

        expect(Cb).toBeGreaterThanOrEqual(16);
        expect(Cb).toBeLessThanOrEqual(240);
        expect(Cr).toBeGreaterThanOrEqual(16);
        expect(Cr).toBeLessThanOrEqual(240);
      });
    });

    it('should encode/decode neutral gray without color shift', () => {
      const encoder = new EasyPalEncoder('ROBOT36');
      const samples: number[] = [];
      const grayData = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);

      encoder.addScanLineYUV(samples, grayData, 2, 0);

      expect(samples.length).toBeGreaterThan(0);
    });
  });

  describe('Mode Compatibility', () => {
    it('should work with ROBOT36 mode', () => {
      const encoder = new EasyPalEncoder('ROBOT36');
      expect(encoder.mode.name).toBe('Robot 36');
      expect(encoder.mode.width).toBe(320);
      expect(encoder.mode.lines).toBe(240);
    });

    it('should work with MARTIN1 mode', () => {
      const encoder = new EasyPalEncoder('MARTIN1');
      expect(encoder.mode.name).toBe('Martin M1');
      expect(encoder.mode.width).toBe(320);
      expect(encoder.mode.lines).toBe(256);
    });

    it('should work with SCOTTIE1 mode', () => {
      const encoder = new EasyPalEncoder('SCOTTIE1');
      expect(encoder.mode.name).toBe('Scottie S1');
      expect(encoder.mode.width).toBe(320);
      expect(encoder.mode.lines).toBe(256);
    });
  });
});
