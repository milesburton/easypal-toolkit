import type { WorkerDecodeRequest, WorkerOutboundMessage } from '../types.js';

self.onmessage = (_event: MessageEvent<WorkerDecodeRequest>) => {
  const msg: WorkerOutboundMessage = {
    type: 'error',
    message: 'EasyPal decoder not yet implemented.',
  };
  self.postMessage(msg);
};
