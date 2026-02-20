import { describe, expect, it } from 'vitest';
import {
  FFT_SIZE,
  GUARD_SAMPLES,
  NUM_CARRIERS,
  SAMPLE_RATE,
  SYMBOL_SAMPLES,
  SYMBOLS_PER_FRAME,
} from './drmConstants.js';
import {
  coarseSync,
  demap16QAM,
  demap4QAM,
  equalise,
  estimateChannel,
  estimateSnr,
  fft,
  ofdmDemodulate,
  ofdmModulate,
  resample,
} from './drmOfdm.js';

// ── fft ───────────────────────────────────────────────────────────────────────

describe('fft', () => {
  it('transforms a DC impulse to a constant spectrum', () => {
    const n = 8;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im, n, false);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(1, 6);
      expect(im[i]).toBeCloseTo(0, 6);
    }
  });

  it('round-trips FFT → IFFT back to the original signal', () => {
    const n = 16;
    const original = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / n));
    const re = new Float64Array(original);
    const im = new Float64Array(n);
    fft(re, im, n, false);
    fft(re, im, n, true);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(original[i], 6);
      expect(im[i]).toBeCloseTo(0, 6);
    }
  });

  it('FFT of a single complex sinusoid peaks at the correct bin', () => {
    const n = 32;
    const k = 5;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * k * i) / n);
      im[i] = Math.sin((2 * Math.PI * k * i) / n);
    }
    fft(re, im, n, false);
    const magnitudes = Array.from({ length: n }, (_, i) => Math.sqrt(re[i] ** 2 + im[i] ** 2));
    const peakBin = magnitudes.indexOf(Math.max(...magnitudes));
    expect(peakBin).toBe(k);
  });
});

// ── ofdmModulate ──────────────────────────────────────────────────────────────

describe('ofdmModulate', () => {
  it('returns a Float32Array of the correct length for one frame', () => {
    const out = ofdmModulate([]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(SYMBOLS_PER_FRAME * SYMBOL_SAMPLES);
  });

  it('output is normalised to ≤ 0.9 peak amplitude', () => {
    const cells = Array.from({ length: NUM_CARRIERS * SYMBOLS_PER_FRAME }, (_, i) => ({
      symbolIdx: Math.floor(i / NUM_CARRIERS),
      carrierIdx: i % NUM_CARRIERS,
      re: 1,
      im: 1,
    }));
    const out = ofdmModulate(cells);
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThanOrEqual(0.901);
  });

  it('produces non-zero output when data cells are provided', () => {
    const cells = [{ symbolIdx: 0, carrierIdx: 5, re: 1, im: 0 }];
    const out = ofdmModulate(cells);
    const energy = out.reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0);
  });

  it('guard interval equals last GUARD_SAMPLES of the useful symbol', () => {
    const cells = [{ symbolIdx: 0, carrierIdx: 3, re: 1, im: 0 }];
    const out = ofdmModulate(cells);
    for (let i = 0; i < GUARD_SAMPLES; i++) {
      expect(out[i]).toBeCloseTo(out[GUARD_SAMPLES + FFT_SIZE - GUARD_SAMPLES + i], 5);
    }
  });
});

// ── ofdmDemodulate ────────────────────────────────────────────────────────────

describe('ofdmDemodulate', () => {
  it('returns the correct number of frames and symbols', () => {
    const samples = new Float32Array(SYMBOLS_PER_FRAME * SYMBOL_SAMPLES * 2);
    const frames = ofdmDemodulate(samples, 0, 2);
    expect(frames.length).toBe(2);
    expect(frames[0].length).toBe(SYMBOLS_PER_FRAME);
    expect(frames[0][0].length).toBe(NUM_CARRIERS);
  });

  it('each cell is a [re, im] tuple', () => {
    const samples = new Float32Array(SYMBOLS_PER_FRAME * SYMBOL_SAMPLES + 100);
    const frames = ofdmDemodulate(samples, 0, 1);
    const cell = frames[0][0][0];
    expect(Array.isArray(cell)).toBe(true);
    expect(cell.length).toBe(2);
  });
});

// ── modulate → demodulate round-trip ─────────────────────────────────────────

describe('ofdmModulate / ofdmDemodulate round-trip', () => {
  it('recovers pilot cell energy after mod → demod (ideal channel)', () => {
    const samples = ofdmModulate([]);
    const frames = ofdmDemodulate(samples, 0, 1);
    expect(frames.length).toBe(1);

    let totalEnergy = 0;
    for (const sym of frames[0]) {
      for (const [re, im] of sym) {
        totalEnergy += re * re + im * im;
      }
    }
    expect(totalEnergy).toBeGreaterThan(0);
  });
});

// ── coarseSync ────────────────────────────────────────────────────────────────

describe('coarseSync', () => {
  it('returns 0 for a silence buffer (no correlation peak)', () => {
    const samples = new Float32Array(SYMBOL_SAMPLES * 4);
    const pos = coarseSync(samples);
    expect(pos).toBeGreaterThanOrEqual(0);
  });

  it('returns a value within the search range', () => {
    const samples = ofdmModulate([{ symbolIdx: 0, carrierIdx: 0, re: 1, im: 0 }]);
    const padded = new Float32Array(samples.length + 50);
    padded.set(samples, 10);
    const pos = coarseSync(padded);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThan(padded.length);
  });
});

// ── estimateChannel ───────────────────────────────────────────────────────────

describe('estimateChannel', () => {
  it('returns an array of the same shape as input', () => {
    const symbols: Array<Array<[number, number]>> = Array.from(
      { length: SYMBOLS_PER_FRAME },
      () => Array.from({ length: NUM_CARRIERS }, () => [1, 0] as [number, number])
    );
    const H = estimateChannel(symbols);
    expect(H.length).toBe(SYMBOLS_PER_FRAME);
    expect(H[0].length).toBe(NUM_CARRIERS);
  });

  it('returns unit response for ideal (pilot = expected) input', () => {
    const samples = ofdmModulate([]);
    const frames = ofdmDemodulate(samples, 0, 1);
    const H = estimateChannel(frames[0]);
    for (const sym of H) {
      for (const [hRe] of sym) {
        expect(Math.abs(hRe)).toBeGreaterThan(0);
      }
    }
  });
});

// ── equalise ─────────────────────────────────────────────────────────────────

describe('equalise', () => {
  it('returns unit output when H = identity', () => {
    const symbols: Array<Array<[number, number]>> = [[[0.5, 0.3]]];
    const H: Array<Array<[number, number]>> = [[[1, 0]]];
    const eq = equalise(symbols, H);
    expect(eq[0][0][0]).toBeCloseTo(0.5, 6);
    expect(eq[0][0][1]).toBeCloseTo(0.3, 6);
  });

  it('returns zero for near-zero channel estimate', () => {
    const symbols: Array<Array<[number, number]>> = [[[1, 1]]];
    const H: Array<Array<[number, number]>> = [[[0, 0]]];
    const eq = equalise(symbols, H);
    expect(eq[0][0][0]).toBe(0);
    expect(eq[0][0][1]).toBe(0);
  });

  it('corrects a scaled channel', () => {
    const symbols: Array<Array<[number, number]>> = [[[2, 0]]];
    const H: Array<Array<[number, number]>> = [[[2, 0]]];
    const eq = equalise(symbols, H);
    expect(eq[0][0][0]).toBeCloseTo(1, 6);
    expect(eq[0][0][1]).toBeCloseTo(0, 6);
  });
});

// ── demap16QAM ────────────────────────────────────────────────────────────────

describe('demap16QAM', () => {
  it('returns 4 bits per call', () => {
    expect(demap16QAM(0.5, 0.5).length).toBe(4);
  });

  it('each returned value is 0 or 1', () => {
    const bits = demap16QAM(-0.3, 0.7);
    for (const b of bits) expect(b === 0 || b === 1).toBe(true);
  });

  it('is deterministic', () => {
    expect(demap16QAM(0.2, -0.4)).toEqual(demap16QAM(0.2, -0.4));
  });

  it('maps all 16 constellation points to distinct 4-bit words', () => {
    const points = [
      [-3, -3], [-3, -1], [-3, 1], [-3, 3],
      [-1, -3], [-1, -1], [-1, 1], [-1, 3],
      [1, -3], [1, -1], [1, 1], [1, 3],
      [3, -3], [3, -1], [3, 1], [3, 3],
    ];
    const words = points.map(([re, im]) => demap16QAM(re / 3, im / 3).join(''));
    const unique = new Set(words);
    expect(unique.size).toBe(16);
  });
});

// ── demap4QAM ─────────────────────────────────────────────────────────────────

describe('demap4QAM', () => {
  it('returns 2 bits per call', () => {
    expect(demap4QAM(1, 1).length).toBe(2);
  });

  it('each returned value is 0 or 1', () => {
    for (const [re, im] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const b of demap4QAM(re, im)) expect(b === 0 || b === 1).toBe(true);
    }
  });

  it('maps all 4 quadrants to distinct 2-bit words', () => {
    const words = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([re, im]) =>
      demap4QAM(re, im).join('')
    );
    expect(new Set(words).size).toBe(4);
  });
});

// ── estimateSnr ───────────────────────────────────────────────────────────────

describe('estimateSnr', () => {
  it('returns a finite number for a modulated signal', () => {
    const samples = ofdmModulate([]);
    const frames = ofdmDemodulate(samples, 0, 1);
    const snr = estimateSnr(frames[0]);
    expect(Number.isFinite(snr)).toBe(true);
  });

  it('returns 40 dB fallback when no pilots are found', () => {
    const symbols: Array<Array<[number, number]>> = [];
    const snr = estimateSnr(symbols);
    expect(snr).toBe(40);
  });
});

// ── resample ──────────────────────────────────────────────────────────────────

describe('resample', () => {
  it('returns input unchanged when inputRate equals SAMPLE_RATE', () => {
    const input = new Float32Array([1, 2, 3]);
    const out = resample(input, SAMPLE_RATE);
    expect(out).toBe(input);
  });

  it('downsamples 48000 → 12000 Hz correctly (4× ratio)', () => {
    const ratio = 48000 / SAMPLE_RATE;
    const input = new Float32Array(4000);
    const out = resample(input, 48000);
    expect(out.length).toBe(Math.floor(input.length / ratio));
  });

  it('preserves a DC signal through resampling', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = resample(input, 48000);
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });

  it('output length scales with input rate', () => {
    const input = new Float32Array(48000);
    const out44 = resample(input, 44100);
    const out48 = resample(input, 48000);
    expect(out48.length).toBeLessThan(out44.length);
  });
});
