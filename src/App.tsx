import { useState } from 'react';
import { DecoderPanel } from './components/DecoderPanel.js';
import { GalleryPanel } from './components/GalleryPanel.js';
import type { DecodeState } from './types.js';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export default function App() {
  const [triggerUrl, setTriggerUrl] = useState<string | null>(null);
  const [result, setResult] = useState<DecodeState | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0f1e] p-6">
      <header className="text-center mb-10">
        <h1 className="text-3xl font-bold text-white tracking-wide">EasyPal Toolkit</h1>
        <p className="text-white/40 text-xs mt-1">v{__APP_VERSION__} · {__BUILD_DATE__}</p>
      </header>

      <div className="max-w-3xl mx-auto space-y-6">
        <DecoderPanel
          triggerUrl={triggerUrl}
          onTriggerConsumed={() => setTriggerUrl(null)}
          onResult={setResult}
          onError={setError}
          onReset={() => { setResult(null); setError(null); }}
        />

        {error && (
          <div className="glass rounded-2xl p-6 text-red-400 text-sm">{error}</div>
        )}

        {result && (
          <div className="glass rounded-2xl p-6 text-center">
            <img src={result.url} alt="Decoded EasyPal image" className="mx-auto rounded-lg max-w-full" />
          </div>
        )}

        <GalleryPanel onTryDecode={setTriggerUrl} />
      </div>
    </div>
  );
}
