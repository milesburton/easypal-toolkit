import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecodeState, WorkerOutboundMessage } from '../types.js';
import { DropZone } from './DropZone.js';

interface Props {
  triggerUrl?: string | null;
  onTriggerConsumed?: () => void;
  onResult: (result: DecodeState) => void;
  onError: (msg: string) => void;
  onReset: () => void;
}

const AudioIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
  >
    <title>Audio file</title>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

async function decodeAudioBuffer(buffer: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  const AudioCtx = window.AudioContext ?? (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API is not available in this browser.');
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(buffer);
    return { samples: audioBuffer.getChannelData(0), sampleRate: audioBuffer.sampleRate };
  } finally {
    await ctx.close();
  }
}

function decodeWithWorker(samples: Float32Array, sampleRate: number): Promise<WorkerOutboundMessage> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../workers/decoderWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      resolve({ type: 'error', message: event.message ?? 'Worker error' });
    };
    worker.postMessage({ type: 'decode', samples, sampleRate }, [samples.buffer]);
  });
}

function pixelsToDataUrl(pixels: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function DecoderPanel({ triggerUrl, onTriggerConsumed, onResult, onError, onReset }: Props) {
  const [processing, setProcessing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const runDecode = useCallback(
    async (file: File) => {
      setProcessing(true);
      onReset();
      try {
        const buffer = await file.arrayBuffer();
        const { samples, sampleRate } = await decodeAudioBuffer(buffer);
        const msg = await decodeWithWorker(samples, sampleRate);

        if (msg.type === 'error') {
          onError(msg.message);
        } else {
          const imageUrl = pixelsToDataUrl(msg.pixels, msg.width, msg.height);
          onResult({
            url: imageUrl,
            filename: `sstv_decoded_${Date.now()}.png`,
            diagnostics: msg.diagnostics,
          });
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Decoding failed');
      } finally {
        setProcessing(false);
      }
    },
    [onResult, onError, onReset]
  );

  const decodeUrl = useCallback(
    async (url: string) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], url.split('/').pop() ?? 'audio', { type: blob.type });
        await runDecode(file);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Decoding failed');
        setProcessing(false);
      } finally {
        onTriggerConsumed?.();
      }
    },
    [runDecode, onError, onTriggerConsumed]
  );

  useEffect(() => {
    if (!triggerUrl) return;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    decodeUrl(triggerUrl);
  }, [triggerUrl, decodeUrl]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('audio/')) {
      onError('Please select an audio file (WAV, MP3, etc.)');
      return;
    }
    runDecode(file);
  };

  return (
    <div ref={panelRef} className="bg-transparent">
      <div className="text-center mb-6 pb-5 border-b border-white/10">
        <h2 className="text-white text-xl font-semibold tracking-wide">Decoder</h2>
      </div>

      <div className="mb-5 h-9 flex items-center justify-center gap-3 text-sm">
        <p className="text-white/50 text-xs uppercase tracking-wider font-medium">
          Automatic mode detection via VIS code
        </p>
      </div>

      <DropZone
        accept="audio/*"
        onFile={handleFile}
        processing={processing}
        icon={<AudioIcon />}
        hint=""
        inputId="decode-input"
      />
    </div>
  );
}
