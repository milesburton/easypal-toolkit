import { useState } from 'react';
import type { DecodeDiagnostics } from '../types.js';

interface Props {
  diagnostics: DecodeDiagnostics;
}

export function DiagnosticsPanel({ diagnostics }: Props) {
  const [open, setOpen] = useState(true);
  const { mode, sampleRate, fileDuration, decodeTimeMs } = diagnostics;

  return (
    <div className="mt-4 border border-white/10 rounded-lg overflow-hidden text-xs">
      <button
        className="w-full bg-white/[0.04] hover:bg-white/[0.07] border-none px-3 py-2.5 text-left text-xs font-semibold text-white/40 flex justify-between uppercase tracking-wider transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Diagnostics</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-3">
          <div className="diag-grid">
            <span className="text-white/35 font-medium">Mode</span>
            <span className="font-mono text-white/65 break-all">{mode ?? '—'}</span>

            <span className="text-white/35 font-medium">Sample rate</span>
            <span className="font-mono text-white/65">{sampleRate ? `${sampleRate} Hz` : '—'}</span>

            <span className="text-white/35 font-medium">File duration</span>
            <span className="font-mono text-white/65">{fileDuration ?? '—'}</span>

            <span className="text-white/35 font-medium">Decode time</span>
            <span className="font-mono text-white/65">
              {decodeTimeMs != null ? `${decodeTimeMs} ms` : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
