export interface ImageQuality {
  rAvg: number;
  gAvg: number;
  bAvg: number;
  brightness: number;
  verdict: 'good' | 'warn' | 'bad';
  warnings: string[];
}

export interface DecodeDiagnostics {
  /** Human-readable mode name, e.g. "DRM Mode B". */
  mode: string;
  sampleRate: number;
  fileDuration: string | null;
  /** Estimated carrier frequency offset in Hz. */
  freqOffset: number;
  /** DRM robustness mode letter, e.g. "B". */
  transmissionMode: string | null;
  /** Spectrum occupancy identifier, e.g. "SO_0". */
  spectrumOccupancy: string | null;
  /** Effective FEC code rate, e.g. "1/2". */
  fecRate: string | null;
  /** Estimated SNR in dB (from pilot cells). */
  snrDb: number | null;
  /** Number of OFDM frames successfully demodulated. */
  framesDecoded: number;
  /** Number of MSC segments that failed CRC. */
  segmentErrors: number;
  decodeTimeMs: number | null;
  quality: ImageQuality | null;
}

export interface DecodeResult {
  imageUrl: string;
  diagnostics: DecodeDiagnostics;
}

export interface DecodeImageResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  diagnostics: DecodeDiagnostics;
}

export interface WorkerDecodeRequest {
  type: 'decode';
  samples: Float32Array;
  sampleRate: number;
}

export interface WorkerResultMessage {
  type: 'result';
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  diagnostics: DecodeDiagnostics;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerOutboundMessage = WorkerResultMessage | WorkerErrorMessage;

export interface EncodeResult {
  url: string;
  filename: string;
  /** Mode description, e.g. "DRM Mode B SO_0". */
  mode: string;
  width: number;
  /** Duration of the encoded audio. */
  expectedDuration: string;
  /** File size of the WAV output. */
  fileSize: string;
  /** JPEG payload size. */
  jpegSize: string;
}

export interface DecodeState {
  url: string;
  filename: string;
  diagnostics: DecodeDiagnostics;
}

export interface GalleryEntry {
  name: string;
  audioFile: string;
  imageFile: string;
  mode: string;
  quality: 'good' | 'warn' | 'bad';
}
