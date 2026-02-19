import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerDecodeRequest, WorkerOutboundMessage } from '../types.js';
import { DecoderPanel } from './DecoderPanel.js';

const GOOD_PIXELS = new Uint8ClampedArray(320 * 240 * 4).fill(128);

// Minimal JPEG: SOI + APP0 marker + EOI
const MINIMAL_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);

const GOOD_RESULT: WorkerOutboundMessage = {
  type: 'result',
  pixels: GOOD_PIXELS,
  width: 320,
  height: 240,
  jpegBytes: MINIMAL_JPEG,
  diagnostics: {
    mode: 'DRM Mode B',
    sampleRate: 48000,
    fileDuration: '2.50s',
    freqOffset: 0,
    transmissionMode: 'B',
    spectrumOccupancy: 'SO_0',
    fecRate: '1/2',
    snrDb: 22.5,
    framesDecoded: 6,
    segmentErrors: 0,
    decodeTimeMs: 850,
    quality: {
      rAvg: 128,
      gAvg: 128,
      bAvg: 128,
      brightness: 128,
      verdict: 'good' as const,
      warnings: [],
    },
  },
};

let nextWorkerResult: WorkerOutboundMessage = GOOD_RESULT;
const workerConstructorArgs: ConstructorParameters<typeof Worker>[] = [];
const workerPostMessageArgs: WorkerDecodeRequest[] = [];

function makeMockWorker() {
  let messageHandler: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null = null;
  return class MockWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      workerConstructorArgs.push(args);
    }
    set onmessage(handler: (event: MessageEvent<WorkerOutboundMessage>) => void) {
      messageHandler = handler;
    }
    set onerror(_handler: (event: ErrorEvent) => void) {
      /* intentional no-op */
    }
    postMessage(data: WorkerDecodeRequest, _transfer?: Transferable[]) {
      workerPostMessageArgs.push(data);
      const result = nextWorkerResult;
      Promise.resolve().then(() => {
        messageHandler?.({ data: result } as MessageEvent<WorkerOutboundMessage>);
      });
    }
    terminate() {
      /* intentional no-op */
    }
  };
}

function makeMockAudioContext(sampleRate = 48000) {
  return class MockAudioContext {
    sampleRate = sampleRate;
    decodeAudioData(_buffer: ArrayBuffer) {
      const samples = new Float32Array(sampleRate);
      return Promise.resolve({
        sampleRate,
        getChannelData: (_ch: number) => samples,
      });
    }
    close() {
      return Promise.resolve();
    }
  };
}

const noop = vi.fn();

describe('DecoderPanel', () => {
  beforeEach(() => {
    nextWorkerResult = GOOD_RESULT;
    workerConstructorArgs.length = 0;
    workerPostMessageArgs.length = 0;
    vi.stubGlobal('Worker', makeMockWorker());
    vi.stubGlobal('AudioContext', makeMockAudioContext());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/wav' })),
      })
    );
    // Stub createImageBitmap so the main-thread JPEG decode path works in tests
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4, height: 4, close: () => undefined })
    );
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the drop zone by default', () => {
    render(<DecoderPanel onResult={noop} onError={noop} onReset={noop} />);
    expect(screen.getByText(/Decoder/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('calls onTriggerConsumed after triggerUrl decode completes', async () => {
    const onTriggerConsumed = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onTriggerConsumed={onTriggerConsumed}
        onResult={noop}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onTriggerConsumed).toHaveBeenCalled();
    });
  });

  it('calls onResult with a PNG data URL after triggerUrl resolves', async () => {
    const onResult = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={onResult}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) })
      );
    });
  });

  it('scrolls into view when triggerUrl is set', async () => {
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={noop}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });
    });
  });

  it('calls onError when fetch fails for triggerUrl', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const onError = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/bad.wav"
        onResult={noop}
        onError={onError}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Network error');
    });
  });

  it('calls onError when worker returns an error message', async () => {
    nextWorkerResult = { type: 'error', message: 'Worker decode error' };
    const onError = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={noop}
        onError={onError}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Worker decode error');
    });
  });

  it('does not auto-decode when triggerUrl is null', () => {
    render(<DecoderPanel triggerUrl={null} onResult={noop} onError={noop} onReset={noop} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('instantiates Worker with a URL object', async () => {
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={noop}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(workerConstructorArgs.length).toBeGreaterThan(0);
    });

    const [scriptUrl] = workerConstructorArgs[0] ?? [];
    expect(scriptUrl).toBeInstanceOf(URL);
    expect((scriptUrl as URL).href).toMatch(/decoderWorker/);
  });

  it('posts samples and sampleRate to worker', async () => {
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={noop}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(workerPostMessageArgs.length).toBeGreaterThan(0);
    });

    const msg = workerPostMessageArgs[0];
    expect(msg?.type).toBe('decode');
    expect(msg?.samples).toBeInstanceOf(Float32Array);
    expect(msg?.sampleRate).toBe(48000);
  });

  it('uses createImageBitmap to decode jpegBytes from worker result', async () => {
    const onResult = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={onResult}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalled();
    });
  });

  it('falls back to placeholder pixels when jpegBytes is absent', async () => {
    nextWorkerResult = { ...GOOD_RESULT, jpegBytes: undefined };
    const onResult = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/iss-test.wav"
        onResult={onResult}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) })
      );
    });
    // createImageBitmap should NOT have been called (no jpegBytes to decode)
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('decodes MP3 files via AudioContext on the main thread', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        blob: () => Promise.resolve(new Blob(['mp3data'], { type: 'audio/mpeg' })),
      })
    );
    const onResult = vi.fn();
    render(
      <DecoderPanel
        triggerUrl="examples/space-comms.mp3"
        onResult={onResult}
        onError={noop}
        onReset={noop}
      />
    );

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringMatching(/^data:image\/png;base64,/) })
      );
    });
  });
});
