import { useRef, useState } from 'react';
import { ExternalLink, Maximize2, RefreshCw } from 'lucide-react';

const appUrl = `${import.meta.env.BASE_URL}c3.html`;

export default function App() {
  const frameRef = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);

  async function enterFullscreen() {
    const frame = frameRef.current;
    if (!frame) return;

    try {
      await frame.requestFullscreen();
    } catch {
      await document.documentElement.requestFullscreen();
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="identity" href={appUrl} aria-label="Open Solum home">
          <img src={`${import.meta.env.BASE_URL}image.png`} alt="" />
          <span>solum</span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><span />LIVE</span>
          <button
            className="icon-button"
            type="button"
            title="Reload app"
            aria-label="Reload app"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Fullscreen"
            aria-label="Fullscreen"
            onClick={enterFullscreen}
          >
            <Maximize2 size={17} />
          </button>
          <a
            className="icon-button"
            href={appUrl}
            target="_blank"
            rel="noreferrer"
            title="Open app in a new tab"
            aria-label="Open app in a new tab"
          >
            <ExternalLink size={17} />
          </a>
        </div>
      </header>
      <section className="app-view" aria-label="Solum app">
        <iframe
          key={reloadKey}
          ref={frameRef}
          src={appUrl}
          title="Solum"
          allow="fullscreen; autoplay; clipboard-read; clipboard-write"
        />
      </section>
    </main>
  );
}