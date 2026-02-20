import { useCallback, useEffect, useRef, useState } from 'react';
import { DecoderPanel } from './components/DecoderPanel.js';
import { DiagnosticsPanel } from './components/DiagnosticsPanel.js';
import { EncoderPanel } from './components/EncoderPanel.js';
import { GalleryPanel } from './components/GalleryPanel.js';
import { QualityBadge } from './components/QualityBadge.js';
import type { DecodeState, EncodeResult } from './types.js';

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

function useStarfield() {
  useEffect(() => {
    const canvas = document.getElementById('stars-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    type Star = { x: number; y: number; r: number; speed: number; opacity: number };
    let stars: Star[] = [];
    let animId = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({ length: 220 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.3,
        speed: Math.random() * 0.15 + 0.04,
        opacity: Math.random() * 0.6 + 0.2,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const star of stars) {
        star.y += star.speed;
        if (star.y > canvas.height) {
          star.y = 0;
          star.x = Math.random() * canvas.width;
        }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 215, 255, ${star.opacity})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);
}

export default function App() {
  const [decodeUrl, setDecodeUrl] = useState<string | null>(null);
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [decodeResult, setDecodeResult] = useState<DecodeState | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useStarfield();

  const scrollToResults = useCallback(() => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleEncodeResult = useCallback(
    (result: EncodeResult) => {
      setEncodeResult(result);
      setEncodeError(null);
      scrollToResults();
    },
    [scrollToResults]
  );

  const handleDecodeResult = useCallback(
    (result: DecodeState) => {
      setDecodeResult(result);
      setDecodeError(null);
      scrollToResults();
    },
    [scrollToResults]
  );

  const downloadEncode = () => {
    if (!encodeResult) return;
    const anchor = document.createElement('a');
    anchor.href = encodeResult.url;
    anchor.download = encodeResult.filename;
    anchor.click();
  };

  const downloadDecode = () => {
    if (!decodeResult) return;
    const anchor = document.createElement('a');
    anchor.href = decodeResult.url;
    anchor.download = decodeResult.filename;
    anchor.click();
  };

  const resetEncode = useCallback(() => {
    setEncodeResult(null);
    setEncodeError(null);
  }, []);

  const resetDecode = useCallback(() => {
    setDecodeResult(null);
    setDecodeError(null);
  }, []);

  const hasResults = encodeResult ?? decodeResult ?? encodeError ?? decodeError;
  const verdict = decodeResult?.diagnostics?.quality?.verdict;

  return (
    <>
      <canvas id="stars-canvas" />
      <div className="w-full max-w-6xl mx-auto px-6 py-10">
        <header className="text-center mb-10">
          <h1 className="text-5xl font-bold mb-3 tracking-tight text-white drop-shadow-lg">
            DRM Studio
          </h1>
          <p className="text-sm text-white/50 tracking-widest uppercase font-medium">
            Digital SSTV · DRM Mode B · OFDM · 16-QAM
          </p>
          <p className="text-white/30 text-xs mt-1">
            v{__APP_VERSION__} · {__BUILD_DATE__}
          </p>
        </header>

        <main className="glass rounded-2xl p-8 mb-6 grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="pr-0 lg:pr-8 lg:border-r border-white/10">
            <EncoderPanel
              onResult={handleEncodeResult}
              onError={(msg) => {
                setEncodeError(msg);
                setEncodeResult(null);
                scrollToResults();
              }}
              onReset={resetEncode}
            />
          </div>
          <div className="pl-0 lg:pl-8 pt-8 lg:pt-0">
            <DecoderPanel
              triggerUrl={decodeUrl}
              onTriggerConsumed={() => setDecodeUrl(null)}
              onResult={handleDecodeResult}
              onError={(msg) => {
                setDecodeError(msg);
                setDecodeResult(null);
                scrollToResults();
              }}
              onReset={resetDecode}
            />
          </div>
        </main>

        {hasResults && (
          <div
            ref={resultsRef}
            className="glass rounded-2xl p-8 mb-6 grid grid-cols-1 lg:grid-cols-2 gap-0"
          >
            <div className="pr-0 lg:pr-8 lg:border-r border-white/10">
              <div className="text-center mb-5 pb-4 border-b border-white/10">
                <h2 className="text-white text-base font-semibold tracking-wide">Encoded</h2>
              </div>
              {encodeError && (
                <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 text-red-400 text-center text-sm">
                  {encodeError}
                </div>
              )}
              {encodeResult && (
                <>
                  <p className="text-emerald-400 text-sm font-semibold text-center uppercase tracking-wider mb-4">
                    Encoded successfully
                  </p>
                  <audio controls src={encodeResult.url} className="w-full mb-4 opacity-80" />
                  <div className="flex gap-3 justify-center mb-4">
                    <button
                      onClick={downloadEncode}
                      className="px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 hover:-translate-y-0.5 transition-all"
                    >
                      Download WAV
                    </button>
                    <button
                      onClick={resetEncode}
                      className="px-5 py-2 text-sm font-semibold bg-white/10 text-white/70 rounded-lg hover:bg-white/15 transition-all"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="border border-white/10 rounded-lg overflow-hidden text-xs">
                    <div className="px-3 py-2 bg-white/4 text-white/40 text-xs font-semibold uppercase tracking-wider">
                      Encode Info
                    </div>
                    <div className="p-3 diag-grid text-xs">
                      <span className="text-white/35">Mode</span>
                      <span className="font-mono text-white/70">{encodeResult.mode}</span>
                      <span className="text-white/35">Image width</span>
                      <span className="font-mono text-white/70">{encodeResult.width}px</span>
                      <span className="text-white/35">JPEG payload</span>
                      <span className="font-mono text-white/70">{encodeResult.jpegSize}</span>
                      <span className="text-white/35">Duration</span>
                      <span className="font-mono text-white/70">
                        {encodeResult.expectedDuration}
                      </span>
                      <span className="text-white/35">WAV size</span>
                      <span className="font-mono text-white/70">{encodeResult.fileSize}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pl-0 lg:pl-8 pt-8 lg:pt-0">
              <div className="text-center mb-5 pb-4 border-b border-white/10">
                <h2 className="text-white text-base font-semibold tracking-wide">Decoded</h2>
              </div>
              {decodeError && (
                <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 text-red-400 text-center text-sm">
                  {decodeError}
                </div>
              )}
              {decodeResult && (
                <>
                  <h3 className="mb-4 text-sm font-semibold text-center uppercase tracking-wider">
                    <span className={verdict === 'bad' ? 'text-red-400' : 'text-emerald-400'}>
                      {verdict === 'bad'
                        ? 'Decode failed — no image recovered'
                        : 'Decoded successfully'}
                    </span>
                    <QualityBadge verdict={verdict} />
                  </h3>
                  <img
                    src={decodeResult.url}
                    alt="Decoded EasyPal"
                    className="max-w-full h-auto rounded-lg block mx-auto mb-4 opacity-95"
                  />
                  <div className="flex gap-3 justify-center mb-4">
                    <button
                      onClick={downloadDecode}
                      className="px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 hover:-translate-y-0.5 transition-all"
                    >
                      Download PNG
                    </button>
                    <button
                      onClick={resetDecode}
                      className="px-5 py-2 text-sm font-semibold bg-white/10 text-white/70 rounded-lg hover:bg-white/15 transition-all"
                    >
                      Clear
                    </button>
                  </div>
                  <DiagnosticsPanel diagnostics={decodeResult.diagnostics} />
                </>
              )}
            </div>
          </div>
        )}

        <GalleryPanel onTryDecode={setDecodeUrl} />
      </div>
    </>
  );
}
