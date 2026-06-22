import React, { useEffect, useRef, useState, useCallback } from "react";
import { Track } from "../utils/spotify";
import YouTube from 'react-youtube';
import { GlassCard } from '@developer-hub/liquid-glass';

interface PlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  repeatMode: boolean;
  setRepeatMode: (repeat: boolean) => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  duration: number;
  setDuration: (duration: number) => void;
}

const Player: React.FC<PlayerProps> = ({
  currentTrack,
  isPlaying,
  setIsPlaying,
  onNextTrack,
  onPrevTrack,
  repeatMode,
  setRepeatMode,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const volume = 0.7;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const [useYtFallback, setUseYtFallback] = useState(false);

  // Stable refs
  const onNextTrackRef = useRef(onNextTrack);
  onNextTrackRef.current = onNextTrack;
  const setIsPlayingRef = useRef(setIsPlaying);
  setIsPlayingRef.current = setIsPlaying;
  const setCurrentTimeRef = useRef(setCurrentTime);
  setCurrentTimeRef.current = setCurrentTime;
  const setDurationRef = useRef(setDuration);
  setDurationRef.current = setDuration;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const setUseYtFallbackRef = useRef(setUseYtFallback);
  setUseYtFallbackRef.current = setUseYtFallback;
  const useYtFallbackRef = useRef(useYtFallback);
  useYtFallbackRef.current = useYtFallback;

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.volume = 0.7;
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => setCurrentTimeRef.current(audio.currentTime));
    audio.addEventListener("ended", () => {
      setIsPlayingRef.current(false);
      onNextTrackRef.current();
    });
    audio.addEventListener("loadedmetadata", () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration)) {
        setDurationRef.current(audio.duration);
      }
    });
    audio.addEventListener("error", () => {
      if (!audio.src || audio.src === window.location.href || audio.src.startsWith("data:")) return;

      const track = currentTrackRef.current;
      if (track && !track.previewUrl && !useYtFallbackRef.current) {
        console.warn("[Player] Audio error event fired (e.g. 403). Falling back to YouTube iframe.");
        setUseYtFallbackRef.current(true);
        return;
      }

      setIsPlayingRef.current(false);
      setTimeout(() => setError("Playback failed. Try another song."), 0);
    });

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Expose unlock for track clicks
  useEffect(() => {
    (window as any).__playerUnlock = () => {
      const audio = audioRef.current;
      if (!audio || audio.src) return;
      const silence = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==";
      audio.src = silence;
      audio.volume = 0;
      audio.play().catch(() => { });
    };
    return () => { delete (window as any).__playerUnlock; };
  }, []);

  // Load track when it changes
  useEffect(() => {
    if (!currentTrack) return;

    const audio = audioRef.current;
    if (!audio) return;

    setError("");
    setLoading(true);
    setCurrentTime(0);
    setDuration(0);
    audio.pause();
    audio.removeAttribute('src');
    audio.src = "";

    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.pauseVideo(); } catch (e) { }
    }

    let cancelled = false;

    const load = async () => {
      try {
        let url: string = "";
        setUseYtFallback(false);
        ytPlayerRef.current = null; // Clear old player reference

        if (currentTrack.previewUrl) {
          url = currentTrack.previewUrl;
          setDuration(currentTrack.duration);
        } else {
          const videoId = currentTrack.id;
          const { invoke } = await import('@tauri-apps/api/core');

          try {
            const audioUrl = await invoke<string>("get_invidious_audio_url", { videoId });
            console.log("[Player] Got audio URL via Rust Invidious ✓");
            const port = await invoke<number>("start_audio_proxy", { url: audioUrl });
            url = `http://localhost:${port}/`;
            console.log(`[Player] Streaming via local proxy at :${port} ✓`);
          } catch (rustErr) {
            console.warn("[Player] Rust proxy failed, falling back to YouTube iframe", rustErr);
            if (cancelled) return;
            setUseYtFallback(true);
            return; // let YouTube component handle playback
          }
        }

        if (cancelled) return;

        audio.src = url;
        audio.volume = volume;
        audio.load();

        await audio.play();
        if (cancelled) {
          audio.pause();
          return;
        }
        setLoading(false);
        setIsPlaying(true);
      } catch (e: any) {
        if (cancelled) return;

        if (e.name !== "NotAllowedError" && currentTrack && !currentTrack.previewUrl && !useYtFallback) {
          console.warn("[Player] Audio playback rejected. Falling back to YouTube iframe.", e);
          setUseYtFallback(true);
          return;
        }

        setLoading(false);
        if (e.name === "NotAllowedError") {
          setError("Click ▶ to start playback");
        } else {
          setError(e.message || "Playback failed. Try another song.");
        }
        setIsPlaying(false);
      }
    };

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack]);


  // Sync play/pause
  useEffect(() => {
    if (loading) return;

    if (useYtFallback) {
      if (ytPlayerRef.current) {
        try {
          if (isPlaying) {
            ytPlayerRef.current.playVideo();
          } else {
            ytPlayerRef.current.pauseVideo();
          }
        } catch (e) { }
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      audio.play().catch((e) => {
        if (e.name === "NotAllowedError") setError("Click ▶ to start playback");
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, useYtFallback, loading, currentTrack]);

  // Volume sync
  useEffect(() => {
    try {
      if (useYtFallback && ytPlayerRef.current) ytPlayerRef.current.setVolume(volume * 100);
    } catch (e) { }
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, useYtFallback]);

  // YouTube fallback time update
  useEffect(() => {
    if (useYtFallback && isPlaying) {
      const interval = setInterval(async () => {
        try {
          if (ytPlayerRef.current && ytPlayerRef.current.getIframe()) {
            const t = await ytPlayerRef.current.getCurrentTime();
            setCurrentTime(t);
          }
        } catch (e) { }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [useYtFallback, isPlaying, setCurrentTime]);

  const togglePlay = useCallback(() => {
    if (!currentTrack || loading) return;
    setError("");
    setIsPlaying(!isPlaying);
  }, [currentTrack, isPlaying, loading, setIsPlaying]);

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pct * duration;
    setCurrentTime(newTime);
    if (useYtFallback && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.seekTo(newTime, true);
      } catch (err) { }
    } else if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };


  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r < 10 ? "0" : ""}${r}`;
  };

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <>
      {useYtFallback && currentTrack && (
        <div style={{ display: 'none' }}>
          <YouTube
            videoId={currentTrack.id}
            opts={{
              host: "https://www.youtube-nocookie.com",
              playerVars: { autoplay: 1, controls: 0, playsinline: 1, origin: window.location.origin }
            }}
            onReady={(e) => {
              ytPlayerRef.current = e.target;
              e.target.setVolume(volume * 100);
              const d = e.target.getDuration();
              if (d) setDuration(d);

              // Clear loading state as soon as the iframe API is ready, so controls work
              setLoading(false);
              setIsPlaying(true);
              e.target.playVideo();
            }}
            onPlay={() => {
              setLoading(false);
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onError={() => {
              setLoading(false);
              setError("Playback failed on YouTube fallback.");
            }}
            onStateChange={(e) => {
              if (e.data === 1) { // PLAYING
                const d = e.target.getDuration();
                if (d) setDuration(d);
              }
              if (e.data === 0) { // ENDED
                setIsPlaying(false);
                onNextTrack();
              }
            }}
          />
        </div>
      )}
      {currentTrack && (
        <footer className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-4xl px-[32px] z-50">

          {/* Status badge wrapper */}
          <div className="absolute -top-3 left-0 w-full flex justify-center z-50 pointer-events-none">
            {loading && (
              <div className="pointer-events-auto flex items-center gap-2 text-[10px] text-white/60 animate-pulse font-semibold bg-surface-container px-3 py-1 rounded-full border border-white/10 shadow-lg">
                <div className="w-2 h-2 border border-white/40 border-t-white rounded-full animate-spin" />
                Loading...
              </div>
            )}
            {error && !loading && (
              <div
                className="pointer-events-auto text-[10px] text-rose-300 font-semibold bg-rose-500/20 px-3 py-1 rounded-full border border-rose-500/20 shadow-lg truncate max-w-[80%] cursor-pointer hover:bg-rose-500/30 transition-colors relative"
                style={{ left: "50px" }}
                onClick={togglePlay}
                title="Click to retry"
              >
                ⚠ {error}
              </div>
            )}
          </div>

          <GlassCard cornerRadius={32} blurAmount={0.02} displacementScale={100} className="w-full relative shadow-2xl">
            <div className="p-6">

              <div className="flex items-center justify-between gap-4 md:gap-8">

                {/* Track info */}
                <div className="hidden md:flex items-center gap-4 w-56 shrink-0">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden glass-card p-0.5 shrink-0">
                    <img
                      className="w-full h-full object-cover rounded-[14px]"
                      src={currentTrack.coverUrl}
                      alt="Cover"
                    />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-white font-bold truncate text-sm">{currentTrack.title}</p>
                    <p className="text-secondary text-[10px] uppercase font-bold tracking-widest truncate">{currentTrack.artist}</p>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex-1 flex flex-col items-center gap-4 relative">
                  <div className="flex items-center gap-6">
                    <button
                      onClick={onPrevTrack}
                      className="text-on-surface-variant hover:text-white transition-colors w-10 h-10 flex items-center justify-center rounded-full glass-btn"
                    >
                      <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>skip_previous</span>
                    </button>

                    <button
                      onClick={togglePlay}
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white glass-btn border border-white/20 hover:scale-105 active:scale-95"
                    >
                      {loading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <span className="material-symbols-outlined text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isPlaying ? "pause" : "play_arrow"}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={onNextTrack}
                      className="text-on-surface-variant hover:text-white transition-colors w-10 h-10 flex items-center justify-center rounded-full glass-btn"
                    >
                      <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>skip_next</span>
                    </button>
                  </div>

                  {/* Progress */}
                  <div className="w-full flex items-center gap-4 px-4">
                    <span className="text-[11px] text-on-surface-variant/80 w-10 text-right tabular-nums">{fmt(currentTime)}</span>
                    <div
                      ref={progressBarRef}
                      onClick={handleScrub}
                      className="flex-1 h-2 bg-white/10 w-56 rounded-full relative group cursor-pointer hover:h-3 transition-all overflow-visible"
                    >
                      <div className="absolute inset-y-0 left-0 bg-white/15 rounded-full" style={{ width: `${Math.min(100, pct + 8)}%` }} />
                      <div className="absolute inset-y-0 left-0 bg-white rounded-full" style={{ width: `${pct}%`, boxShadow: "0 0 10px rgba(255,255,255,0.5)" }} />
                      <div className="absolute top-1/2 -translate-y-1/2 -ml-2 w-4 h-4 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_10px_rgba(255,255,255,0.8)]" style={{ left: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] text-on-surface-variant/80 w-10 tabular-nums">-{fmt(Math.max(0, duration - currentTime))}</span>
                  </div>
                </div>

                {/* Right controls */}
                <div className="hidden md:flex items-center justify-end gap-3 w-56 shrink-0">
                  <button
                    onClick={() => setRepeatMode(!repeatMode)}
                    className={`transition-colors w-9 h-9 flex items-center justify-center rounded-full glass-btn ${repeatMode ? "text-primary border-primary/30 bg-primary/10" : "text-on-surface-variant hover:text-white"}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">repeat</span>
                  </button>
                </div>

              </div>
            </div>
          </GlassCard>
        </footer>
      )}
    </>
  );
};

export default Player;
