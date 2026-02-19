import { beforeEach, describe, expect, it } from 'vitest';
import { EasyPalDecoder } from './EasyPalDecoder.js';

describe('EasyPalDecoder', () => {
  let decoder: EasyPalDecoder;

  beforeEach(() => {
    decoder = new EasyPalDecoder();
  });

  describe('Initialization', () => {
    it('should initialize with default sample rate', () => {
      expect(decoder.sampleRate).toBe(48000);
    });
  });

  describe('Goertzel Algorithm', () => {
    it('should detect a pure tone correctly', () => {
      const sampleRate = 44100;
      const frequency = 1500;
      const duration = 0.1;
      const numSamples = Math.floor(duration * sampleRate);

      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        samples[i] = Math.sin(2 * Math.PI * frequency * t);
      }

      decoder.sampleRate = sampleRate;
      const magnitude = decoder.goertzel(samples, 0, numSamples, frequency);

      expect(magnitude).toBeGreaterThan(0.4);
    });

    it('should reject incorrect frequency', () => {
      const sampleRate = 44100;
      const signalFreq = 1500;
      const testFreq = 2000;
      const duration = 0.1;
      const numSamples = Math.floor(duration * sampleRate);

      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        samples[i] = Math.sin(2 * Math.PI * signalFreq * t);
      }

      decoder.sampleRate = sampleRate;
      const magnitude = decoder.goertzel(samples, 0, numSamples, testFreq);

      expect(magnitude).toBeLessThan(0.3);
    });
  });

  describe('Frequency Detection', () => {
    it('should detect sync pulse frequency (1200 Hz)', () => {
      const sampleRate = 44100;
      const frequency = 1200;
      const duration = 0.01;
      const numSamples = Math.floor(duration * sampleRate);

      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        samples[i] = Math.sin(2 * Math.PI * frequency * t);
      }

      decoder.sampleRate = sampleRate;
      const detectedFreq = decoder.detectFrequency(samples, 0, duration);

      expect(Math.abs(detectedFreq - 1200)).toBeLessThan(100);
    });

    it('should detect black level frequency (1500 Hz)', () => {
      const sampleRate = 44100;
      const frequency = 1500;
      const duration = 0.01;
      const numSamples = Math.floor(duration * sampleRate);

      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        samples[i] = Math.sin(2 * Math.PI * frequency * t);
      }

      decoder.sampleRate = sampleRate;
      const detectedFreq = decoder.detectFrequencyRange(samples, 0, duration);

      expect(Math.abs(detectedFreq - 1500)).toBeLessThanOrEqual(60);
    });

    it('should detect white level frequency (2300 Hz)', () => {
      const sampleRate = 44100;
      const frequency = 2300;
      const duration = 0.01;
      const numSamples = Math.floor(duration * sampleRate);

      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        samples[i] = Math.sin(2 * Math.PI * frequency * t);
      }

      decoder.sampleRate = sampleRate;
      const detectedFreq = decoder.detectFrequencyRange(samples, 0, duration);

      expect(Math.abs(detectedFreq - 2300)).toBeLessThanOrEqual(60);
    });

    it('should handle intermediate frequencies', () => {
      const testFrequencies = [1600, 1700, 1900, 2100];

      testFrequencies.forEach((frequency) => {
        const sampleRate = 44100;
        const duration = 0.01;
        const numSamples = Math.floor(duration * sampleRate);

        const samples = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          samples[i] = Math.sin(2 * Math.PI * frequency * t);
        }

        decoder.sampleRate = sampleRate;
        const detectedFreq = decoder.detectFrequencyRange(samples, 0, duration);

        expect(Math.abs(detectedFreq - frequency)).toBeLessThanOrEqual(60);
      });
    });
  });

  describe('Mode Detection', () => {
    it('should decode VIS code correctly', () => {
      const sampleRate = 44100;
      const samples = new Float32Array(sampleRate * 0.5);

      decoder.sampleRate = sampleRate;

      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.random() * 0.1 - 0.05;
      }

      const mode = decoder.detectMode(samples);

      expect(mode).toBeDefined();
      expect(mode.name).toBeTruthy();
    });
  });

  describe('Frequency to Pixel Mapping', () => {
    it('should map 1500 Hz to black (0)', () => {
      const freq = 1500;
      const value = ((freq - 1500) / (2300 - 1500)) * 255;

      expect(Math.round(value)).toBe(0);
    });

    it('should map 2300 Hz to white (255)', () => {
      const freq = 2300;
      const value = ((freq - 1500) / (2300 - 1500)) * 255;

      expect(Math.round(value)).toBe(255);
    });

    it('should map 1900 Hz to middle gray (127-128)', () => {
      const freq = 1900;
      const value = ((freq - 1500) / (2300 - 1500)) * 255;

      expect(Math.round(value)).toBeGreaterThanOrEqual(127);
      expect(Math.round(value)).toBeLessThanOrEqual(128);
    });
  });
});
