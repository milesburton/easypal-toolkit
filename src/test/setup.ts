import '@testing-library/jest-dom';
import { Canvas, Image } from 'canvas';

(global as unknown as Record<string, unknown>).HTMLCanvasElement = Canvas;
(global as unknown as Record<string, unknown>).Image = Image;

const originalCreateElement = document.createElement.bind(document);
document.createElement = (tagName: string, options?: ElementCreationOptions) => {
  if (tagName.toLowerCase() === 'canvas') {
    return new Canvas(300, 150) as unknown as HTMLElement;
  }
  return originalCreateElement(tagName, options);
};

(Canvas.prototype as unknown as Record<string, unknown>).toBlob = function (
  callback: BlobCallback,
  type = 'image/png',
  _quality = 0.92
) {
  const buffer = (this as InstanceType<typeof Canvas>).toBuffer(
    (type.split('/')[1] ?? 'png') as 'png' | 'jpeg'
  );
  const blob = new Blob([buffer], { type });
  callback(blob);
};

const blobRegistry = new WeakMap<Blob, string>();
let blobIdCounter = 0;

global.URL.createObjectURL = (blob: Blob) => {
  const blobId = `blob:test-${blobIdCounter++}`;
  blobRegistry.set(blob, blobId);
  (global as unknown as Record<string, unknown>).__blobData =
    (global as unknown as Record<string, Record<string, Blob>>).__blobData ?? {};
  (global as unknown as Record<string, Record<string, Blob>>).__blobData[blobId] = blob;
  return blobId;
};

global.URL.revokeObjectURL = () => {};

const OriginalImage = Image;
(global as unknown as Record<string, unknown>).Image = class extends OriginalImage {
  set src(value: string) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      const blob = (global as unknown as Record<string, Record<string, Blob>>).__blobData?.[value];
      if (blob) {
        blob.arrayBuffer().then((buffer) => {
          const base64 = Buffer.from(buffer).toString('base64');
          const dataUrl = `data:${blob.type};base64,${base64}`;
          super.src = dataUrl;
        });
      }
    } else {
      super.src = value;
    }
  }
};

(global as unknown as Record<string, unknown>).AudioContext = class {
  sampleRate = 44100;

  decodeAudioData(arrayBuffer: ArrayBuffer) {
    const channels = 1;
    const length = arrayBuffer.byteLength / 2;
    const sampleRate = 44100;

    const audioBuffer = {
      length,
      sampleRate,
      numberOfChannels: channels,
      duration: length / sampleRate,
      getChannelData: (_channel: number) => {
        const samples = new Float32Array(length);
        const view = new DataView(arrayBuffer);

        for (let i = 0; i < length; i++) {
          const sample = view.getInt16(i * 2, true);
          samples[i] = sample / 32768.0;
        }

        return samples;
      },
    };

    return Promise.resolve(audioBuffer);
  }
};

(global as unknown as Record<string, unknown>).webkitAudioContext = (
  global as unknown as Record<string, unknown>
).AudioContext;
