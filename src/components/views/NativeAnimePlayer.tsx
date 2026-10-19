"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowLeft, Loader2, List, SkipForward, ChevronDown,
  Settings as SettingsIcon, Subtitles, Gauge, AlertCircle,
} from "lucide-react";
import { useSettings } from "@/store/settings";

// Megaplay resolution pipeline — same chain Lyra uses, run client-side.
// megaplay.buzz sends access-control-allow-origin: * AND the page returns
// real data-id even with a github.io Referer, so a browser fetch works.
const MEGAPLAY_BASE = "https://megaplay.buzz";

// AES-256-CBC key/IV from Lyra's mochi service (services/mochi/src/stream.rs).
// Megaplay encrypts the inner sources JSON with these. Padded to 32 bytes.
const AES_KEY_SEED = "i?LMTAx0Q6,:}50U"; // 16 bytes
const AES_IV = "W0;27ToaUpl_P%'c"; // 16 bytes

// HMAC-SHA256 key for the playlist token, also from Lyra.
const HMAC_KEY = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

interface ResolvedStream {
  playlistUrl: string;
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  subtitleTracks: { url: string; label: string; language?: string }[];
  duration?: number;
}

interface Episode {
  number: number;
  title?: string;
  episode_embed_id: string;
  embed_url?: { sub: string; dub: string };
}

interface Series {
  id: string;
  title: string;
  image: string;
  episodes: Episode[];
}

// ----- Crypto helpers (Web Crypto API) -----

async function importAesKey(): Promise<CryptoKey> {
  // Pad the 16-byte seed to 32 bytes for AES-256.
  const seedBytes = new TextEncoder().encode(AES_KEY_SEED);
  const keyBytes = new Uint8Array(32);
  keyBytes.set(seedBytes.subarray(0, 32));
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
}

async function decryptEnc(enc: string): Promise<any> {
  // enc is base64url (no padding). Convert to base64 then decode.
  const b64 = enc.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (enc.length % 4)) % 4);
  const ciphertext = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = new TextEncoder().encode(AES_IV);
  const key = await importAesKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, ciphertext as BufferSource);
  const text = new TextDecoder().decode(plain);
  // PKCS7 padding — strip trailing bytes if needed.
  const pad = text.charCodeAt(text.length - 1);
  const trimmed = pad > 0 && pad <= 16 ? text.slice(0, -pad) : text;
  return JSON.parse(trimmed);
}

async function hmacSha256(message: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(HMAC_KEY);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message) as BufferSource);
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ----- Stream resolution -----

function extractDataId(html: string): { dataId?: string; realId?: string } {
  const out: { dataId?: string; realId?: string } = {};
  const m1 = html.match(/data-id="(\d+)"/);
  if (m1) out.dataId = m1[1];
  const m2 = html.match(/data-realid="(\d+)"/);
  if (m2) out.realId = m2[1];
  return out;
}

function findM3u8(payload: any): string | null {
  // Look in either the outer payload or an inner `sources` object.
  const candidates: any[] = [payload, payload?.sources];
  if (Array.isArray(payload?.sources)) candidates.push(...payload.sources);
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const file = c.file || (typeof c === "string" ? c : null);
    if (typeof file === "string" && file.startsWith("https://") && file.includes(".m3u8")) {
      return file;
    }
  }
  return null;
}

function findHexPair(url: string): [string, string] | null {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    for (let i = 0; i < segs.length - 1; i++) {
      if (
        segs[i].length === 32 &&
        segs[i + 1].length === 32 &&
        /^[0-9a-fA-F]{32}$/.test(segs[i]) &&
        /^[0-9a-fA-F]{32}$/.test(segs[i + 1])
      ) {
        return [segs[i], segs[i + 1]];
      }
    }
  } catch {}
  return null;
}

async function buildTokenizedUrl(sourceUrl: string): Promise<string> {
  const pair = findHexPair(sourceUrl);
  if (!pair) return sourceUrl;
  const now = Math.floor(Date.now() / 1000);
  const message = `${now + 90}|${pair[0].toLowerCase()}/${pair[1].toLowerCase()}`;
  const sig = await hmacSha256(message);
  const msgB64 = btoa(message).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sep = sourceUrl.includes("?") ? "&" : "?";
  return `${sourceUrl}${sep}token=${msgB64}.${sig}`;
}

async function resolveStream(episode: Episode, dub: boolean): Promise<ResolvedStream> {
  const streamPageUrl = episode.embed_url
    ? (dub ? episode.embed_url.dub : episode.embed_url.sub) || episode.embed_url.sub || episode.embed_url.dub || ""
    : `${MEGAPLAY_BASE}/stream/s-2/${episode.episode_embed_id}/${dub ? "dub" : "sub"}`;
  if (!streamPageUrl) throw new Error("No stream URL for this episode");

  // 1) Fetch the embed page and extract data-id.
  const pageRes = await fetch(streamPageUrl, {
    headers: { Accept: "text/html,application/xhtml+xml" },
    credentials: "omit",
  });
  if (!pageRes.ok) throw new Error(`Embed page HTTP ${pageRes.status}`);
  const html = await pageRes.text();
  const { dataId, realId } = extractDataId(html);
  const idForSources = dataId || realId;
  if (!idForSources) throw new Error("Couldn't find data-id in the embed page");

  // 2) Hit getSourcesNew (and fall back to getSources).
  const sourcesUrls = [
    `${MEGAPLAY_BASE}/stream/getSourcesNew?id=${idForSources}`,
    `${MEGAPLAY_BASE}/stream/getSources?id=${idForSources}`,
  ];
  let payload: any = null;
  let lastErr: any = null;
  for (const u of sourcesUrls) {
    try {
      const r = await fetch(u, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "omit",
      });
      if (!r.ok) { lastErr = new Error(`Sources HTTP ${r.status}`); continue; }
      payload = await r.json();
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!payload) throw lastErr || new Error("Sources request failed");

  // 3) Either the payload has a direct .m3u8, or it's encrypted in `enc`.
  let m3u8 = findM3u8(payload);
  if (!m3u8 && payload.enc) {
    try {
      const decrypted = await decryptEnc(payload.enc);
      m3u8 = findM3u8(decrypted);
    } catch (err: any) {
      throw new Error(`AES decrypt failed: ${err?.message || err}`);
    }
  }
  if (!m3u8) throw new Error("No .m3u8 URL found in sources payload");

  // 4) Tokenize the playlist URL (only if it has a 32-hex pair).
  const playlistUrl = await buildTokenizedUrl(m3u8);

  // 5) Pull intro/outro markers + subtitle tracks.
  const intro = payload.intro && typeof payload.intro.start === "number" ? payload.intro : null;
  const outro = payload.outro && typeof payload.outro.start === "number" ? payload.outro : null;
  const subtitleTracks: { url: string; label: string; language?: string }[] = [];
  if (Array.isArray(payload.tracks)) {
    for (const t of payload.tracks) {
      const url = t?.file || t?.url || t?.src;
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      subtitleTracks.push({
        url,
        label: t?.label || t?.language || t?.lang || "Subtitle",
        language: t?.language || t?.lang || t?.srclang,
      });
    }
  }

  return {
    playlistUrl,
    intro,
    outro,
    subtitleTracks,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
  };
}

// ----- UI -----

interface NativeAnimePlayerProps {
  series: Series;
  episodeIndex: number;
  onBack: () => void;
  onSelectEpisode: (i: number) => void;
  onNext: () => void;
  hasNext: boolean;
  preferDub: boolean;
}

export function NativeAnimePlayer({
  series,
  episodeIndex,
  onBack,
  onSelectEpisode,
  onNext,
  hasNext,
  preferDub,
}: NativeAnimePlayerProps) {
  const autoSkipIntro = useSettings((s) => s.autoSkipIntro);
  const [dub, setDub] = useState(preferDub);
  const [resolving, setResolving] = useState(true);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [stream, setStream] = useState<ResolvedStream | null>(null);
  const [showEpisodeList, setShowEpisodeList] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [qualities, setQualities] = useState<{ height: number; index: number; label: string }[]>([]);
  const [activeQuality, setActiveQuality] = useState<number>(-1); // -1 = auto
  const [selectedSubtitle, setSelectedSubtitle] = useState<number>(-1); // -1 = off
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showSkipOutro, setShowSkipOutro] = useState(false);
  const [autoSkippedKey, setAutoSkippedKey] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any>(null);
  const ep = series.episodes[episodeIndex];
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the stream whenever episode or dub changes.
  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    setResolveError(null);
    setStream(null);
    setQualities([]);
    setActiveQuality(-1);
    setSelectedSubtitle(-1);
    setCurrentTime(0);
    setDuration(0);

    resolveStream(ep, dub)
      .then((s) => {
        if (cancelled) return;
        setStream(s);
        setResolving(false);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setResolveError(err?.message || String(err));
        setResolving(false);
      });

    return () => { cancelled = true; };
  }, [ep.episode_embed_id, dub]);

  // Bootstrap HLS.js when the playlist URL is known.
  useEffect(() => {
    if (!stream) return;
    const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
    const video = videoRef.current;
    if (!video) return;

    let hls: any = null;
    const script = document.createElement("script");
    script.src = HLS_JS;
    script.async = true;
    script.onload = () => {
      const Hls = (window as any).Hls;
      if (!Hls) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBuffer: 90,
        });
        hlsRef.current = hls;
        hls.loadSource(stream.playlistUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e: any, data: any) => {
          const levels = (data?.levels || hls.levels || []).map((l: any, i: number) => ({
            height: l.height || 0,
            index: i,
            label: l.height ? `${l.height}p` : (l.bitrate ? `${Math.round(l.bitrate / 1000)}kbps` : `Level ${i + 1}`),
          })).sort((a: any, b: any) => b.height - a.height);
          setQualities(levels);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e: any, data: any) => {
          setActiveQuality(data.level);
        });
        // Try autoplay.
        video.play().then(() => setPlaying(true)).catch(() => {});
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari native HLS.
        video.src = stream.playlistUrl;
        video.play().then(() => setPlaying(true)).catch(() => {});
      }
    };
    script.onerror = () => {
      setResolveError("Failed to load HLS.js library");
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
      if (hls) { try { hls.destroy(); } catch {} }
      hlsRef.current = null;
    };
  }, [stream]);

  // Track playback state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => { setPlaying(true); setBuffering(false); };
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (stream?.intro) {
        const inIntro = v.currentTime >= stream.intro.start && v.currentTime < stream.intro.end;
        setShowSkipIntro(inIntro);
        if (autoSkipIntro && inIntro && autoSkippedKey !== `intro:${stream.intro.start}`) {
          setAutoSkippedKey(`intro:${stream.intro.start}`);
          v.currentTime = stream.intro.end;
        }
      }
      if (stream?.outro) {
        const inOutro = v.currentTime >= stream.outro.start && v.currentTime < stream.outro.end;
        setShowSkipOutro(inOutro);
        if (autoSkipIntro && inOutro && autoSkippedKey !== `outro:${stream.outro.start}`) {
          setAutoSkippedKey(`outro:${stream.outro.start}`);
          v.currentTime = stream.outro.end;
        }
      }
    };
    const onDuration = () => setDuration(v.duration || 0);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onEnded = () => { if (hasNext) onNext(); };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("ended", onEnded);
    };
  }, [stream, autoSkipIntro, hasNext, onNext, autoSkippedKey]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, t);
  }, []);

  const seekRelative = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
  }, []);

  const setQuality = useCallback((index: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index; // -1 = auto
      setActiveQuality(index);
    }
  }, []);

  const setSubtitle = useCallback((index: number) => {
    const v = videoRef.current;
    if (!v || !stream) return;
    // Disable all text tracks first.
    for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = "disabled";
    if (index >= 0 && index < v.textTracks.length) {
      v.textTracks[index].mode = "showing";
    }
    setSelectedSubtitle(index);
  }, [stream]);

  // Auto-hide controls after inactivity.
  const showControlsTemporary = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  useEffect(() => {
    showControlsTemporary();
    return () => {
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [showControlsTemporary]);

  const fmtTime = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}:${(m % 60).toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };

  const skipIntroEnd = stream?.intro?.end;
  const skipOutroEnd = stream?.outro?.end;

  return (
    <div className="fade-in flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <button onClick={onBack} className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
          <ArrowLeft className="h-4 w-4" /> Back to series
        </button>
        <div className="min-w-0 flex-1 truncate px-2 text-center text-sm font-medium">
          {series.title} — Ep {ep.number}
        </div>
        <div className="flex items-center gap-2">
          {/* Episode picker */}
          <div className="relative">
            <button
              onClick={() => setShowEpisodeList((v) => !v)}
              className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors hover:surface2"
              style={{ borderColor: "var(--border)" }}
            >
              <List className="h-3 w-3" /> Episodes <ChevronDown className="h-3 w-3" />
            </button>
            {showEpisodeList && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowEpisodeList(false)} />
                <div
                  className="absolute right-0 top-full z-20 mt-1 max-h-72 w-44 overflow-y-auto rounded-lg border shadow-2xl"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                >
                  {series.episodes.map((e, i) => (
                    <button
                      key={`${e.episode_embed_id}-${i}`}
                      onClick={() => { onSelectEpisode(i); setShowEpisodeList(false); }}
                      className="block w-full px-3 py-2 text-left text-xs transition-colors hover:surface2"
                      style={{
                        background: i === episodeIndex ? "var(--surface2)" : "transparent",
                        color: i === episodeIndex ? "var(--accent)" : "var(--text)",
                      }}
                    >
                      Ep {e.number}{e.title ? ` — ${e.title}` : ""}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* SUB/DUB toggle */}
          <div className="flex items-center gap-1 rounded-full border p-0.5" style={{ borderColor: "var(--border)" }}>
            {(["sub", "dub"] as const).map((v) => {
              const active = (v === "dub") === dub;
              return (
                <button
                  key={v}
                  onClick={() => setDub(v === "dub")}
                  className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                  style={{ background: active ? "var(--accent)" : "transparent", color: active ? "var(--bg)" : "var(--text-muted)" }}
                >
                  {v.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Player area */}
      <div
        className="relative flex-1 bg-black"
        onMouseMove={showControlsTemporary}
        onClick={showControlsTemporary}
      >
        {resolving && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Resolving stream…</p>
          </div>
        )}
        {resolveError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black p-6 text-center">
            <AlertCircle className="h-8 w-8" style={{ color: "#ef4444" }} />
            <p className="text-sm font-medium">Couldn't resolve the native stream.</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{resolveError}</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              The host might have changed its API or a request was blocked. Try the iframe fallback.
            </p>
          </div>
        )}
        <video
          ref={videoRef}
          className="h-full w-full bg-black"
          playsInline
          crossOrigin="anonymous"
          onClick={togglePlay}
          style={{ display: resolving || resolveError ? "none" : "block" }}
        />
        {/* Subtitle tracks from megaplay (real VTT files) */}
        {stream?.subtitleTracks.map((t, i) => (
          <track
            key={t.url + i}
            kind="subtitles"
            src={t.url}
            label={t.label}
            srcLang={t.language || "und"}
            default={false}
          />
        ))}

        {/* Buffering spinner overlay */}
        {buffering && !resolving && !resolveError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
          </div>
        )}

        {/* REAL Skip Intro button — uses the intro markers from megaplay's API */}
        {showSkipIntro && skipIntroEnd != null && (
          <button
            onClick={() => seekTo(skipIntroEnd)}
            className="absolute bottom-20 right-6 z-30 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium shadow-2xl transition-all hover:scale-105"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            <SkipForward className="h-3.5 w-3.5" /> Skip Intro
          </button>
        )}
        {/* REAL Skip Outro button */}
        {showSkipOutro && skipOutroEnd != null && (
          <button
            onClick={() => seekTo(skipOutroEnd)}
            className="absolute bottom-20 right-6 z-30 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium shadow-2xl transition-all hover:scale-105"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            <SkipForward className="h-3.5 w-3.5" /> Skip Outro
          </button>
        )}

        {/* Custom controls */}
        {showControls && !resolving && !resolveError && (
          <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-8">
            {/* Seek bar */}
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: "#fff" }}>
              <span className="tabular-nums">{fmtTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="flex-1 accent-white"
                style={{ height: 4 }}
              />
              <span className="tabular-nums">{fmtTime(duration)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={togglePlay} className="rounded-full p-1.5 transition-colors hover:bg-white/10" title={playing ? "Pause" : "Play"}>
                  {playing ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>
                <button onClick={() => seekRelative(-10)} className="rounded-full p-1.5 text-xs transition-colors hover:bg-white/10" title="Back 10s">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6L19 8v8l-7.5-4z" transform="scale(-1,1) translate(-24,0)" /></svg>
                </button>
                <button onClick={() => seekRelative(10)} className="rounded-full p-1.5 text-xs transition-colors hover:bg-white/10" title="Forward 10s">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M13 6v12l8.5-6L13 6zm-.5 6L5 8v8l7.5-4z" /></svg>
                </button>
                {hasNext && (
                  <button onClick={onNext} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors hover:bg-white/10" title="Next episode">
                    <SkipForward className="h-4 w-4" /> Next
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Settings: quality + subtitles */}
                <div className="relative">
                  <button onClick={() => setShowSettings((v) => !v)} className="rounded-full p-1.5 transition-colors hover:bg-white/10" title="Quality & subtitles">
                    <SettingsIcon className="h-5 w-5" />
                  </button>
                  {showSettings && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowSettings(false)} />
                      <div className="absolute bottom-full right-0 mb-2 z-20 w-48 rounded-lg border bg-black/95 p-2 shadow-2xl" style={{ borderColor: "var(--border)" }}>
                        {qualities.length > 0 && (
                          <div className="mb-2">
                            <div className="mb-1 flex items-center gap-1 px-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                              <Gauge className="h-3 w-3" /> Quality
                            </div>
                            {[
                              { index: -1, label: "Auto" },
                              ...qualities,
                            ].map((q) => (
                              <button
                                key={q.index}
                                onClick={() => setQuality(q.index)}
                                className="block w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-white/10"
                                style={{ color: activeQuality === q.index ? "var(--accent)" : "#fff" }}
                              >
                                {q.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {stream && stream.subtitleTracks.length > 0 && (
                          <div>
                            <div className="mb-1 flex items-center gap-1 px-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                              <Subtitles className="h-3 w-3" /> Subtitles
                            </div>
                            <button
                              onClick={() => setSubtitle(-1)}
                              className="block w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-white/10"
                              style={{ color: selectedSubtitle === -1 ? "var(--accent)" : "#fff" }}
                            >
                              Off
                            </button>
                            {stream.subtitleTracks.map((t, i) => (
                              <button
                                key={t.url + i}
                                onClick={() => setSubtitle(i)}
                                className="block w-full rounded px-2 py-1 text-left text-xs transition-colors hover:bg-white/10"
                                style={{ color: selectedSubtitle === i ? "var(--accent)" : "#fff" }}
                              >
                                {t.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => videoRef.current?.requestFullscreen()} className="rounded-full p-1.5 transition-colors hover:bg-white/10" title="Fullscreen">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Up Next card */}
        {hasNext && !resolving && !resolveError && currentTime > (duration - 5) && duration > 0 && (
          <div
            className="absolute bottom-20 left-6 z-30 flex items-center gap-3 rounded-xl border p-3 shadow-2xl"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="text-xs">
              <div style={{ color: "var(--text-muted)" }}>Up next</div>
              <div className="font-medium">Episode {series.episodes[episodeIndex + 1]?.number}</div>
            </div>
            <button
              onClick={onNext}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              <SkipForward className="h-3 w-3" /> Play
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
