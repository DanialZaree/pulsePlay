import React, { useEffect, useRef, useState, useCallback } from "react";
import YouTube from "react-youtube";
import Hls from "hls.js";
import { GlassCard } from "@developer-hub/liquid-glass";
import { RepeatMode, Track } from "../types/music";
import { isTauri, safeInvoke } from "../utils/tauri";
import { getDirectAudioUrl } from "../utils/piped";
import { findSoundCloudMatch } from "../utils/search";
import { resolveSoundCloudStream } from "../utils/soundcloud";

interface PlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onNextTrack: (fromAutoEnd?: boolean) => void;
  onPrevTrack: () => void;
  repeatMode: RepeatMode;
  onCycleRepeat: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  isLiked: boolean;
  onToggleLike: () => void;
  onToggleQueue: () => void;
  queueCount: number;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  duration: number;
  setDuration: (duration: number) => void;
  seekTarget: { time: number; seq: number } | null;
  onOpenNowPlaying: () => void;
}

const Player: React.FC<PlayerProps> = ({
  currentTrack,
  isPlaying,
  setIsPlaying,
  onNextTrack,
  onPrevTrack,
  repeatMode,
  onCycleRepeat,
  shuffle,
  onToggleShuffle,
  volume,
  onVolumeChange,
  muted,
  onToggleMute,
  isLiked,
  onToggleLike,
  onToggleQueue,
  queueCount,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  seekTarget,
  onOpenNowPlaying,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bufferedPct, setBufferedPct] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPct, setDragPct] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<{ pct: number; time: number } | null>(null);
  const [useYtFallback, setUseYtFallback] = useState(false);
  const [ytHost, setYtHost] = useState<"https://www.youtube-nocookie.com" | "https://www.youtube.com">(
    "https://www.youtube-nocookie.com"
  );
  const [retrySeq, setRetrySeq] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // Stable refs for native audio event listeners
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
  const useYtFallbackRef = useRef(useYtFallback);
  useYtFallbackRef.current = useYtFallback;
  const isDraggingRef = useRef(isDragging);
  isDraggingRef.current = isDragging;
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const lastSeekSeqRef = useRef<number>(0);

  const effectiveVolume = muted ? 0 : volume;

  const seekToTime = useCallback(
    (newTime: number) => {
      const d = durationRef.current;
      const clamped = Math.max(0, d > 0 ? Math.min(d, newTime) : newTime);
      setCurrentTime(clamped);
      if (useYtFallbackRef.current && ytPlayerRef.current) {
        try {
          ytPlayerRef.current.seekTo(clamped, true);
        } catch {
          // ignore
        }
      } else if (audioRef.current) {
        audioRef.current.currentTime = clamped;
      }
    },
    [setCurrentTime]
  );

  // Respond only to new seek requests (ignore duration updates from track changes)
  useEffect(() => {
    if (!seekTarget || seekTarget.seq === lastSeekSeqRef.current) return;
    lastSeekSeqRef.current = seekTarget.seq;
    seekToTime(seekTarget.time);
  }, [seekTarget, seekToTime]);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.volume = effectiveVolume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      if (!isDraggingRef.current) {
        setCurrentTimeRef.current(audio.currentTime);
      }
    };

    const handleProgress = () => {
      try {
        if (audio.buffered.length > 0 && audio.duration > 0) {
          const end = audio.buffered.end(audio.buffered.length - 1);
          setBufferedPct(Math.min(100, (end / audio.duration) * 100));
        }
      } catch {
        // ignore
      }
    };

    const handleEnded = () => {
      if (repeatModeRef.current === "one") {
        audio.currentTime = 0;
        setCurrentTimeRef.current(0);
        audio.play().catch(() => setIsPlayingRef.current(false));
        return;
      }
      setIsPlayingRef.current(false);
      onNextTrackRef.current(true);
    };

    const handleLoadedMetadata = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDurationRef.current(audio.duration);
      }
    };

    const handleDurationChange = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDurationRef.current(audio.duration);
      }
    };

    const handleError = () => {
      if (useYtFallbackRef.current) return;
      if (!audio.src || audio.src === window.location.href || audio.src.startsWith("data:")) return;

      const track = currentTrackRef.current;
      if (track && !track.previewUrl && track.source !== "soundcloud" && track.source !== "local") {
        console.warn("[Player] Audio error event fired. Falling back to YouTube iframe.");
        useYtFallbackRef.current = true;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        setUseYtFallback(true);
        return;
      }

      setLoading(false);
      setIsPlayingRef.current(false);
      setTimeout(() => setError("Playback failed. Click to retry."), 0);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("progress", handleProgress);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("progress", handleProgress);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("error", handleError);
      destroyHls();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose unlock for user-initiated clicks
  useEffect(() => {
    (window as any).__playerUnlock = () => {
      const audio = audioRef.current;
      if (!audio || audio.src) return;
      const silence = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==";
      audio.src = silence;
      audio.volume = 0;
      audio.play().catch(() => {});
    };
    return () => {
      delete (window as any).__playerUnlock;
    };
  }, []);

  const attachAndPlayUrl = useCallback(
    async (
      audio: HTMLAudioElement,
      playUrl: string,
      isHls: boolean,
      isCancelled: () => boolean
    ) => {
      destroyHls();
      audio.volume = effectiveVolume;

      if (isHls && Hls.isSupported()) {
        await new Promise<void>((resolve, reject) => {
          const hls = new Hls({
            startPosition: 0,
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (isCancelled()) {
              hls.destroy();
              if (hlsRef.current === hls) hlsRef.current = null;
              resolve();
              return;
            }
            audio.currentTime = 0;
            audio
              .play()
              .then(() => resolve())
              .catch((err) => reject(err));
          });

          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) {
              hls.destroy();
              if (hlsRef.current === hls) hlsRef.current = null;
              reject(new Error(`HLS playback error: ${data.details || data.type}`));
            }
          });

          hls.loadSource(playUrl);
          hls.attachMedia(audio);
        });
        return;
      }

      audio.src = playUrl;
      audio.load();
      audio.currentTime = 0;
      await audio.play();
    },
    [destroyHls, effectiveVolume]
  );

  const playSoundCloudTrack = useCallback(
    async (
      track: Track,
      audio: HTMLAudioElement,
      isCancelled: () => boolean
    ) => {
      if (!track.streamEndpoint) {
        throw new Error("SoundCloud stream endpoint missing");
      }

      let resolvedUrl: string;
      if (isTauri()) {
        resolvedUrl = await safeInvoke<string>("resolve_soundcloud_stream", {
          streamEndpoint: track.streamEndpoint,
          trackAuthorization: track.trackAuthorization ?? null,
        });
      } else {
        resolvedUrl = await resolveSoundCloudStream(track.streamEndpoint);
      }

      if (isCancelled()) return;

      const isHls =
        track.streamProtocol === "hls" || resolvedUrl.includes(".m3u8");

      let finalUrl = resolvedUrl;
      if (isTauri()) {
        if (isHls) {
          const port = await safeInvoke<number>("start_hls_proxy", {
            m3u8Url: resolvedUrl,
          });
          finalUrl = `http://localhost:${port}/playlist.m3u8`;
        } else {
          const port = await safeInvoke<number>("start_audio_proxy", {
            url: resolvedUrl,
          });
          finalUrl = `http://localhost:${port}/`;
        }
      }

      if (isCancelled()) return;
      await attachAndPlayUrl(audio, finalUrl, isHls, isCancelled);
    },
    [attachAndPlayUrl]
  );

  const trySoundCloudRescue = useCallback(
    async (
      track: Track,
      audio: HTMLAudioElement,
      isCancelled: () => boolean
    ): Promise<boolean> => {
      try {
        const scMatch = await findSoundCloudMatch(track.title, track.artist);
        if (!scMatch || isCancelled()) return false;
        console.log(`[Player] Rescuing "${track.title}" via SoundCloud:`, scMatch.title);
        useYtFallbackRef.current = false;
        setUseYtFallback(false);
        await playSoundCloudTrack(scMatch, audio, isCancelled);
        if (!isCancelled()) {
          setError("");
          setLoading(false);
          setIsPlaying(true);
        }
        return true;
      } catch (err) {
        console.warn("[Player] SoundCloud rescue failed:", err);
        return false;
      }
    },
    [playSoundCloudTrack, setIsPlaying]
  );

  // Load track when currentTrack or retrySeq changes
  useEffect(() => {
    if (!currentTrack) return;

    const audio = audioRef.current;
    if (!audio) return;

    setError("");
    setLoading(true);
    setBufferedPct(0);
    setCurrentTime(0);
    setDuration(currentTrack.duration || 0);
    destroyHls();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.pauseVideo();
      } catch {
        // ignore
      }
    }

    let cancelled = false;

    const load = async () => {
      try {
        useYtFallbackRef.current = false;
        setUseYtFallback(false);
        setYtHost("https://www.youtube-nocookie.com");
        ytPlayerRef.current = null;

        if (currentTrack.source === "local" && currentTrack.localPath && isTauri()) {
          const port = await safeInvoke<number>("start_local_file_proxy", {
            filePath: currentTrack.localPath,
          });
          const localUrl = `http://localhost:${port}/`;
          await attachAndPlayUrl(audio, localUrl, false, () => cancelled);
        } else if (currentTrack.previewUrl) {
          await attachAndPlayUrl(audio, currentTrack.previewUrl, false, () => cancelled);
          if (currentTrack.duration) setDuration(currentTrack.duration);
        } else if (currentTrack.source === "soundcloud" && currentTrack.streamEndpoint) {
          await playSoundCloudTrack(currentTrack, audio, () => cancelled);
        } else if (isTauri()) {
          let proxyUrl = "";
          try {
            const audioUrl = await safeInvoke<string>("get_invidious_audio_url", {
              videoId: currentTrack.id,
            });
            const port = await safeInvoke<number>("start_audio_proxy", { url: audioUrl });
            proxyUrl = `http://localhost:${port}/`;
          } catch (rustErr) {
            console.warn("[Player] YouTube audio resolution failed, trying SoundCloud rescue:", rustErr);
            if (cancelled) return;
            const rescued = await trySoundCloudRescue(currentTrack, audio, () => cancelled);
            if (rescued || cancelled) return;
            useYtFallbackRef.current = true;
            setUseYtFallback(true);
            return;
          }

          if (cancelled) return;
          await attachAndPlayUrl(audio, proxyUrl, false, () => cancelled);
        } else {
          // Browser dev preview fallback
          let browserUrl = "";
          try {
            browserUrl = await getDirectAudioUrl(currentTrack.id);
          } catch {
            if (cancelled) return;
            const rescued = await trySoundCloudRescue(currentTrack, audio, () => cancelled);
            if (rescued || cancelled) return;
            useYtFallbackRef.current = true;
            setUseYtFallback(true);
            return;
          }

          if (cancelled) return;
          await attachAndPlayUrl(audio, browserUrl, false, () => cancelled);
        }

        if (cancelled) {
          destroyHls();
          audio.pause();
          return;
        }
        setLoading(false);
        setIsPlaying(true);
      } catch (e: any) {
        if (cancelled) return;

        // If handleError already handed off to YouTube fallback (or load() aborted play()), don't overwrite it with an error!
        if (useYtFallbackRef.current) {
          return;
        }

        if (e?.name !== "NotAllowedError" && currentTrack && !currentTrack.previewUrl) {
          if (currentTrack.source !== "soundcloud" && currentTrack.source !== "local") {
            const rescued = await trySoundCloudRescue(currentTrack, audio, () => cancelled);
            if (rescued || cancelled) return;

            console.warn("[Player] Audio playback rejected, falling back to YouTube iframe:", e);
            useYtFallbackRef.current = true;
            destroyHls();
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            setUseYtFallback(true);
            return;
          }
        }

        setLoading(false);
        if (e?.name === "NotAllowedError") {
          setError("Click Play to start playback");
        } else {
          setError(e?.message || "Playback failed. Click to retry.");
        }
        setIsPlaying(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      destroyHls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, retrySeq]);

  // Sync play/pause
  useEffect(() => {
    if (loading) return;

    if (useYtFallback) {
      if (ytPlayerRef.current) {
        try {
          if (isPlaying) ytPlayerRef.current.playVideo();
          else ytPlayerRef.current.pauseVideo();
        } catch {
          // ignore
        }
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      audio.play().catch((e) => {
        if (e?.name === "NotAllowedError") setError("Click Play to start playback");
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, useYtFallback, loading, currentTrack, setIsPlaying]);

  // Volume sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = effectiveVolume;
    }
    if (useYtFallback && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.setVolume(effectiveVolume * 100);
      } catch {
        // ignore
      }
    }
  }, [effectiveVolume, useYtFallback]);

  // YouTube fallback time update
  useEffect(() => {
    if (useYtFallback && isPlaying) {
      const interval = window.setInterval(async () => {
        if (isDraggingRef.current) return;
        try {
          if (ytPlayerRef.current && ytPlayerRef.current.getIframe()) {
            const t = await ytPlayerRef.current.getCurrentTime();
            setCurrentTime(t);
          }
        } catch {
          // ignore
        }
      }, 400);
      return () => window.clearInterval(interval);
    }
  }, [useYtFallback, isPlaying, setCurrentTime]);

  // Sync Media Session seek & position state
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    try {
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") seekToTime(details.seekTime);
      });
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        seekToTime(Math.max(0, currentTime - (details.seekOffset || 10)));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        seekToTime(currentTime + (details.seekOffset || 10));
      });
      if (duration > 0 && "setPositionState" in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(duration, Math.max(0, currentTime)),
        });
      }
    } catch {
      // Some webviews restrict specific MediaSession handlers
    }
  }, [currentTrack, currentTime, duration, seekToTime]);

  const togglePlay = useCallback(() => {
    if (!currentTrack || loading) return;
    if (error) {
      setError("");
      setRetrySeq((s) => s + 1);
      return;
    }
    setIsPlaying(!isPlaying);
  }, [currentTrack, isPlaying, loading, error, setIsPlaying]);

  const computePctFromClientX = useCallback((clientX: number) => {
    const bar = progressBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.preventDefault();
    setIsDragging(true);
    const pct = computePctFromClientX(e.clientX);
    setDragPct(pct * 100);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: PointerEvent) => {
      const pct = computePctFromClientX(e.clientX);
      setDragPct(pct * 100);
    };

    const handleUp = (e: PointerEvent) => {
      const pct = computePctFromClientX(e.clientX);
      setIsDragging(false);
      setDragPct(null);
      if (duration > 0) {
        seekToTime(pct * duration);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [isDragging, computePctFromClientX, duration, seekToTime]);

  const handleBarHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const pct = computePctFromClientX(e.clientX);
    setHoverTime({ pct: pct * 100, time: pct * duration });
  };

  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    onVolumeChange(Math.min(1, Math.max(0, volume + delta)));
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r < 10 ? "0" : ""}${r}`;
  };

  const livePct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const pct = dragPct !== null ? dragPct : livePct;

  const volumeIcon = muted || volume === 0 ? "volume_off" : volume < 0.45 ? "volume_down" : "volume_up";

  const origin =
    typeof window !== "undefined" &&
    (window.location.origin.startsWith("http://localhost") ||
      window.location.origin.startsWith("https://"))
      ? window.location.origin
      : undefined;

  return (
    <>
      {useYtFallback && currentTrack && (
        <div
          className="fixed -left-[9999px] top-0 w-[240px] h-[200px] opacity-[0.01] pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          <YouTube
            key={`${currentTrack.id}-${ytHost}-${retrySeq}`}
            videoId={currentTrack.id}
            opts={{
              width: "240",
              height: "200",
              host: ytHost,
              playerVars: {
                autoplay: 1,
                controls: 0,
                playsinline: 1,
                ...(origin ? { origin } : {}),
              },
            }}
            onReady={(e) => {
              ytPlayerRef.current = e.target;
              e.target.setVolume(effectiveVolume * 100);
              const d = e.target.getDuration();
              if (d) setDuration(d);
              setError("");
              setLoading(false);
              setIsPlaying(true);
              e.target.seekTo(0, true);
              e.target.playVideo();
            }}
            onPlay={() => {
              setError("");
              setLoading(false);
              setIsPlaying(true);
            }}
            onPause={() => setIsPlaying(false)}
            onError={async (e) => {
              const code = e?.data;
              console.warn(`[Player] YouTube fallback error (host=${ytHost}, code=${code})`);
              if (ytHost === "https://www.youtube-nocookie.com") {
                setYtHost("https://www.youtube.com");
                return;
              }
              const track = currentTrackRef.current;
              const audio = audioRef.current;
              if (track && audio && track.source !== "soundcloud") {
                const rescued = await trySoundCloudRescue(
                  track,
                  audio,
                  () => currentTrackRef.current?.id !== track.id
                );
                if (rescued) return;
              }
              setLoading(false);
              setIsPlaying(false);
              if (code === 101 || code === 150) {
                setError("Embed restricted by uploader.");
              } else if (code === 100) {
                setError("Video unavailable.");
              } else {
                setError(code ? `Playback error (code ${code}).` : "Playback failed. Click to retry.");
              }
            }}
            onStateChange={(e) => {
              if (e.data === 1) {
                const d = e.target.getDuration();
                if (d) setDuration(d);
              }
              if (e.data === 0) {
                if (repeatModeRef.current === "one") {
                  e.target.seekTo(0, true);
                  e.target.playVideo();
                  return;
                }
                setIsPlaying(false);
                onNextTrack();
              }
            }}
          />
        </div>
      )}

      {currentTrack && (
        <footer className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-4xl px-4 md:px-6 z-50">
          {/* Centered Status / Error Pill */}
          <div className="absolute -top-4 left-0 w-full flex justify-center z-50 pointer-events-none">
            {loading && (
              <div className="pointer-events-auto flex items-center gap-2 text-[10px] text-white/75 font-semibold bg-[#141418]/90 backdrop-blur-xl px-3.5 py-1 rounded-full border border-white/15 shadow-lg">
                <div className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                Connecting stream...
              </div>
            )}
            {error && !loading && (
              <div className="pointer-events-auto flex items-center gap-2 text-[11px] text-rose-200 font-semibold bg-rose-500/25 backdrop-blur-xl px-3.5 py-1 rounded-full border border-rose-400/30 shadow-lg">
                <button type="button" onClick={togglePlay} className="hover:underline">
                  ⚠ {error}
                </button>
                <span className="text-white/30">|</span>
                <button
                  type="button"
                  onClick={() => onNextTrack(false)}
                  className="text-white/80 hover:text-white underline"
                >
                  Skip
                </button>
              </div>
            )}
          </div>

          <div className="w-full glass-full">
            <GlassCard cornerRadius={28} blurAmount={0.02} displacementScale={80} className="w-full relative shadow-2xl">
              <div className="px-4 py-3 md:px-5 md:py-3.5 w-full flex flex-col gap-2.5">
                {/* Top Row: Balanced 3-Column Dock */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 md:gap-4 w-full">
                  {/* Left: Track Info + Like */}
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={onOpenNowPlaying}
                      className="w-11 h-11 rounded-xl overflow-hidden shrink-0 ring-1 ring-white/15 hover:ring-white/35 transition-all"
                      title="View Now Playing & Lyrics"
                    >
                      <img
                        className="w-full h-full object-cover"
                        src={currentTrack.coverUrl}
                        alt={currentTrack.title}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        dir="auto"
                        onClick={onOpenNowPlaying}
                        className="text-white font-semibold truncate text-xs md:text-sm cursor-pointer hover:underline"
                      >
                        {currentTrack.title}
                      </p>
                      <p dir="auto" className="text-white/55 text-[11px] truncate">
                        {currentTrack.artist}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onToggleLike}
                      className={`hidden sm:flex w-8 h-8 rounded-full items-center justify-center transition-colors shrink-0 ${
                        isLiked ? "text-rose-400 hover:bg-rose-500/15" : "text-white/45 hover:text-white hover:bg-white/10"
                      }`}
                      title="Like Song (L)"
                    >
                      <span
                        className="material-symbols-outlined text-[18px]"
                        style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}
                      >
                        favorite
                      </span>
                    </button>
                  </div>

                  {/* Center: Dead-Center Transport Controls */}
                  <div className="flex items-center justify-center gap-2 md:gap-3.5">
                    <button
                      type="button"
                      onClick={onToggleShuffle}
                      className={`relative w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                        shuffle ? "text-white" : "text-white/45 hover:text-white"
                      }`}
                      title="Shuffle (S)"
                    >
                      <span className="material-symbols-outlined text-[18px]">shuffle</span>
                      {shuffle && (
                        <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-white shadow-[0_0_6px_#fff]" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={onPrevTrack}
                      className="text-white/75 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
                      title="Previous (P)"
                    >
                      <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        skip_previous
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={togglePlay}
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.28)] hover:scale-105 active:scale-95 transition-transform"
                      title="Play / Pause (Space)"
                    >
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-black/25 border-t-black rounded-full animate-spin" />
                      ) : (
                        <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isPlaying ? "pause" : "play_arrow"}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onNextTrack(false)}
                      className="text-white/75 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
                      title="Next (N)"
                    >
                      <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        skip_next
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={onCycleRepeat}
                      className={`relative w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                        repeatMode !== "off" ? "text-white" : "text-white/45 hover:text-white"
                      }`}
                      title={`Repeat: ${repeatMode} (R)`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {repeatMode === "one" ? "repeat_one" : "repeat"}
                      </span>
                      {repeatMode !== "off" && (
                        <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-white shadow-[0_0_6px_#fff]" />
                      )}
                    </button>
                  </div>

                  {/* Right: Volume + Queue */}
                  <div className="hidden sm:flex items-center justify-end gap-2.5 min-w-0">
                    <div
                      className="flex items-center gap-1.5"
                      onWheel={handleVolumeWheel}
                      title="Scroll to adjust volume"
                    >
                      <button
                        type="button"
                        onClick={onToggleMute}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                        title="Mute / Unmute (M)"
                      >
                        <span className="material-symbols-outlined text-[18px]">{volumeIcon}</span>
                      </button>
                      <div className="relative w-20 md:w-24 h-4 flex items-center group">
                        <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden">
                          <div
                            className="h-full bg-white/85 group-hover:bg-white rounded-full transition-colors"
                            style={{ width: `${effectiveVolume * 100}%` }}
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={effectiveVolume}
                          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          aria-label="Volume"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={onToggleQueue}
                      className="relative w-8 h-8 flex items-center justify-center rounded-full text-white/65 hover:text-white hover:bg-white/10 transition-colors"
                      title="Queue & Library (Q)"
                    >
                      <span className="material-symbols-outlined text-[19px]">queue_music</span>
                      {queueCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-white text-black text-[9px] font-bold flex items-center justify-center">
                          {queueCount}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Bottom Row: Slim Full-Width Scrub Bar */}
                <div className="w-full flex items-center gap-3">
                  <span className="text-[11px] text-white/55 w-9 text-right tabular-nums shrink-0">
                    {fmt(dragPct !== null ? (dragPct / 100) * duration : currentTime)}
                  </span>

                  <div
                    ref={progressBarRef}
                    onPointerDown={handlePointerDown}
                    onMouseMove={handleBarHover}
                    onMouseLeave={() => setHoverTime(null)}
                    className="flex-1 h-1 bg-white/12 rounded-full relative group cursor-pointer hover:h-1.5 transition-all touch-none"
                  >
                    {hoverTime && (
                      <div
                        className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/85 text-[10px] font-mono text-white pointer-events-none border border-white/10"
                        style={{ left: `${hoverTime.pct}%` }}
                      >
                        {fmt(hoverTime.time)}
                      </div>
                    )}
                    <div
                      className="absolute inset-y-0 left-0 bg-white/18 rounded-full"
                      style={{ width: `${bufferedPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-white rounded-full"
                      style={{ width: `${pct}%`, boxShadow: "0 0 8px rgba(255,255,255,0.4)" }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                      style={{ left: `${pct}%` }}
                    />
                  </div>

                  <span className="text-[11px] text-white/55 w-9 tabular-nums shrink-0">
                    {fmt(duration)}
                  </span>
                </div>
              </div>
            </GlassCard>
          </div>
        </footer>
      )}
    </>
  );
};

export default Player;
