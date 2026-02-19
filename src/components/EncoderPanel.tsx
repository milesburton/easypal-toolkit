import { useState } from 'react';
import type { EncodeResult } from '../types.js';
import { EASYPAL_MODES, EasyPalEncoder } from '../utils/EasyPalEncoder.js';
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
  const [selectedMode, setSelectedMode] = useState('ROBOT36');
  const [processing, setProcessing] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError('Please select an image file (JPG, PNG, etc.)');
      return;
    }
    setProcessing(true);
    onReset();
    try {
      const encoder = new EasyPalEncoder(selectedMode);
      const blob = await encoder.encodeImage(file);
      const mode = EASYPAL_MODES[selectedMode];
      if (!mode) throw new Error(`Unknown EasyPal mode: ${selectedMode}`);
      onResult({
        url: URL.createObjectURL(blob),
        filename: `easypal_${selectedMode.toLowerCase()}_${Date.now()}.wav`,
        mode: mode.name,
        width: mode.width,
        lines: mode.lines,
        colorFormat: mode.colorFormat,
        expectedDuration: `${(mode.lines * (mode.syncPulse + mode.syncPorch + (mode.scanTime || 0))).toFixed(1)}s`,
        fileSize: `${(blob.size / 1024).toFixed(0)} KB`,
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
        <p className="text-amber-400/60 text-xs mt-1">⚠️ Placeholder - Not implemented</p>
      </div>

      <div className="mb-5 h-9 flex items-center justify-center gap-3 text-sm">
        <label
          className="text-white/50 text-xs uppercase tracking-wider font-medium"
          htmlFor="mode-select"
        >
          Mode
        </label>
        <select
          id="mode-select"
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value)}
          className="px-3 py-1.5 text-sm bg-white/[0.06] border border-white/15 text-white/80 rounded-lg cursor-pointer focus:outline-none focus:border-primary transition-colors"
          disabled
        >
          {Object.entries(EASYPAL_MODES).map(([key, mode]) => (
            <option key={key} value={key}>
              {mode.name} ({mode.width}×{mode.lines})
            </option>
          ))}
        </select>
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
