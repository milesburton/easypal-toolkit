/**
 * DRM (Digital Radio Mondiale) Mode B, Spectrum Occupancy 0 constants.
 *
 * These correspond to the EasyPal/HamDRM amateur radio profile:
 *   - Robustness Mode B (optimised for time-invariant HF channels)
 *   - SO_0: ~2.3 kHz occupied bandwidth
 *   - 16-QAM on MSC, 4-QAM on FAC
 *   - Short interleaving (400 ms)
 *
 * Reference: ETSI ES 201 980 v4.1.1, QSSTV source (ON4QZ), Dream DRM receiver.
 */

// ── Physical layer ────────────────────────────────────────────────────────────

/** Sample rate used internally for DRM processing (12 000 Hz). */
export const SAMPLE_RATE = 12_000;

/**
 * Useful (IFFT) symbol length in samples.
 * Mode B: Tu = 21.33 ms → 256 samples at 12 kHz.
 */
export const FFT_SIZE = 256;

/**
 * Guard interval in samples.
 * Mode B: Tg = Tu/4 → 64 samples.
 */
export const GUARD_SAMPLES = 64;

/** Total OFDM symbol length = Tu + Tg. */
export const SYMBOL_SAMPLES = FFT_SIZE + GUARD_SAMPLES; // 320

/** Number of OFDM symbols per DRM transmission frame (400 ms). */
export const SYMBOLS_PER_FRAME = 15;

/** Number of samples per transmission frame at SAMPLE_RATE. */
export const FRAME_SAMPLES = SYMBOLS_PER_FRAME * SYMBOL_SAMPLES; // 4 800

/** Number of frames per super-frame. */
export const FRAMES_PER_SUPERFRAME = 3;

/** Subcarrier spacing in Hz: fs / Tu = 12000 / 256 ≈ 46.875 Hz. */
export const CARRIER_SPACING_HZ = SAMPLE_RATE / FFT_SIZE;

/**
 * Centre carrier frequency in the audio band (Hz).
 * DRM subcarrier k=0 is placed at this frequency.
 */
export const CARRIER_OFFSET_HZ = 1500;

/**
 * FFT bin index corresponding to CARRIER_OFFSET_HZ.
 * k=0 maps to bin = round(CARRIER_OFFSET_HZ / CARRIER_SPACING_HZ).
 */
export const CARRIER_BIN_OFFSET = Math.round(CARRIER_OFFSET_HZ / CARRIER_SPACING_HZ); // 32

// ── Active carrier range (SO_0, Mode B) ──────────────────────────────────────

/**
 * Lowest active subcarrier index (relative to k=0 at 1500 Hz).
 * SO_0 Mode B: K_min = -10.
 * Actual frequency = CARRIER_OFFSET_HZ + K_MIN * CARRIER_SPACING_HZ ≈ 1031 Hz.
 */
export const K_MIN = -10;

/**
 * Highest active subcarrier index.
 * SO_0 Mode B: K_max = 18.
 * Actual frequency ≈ 1500 + 18*46.875 ≈ 2344 Hz.
 */
export const K_MAX = 18;

/** Total number of active data + pilot subcarriers = K_MAX - K_MIN + 1 = 29. */
export const NUM_CARRIERS = K_MAX - K_MIN + 1; // 29

// ── Pilot cells (Mode B, SO_0) ────────────────────────────────────────────────

/**
 * Time pilot subcarrier positions within the active carrier range.
 * In DRM Mode B SO_0 the time pilots are at relative subcarrier indices:
 *   k = -9, -3, 4, 8, 12  (5 pilots per symbol, spec table 75).
 * Stored as absolute subcarrier indices (relative to k=0).
 */
export const TIME_PILOT_CARRIERS = [-9, -3, 4, 8, 12] as const;

/**
 * Frequency pilot cells: [symbolIndex, carrierIndex] pairs.
 * These are fixed reference cells scattered across the frame.
 * Mode B uses 2 frequency pilots per frame at specific (symbol, carrier) pairs.
 * Simplified set adequate for channel estimation in this implementation.
 */
export const FREQ_PILOT_CELLS: Array<[number, number]> = [
  [0, -9],
  [0, 8],
  [5, -3],
  [5, 12],
  [10, 4],
  [14, -9],
  [14, 8],
];

/**
 * Boost factor applied to pilot cells relative to data cells.
 * DRM spec: pilots transmitted at +2.5 dB → amplitude ratio ≈ 1.33.
 */
export const PILOT_BOOST = Math.sqrt(2); // ≈ 1.414 (conservative)

// ── FAC channel layout (Mode B) ───────────────────────────────────────────────

/**
 * FAC uses 2 cells per frame in symbol 0.
 * (k, symbol) pairs where k is relative subcarrier index.
 * Simplified fixed position: symbols 0 and 1, carrier k=-7 and k=6.
 */
export const FAC_CELLS: Array<[number, number]> = [
  [0, -7],
  [0, 6],
];

/** Number of FAC bits per frame (64 data + 8 CRC = 72). */
export const FAC_BITS = 72;

// ── SDC channel layout ────────────────────────────────────────────────────────

/**
 * SDC occupies symbol 0, carriers k=-6 to k=-8 and k=7 to k=9.
 * Simplified: 6 cells in symbol 0.
 */
export const SDC_CELLS: Array<[number, number]> = [
  [0, -6],
  [0, -5],
  [0, -4],
  [0, 7],
  [0, 9],
  [0, 10],
];

/** Bits per SDC cell (4-QAM → 2 bits per cell). */
export const SDC_BITS_PER_CELL = 2;

/** Total SDC bits available per frame. */
export const SDC_BITS = SDC_CELLS.length * SDC_BITS_PER_CELL; // 12

// ── QAM constellations ────────────────────────────────────────────────────────

/** 4-QAM (QPSK) constellation. Gray-coded, normalised to unit average power. */
export const QAM4_CONSTELLATION: ReadonlyArray<[number, number]> = [
  [+1, +1],
  [-1, +1],
  [-1, -1],
  [+1, -1],
].map(([i, q]) => [i / Math.SQRT2, q / Math.SQRT2]) as Array<[number, number]>;

/**
 * 16-QAM constellation. Gray-coded, normalised to unit average power.
 * Points at (±1, ±3) and (±3, ±1) → power = (1²+3²)/2 = 5 per axis → scale by 1/√10.
 */
const QAM16_SCALE = 1 / Math.sqrt(10);
export const QAM16_CONSTELLATION: ReadonlyArray<[number, number]> = (() => {
  const pts: Array<[number, number]> = [];
  // Gray code order: row MSB bit, col LSB bit
  const vals = [-3, -1, 1, 3];
  const grayRow = [0, 1, 3, 2]; // Gray code for rows (Q axis)
  const grayCol = [0, 1, 3, 2]; // Gray code for cols (I axis)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const symbol = (grayRow[row] << 2) | grayCol[col];
      pts[symbol] = [vals[col] * QAM16_SCALE, vals[row] * QAM16_SCALE];
    }
  }
  return pts;
})();

// ── Forward error correction ──────────────────────────────────────────────────

/**
 * Convolutional code generator polynomials (octal), rate 1/6, constraint length 7.
 * From ETSI ES 201 980 Table 75 / Dream source.
 */
export const CONV_POLYNOMIALS = [0o133, 0o171, 0o145, 0o165, 0o117, 0o135] as const;

/** Constraint length K = 7, so 2^(K-1) = 64 states. */
export const CONV_STATES = 64;

/**
 * Puncturing pattern for FAC (effective rate ≈ 1/2).
 * 1 = keep output bit, 0 = discard.
 * Pattern length = 6 (one per polynomial output per input bit).
 */
export const PUNCTURE_FAC = [1, 1, 0, 1, 1, 0] as const;

/**
 * Puncturing pattern for MSC at protection level A (effective rate ≈ 1/2).
 */
export const PUNCTURE_MSC = [1, 1, 0, 1, 0, 0] as const;

/**
 * Puncturing pattern for SDC (effective rate ≈ 2/3).
 */
export const PUNCTURE_SDC = [1, 1, 0, 0, 0, 0] as const;

// ── MSC framing ───────────────────────────────────────────────────────────────

/** Maximum payload bytes per MSC segment. */
export const MSC_SEGMENT_BYTES = 800;

/** Header size per MSC segment in bytes. */
export const MSC_SEGMENT_HEADER_BYTES = 4;
