export interface DecodeDiagnostics {
  mode: string;
  sampleRate: number;
  fileDuration: string | null;
  decodeTimeMs: number;
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
