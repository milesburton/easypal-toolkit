import { useEffect, useState } from 'react';
import type { GalleryEntry } from '../types.js';

interface Props {
  onTryDecode?: (audioUrl: string) => void;
}

export function GalleryPanel({ onTryDecode }: Props) {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);

  useEffect(() => {
    fetch('gallery/manifest.json')
      .then((r) => r.json())
      .then((data: GalleryEntry[]) => setEntries(data))
      .catch(() => setEntries([]));
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="glass rounded-2xl p-8 mb-6">
      <div className="mb-6">
        <h3 className="text-white text-lg font-semibold tracking-wide">Example Transmissions</h3>
        <p className="text-white/40 text-xs uppercase tracking-widest mt-1">
          Real recordings ready to decode
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {entries.map((entry) => (
          <div
            key={entry.name}
            className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.03] flex flex-col"
          >
            <div className="relative">
              <img
                src={entry.imageFile}
                alt={entry.name}
                className="w-full h-44 object-cover block"
              />
              <span
                className={`absolute top-2 right-2 text-xs font-bold uppercase px-2 py-0.5 rounded-full quality-${entry.quality}`}
              >
                {entry.mode}
              </span>
            </div>
            <div className="p-4 flex flex-col flex-1">
              <span className="font-medium text-sm text-white/80 mb-3">{entry.name}</span>
              <div className="flex gap-2 mt-auto">
                <a
                  href={entry.audioFile}
                  download
                  className="flex-1 text-center px-3 py-2 text-xs font-semibold border border-white/20 text-white/60 rounded-lg hover:border-primary hover:text-primary transition-colors"
                >
                  Download
                </a>
                {onTryDecode && (
                  <button
                    onClick={() => onTryDecode(entry.audioFile)}
                    className="flex-1 px-3 py-2 text-xs font-semibold border border-white/20 text-white/60 rounded-lg hover:border-primary hover:text-primary transition-colors"
                  >
                    Try decoding
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
