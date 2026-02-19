import { useState } from 'react';
import type { EncodeResult } from '../types.js';
import { DRMEncoder } from '../utils/drmEncoder.js';
import { DropZone } from './DropZone.js';

interface Props {
  onResult: (result: EncodeResult) => void;
  onError: (msg: string) => void;
  onReset: () => void;
}

const ImageIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
  >
    <title>Image file</title>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export function EncoderPanel({ onResult, onError, onReset }: Props) {
  const [processing, setProcessing] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError('Please select an image file (JPG, PNG, etc.)');
      return;
    }
    setProcessing(true);
    onReset();
    try {
      const encoder = new DRMEncoder();
      const blob = await encoder.encodeImage(file);

      // Get image dimensions and JPEG size for display
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const jpegSize = await new Promise<number>((resolve) => {
        if (!ctx) {
          resolve(0);
          return;
        }
        createImageBitmap(file).then((bmp) => {
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          canvas.toBlob((b) => resolve(b?.size ?? 0), 'image/jpeg', 0.8);
        });
      });

      const durationS = blob.size / (12000 * 2); // rough: 12 kHz 16-bit mono

      onResult({
        url: URL.createObjectURL(blob),
        filename: `drm_encoded_${Date.now()}.wav`,
        mode: 'DRM Mode B · SO_0 · 16-QAM',
        width,
        expectedDuration: `${durationS.toFixed(1)}s`,
        fileSize: `${(blob.size / 1024).toFixed(0)} KB`,
        jpegSize: `${(jpegSize / 1024).toFixed(0)} KB`,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Encoding failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-transparent">
      <div className="text-center mb-6 pb-5 border-b border-white/10">
        <h2 className="text-white text-xl font-semibold tracking-wide">Encoder</h2>
        <p className="text-white/40 text-xs mt-1">DRM Mode B · OFDM · 16-QAM</p>
        <p className="text-amber-400/60 text-xs mt-1">
          ⚠️ Best-effort — uses JPEG (not JPEG2000); may not be receivable by EasyPal
        </p>
      </div>

      <div className="mb-5 h-9 flex items-center justify-center">
        <p className="text-white/50 text-xs uppercase tracking-wider font-medium">
          Drop an image to encode as DRM audio
        </p>
      </div>

      <DropZone
        accept="image/*"
        onFile={handleFile}
        processing={processing}
        icon={<ImageIcon />}
        hint=""
        inputId="encode-input"
      />
    </div>
  );
}
