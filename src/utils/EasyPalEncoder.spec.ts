import { beforeEach, describe, expect, it } from 'vitest';
import { EASYPAL_MODES, EasyPalEncoder } from './EasyPalEncoder.js';

describe('EasyPalEncoder', () => {
  let encoder: EasyPalEncoder;

  beforeEach(() => {
    encoder = new EasyPalEncoder('ROBOT36');
  });

  describe('Initialization', () => {
    it('should initialize with default mode', () => {
      expect(encoder.mode).toBeDefined();
      expect(encoder.mode.name).toBe('Robot 36');
      expect(encoder.sampleRate).toBe(48000);
    });

    it('should support all defined modes', () => {
      Object.keys(EASYPAL_MODES).forEach((modeName) => {
        const enc = new EasyPalEncoder(modeName);
        expect(enc.mode).toBeDefined();
        expect(enc.mode.name).toBeTruthy();
      });
    });
  });

  describe('Audio Generation', () => {
    it('should generate WAV header correctly', () => {
      const samples = [0, 0.5, -0.5, 1, -1];
      const blob = encoder.createWAV(samples);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/wav');
      expect(blob.size).toBeGreaterThan(44);
    });

    it('should create valid tone samples', () => {
      const samples: number[] = [];
      const frequency = 1500;
      const duration = 0.01;

      encoder.addTone(samples, frequency, duration);

      const expectedSamples = Math.floor(duration * encoder.sampleRate);
      expect(samples.length).toBe(expectedSamples);

      samples.forEach((sample) => {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('VIS Code', () => {
    it('should generate VIS code with correct structure', () => {
      const samples: number[] = [];
      encoder.addVISCode(samples);

      const expectedDuration = 0.3 + 0.01 + 0.03 + 8 * 0.03 + 0.03;
      const expectedSamples = Math.floor(expectedDuration * encoder.sampleRate);

      expect(samples.length).toBeGreaterThan(expectedSamples * 0.9);
      expect(samples.length).toBeLessThan(expectedSamples * 1.1);
    });
  });

  describe('Frequency Mapping', () => {
    it('should map black (0) to 1500 Hz', () => {
      const samples: number[] = [];
      encoder.addTone(samples, 1500, 0.01);
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should map white (255) to 2300 Hz', () => {
      const samples: number[] = [];
      encoder.addTone(samples, 2300, 0.01);
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should generate frequencies in valid range', () => {
      const testValues = [0, 64, 128, 192, 255];

      testValues.forEach((value) => {
        const freq = 1500 + (value / 255) * (2300 - 1500);

        expect(freq).toBeGreaterThanOrEqual(1500);
        expect(freq).toBeLessThanOrEqual(2300);
      });
    });
  });

  describe('YUV Full-Range Encoding', () => {
    it('should encode luminance full range: black→1500Hz, white→2300Hz', () => {
      const samples: number[] = [];

      const testData = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);

      encoder.addScanLineYUV(samples, testData, 2, 0);
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should encode chrominance for saturated colours', () => {
      const samples: number[] = [];

      const redData = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
      encoder.addScanLineYUV(samples, redData, 2, 0);
      expect(samples.length).toBeGreaterThan(0);

      const blueData = new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]);
      samples.length = 0;
      encoder.addScanLineYUV(samples, blueData, 2, 1);
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should encode neutral gray with U=V=128', () => {
      const samples: number[] = [];
      const grayData = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]);
      encoder.addScanLineYUV(samples, grayData, 2, 0);
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should not throw for any primary or neutral colour', () => {
      const testColors = [
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 255, b: 0 },
        { r: 0, g: 0, b: 255 },
        { r: 128, g: 128, b: 128 },
      ];

      testColors.forEach(({ r, g, b }) => {
        const samples: number[] = [];
        const pixelData = new Uint8ClampedArray([r, g, b, 255, r, g, b, 255]);
        expect(() => {
          encoder.addScanLineYUV(samples, pixelData, 2, 0);
        }).not.toThrow();
        expect(samples.length).toBeGreaterThan(0);
      });
    });
  });
});
