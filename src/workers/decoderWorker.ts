import type { WorkerDecodeRequest, WorkerOutboundMessage } from '../types.js';
import { DRMDecoder } from '../utils/drmDecoder.js';

self.onmessage = (event: MessageEvent<WorkerDecodeRequest>) => {
  const { samples, sampleRate } = event.data;

  try {
    const decoder = new DRMDecoder(sampleRate);
    const result = decoder.decodeSamples(samples);

    const msg: WorkerOutboundMessage = {
      type: 'result',
      pixels: result.pixels,
      width: result.width,
      height: result.height,
      diagnostics: result.diagnostics,
      jpegBytes: result.jpegBytes,
    };

    const transferables: Transferable[] = [result.pixels.buffer];
    if (result.jpegBytes) transferables.push(result.jpegBytes.buffer);
    self.postMessage(msg, transferables);
  } catch (err) {
    const msg: WorkerOutboundMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : 'Decoding failed',
    };
    self.postMessage(msg);
  }
};
