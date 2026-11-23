import React, { useEffect, useRef, useState } from "react";
import { LyricLine, Playlist, Track } from "../types/music";
import { fetchTrackLyrics } from "../utils/lyrics";

function isRtlText(text: string): boolean {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

interface LyricsViewProps {
  currentTrack: Track | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  accentColor: string;
  isLiked: boolean;
  onToggleLike: () => void;
  onAddToQueue: () => void;
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: string) => void;
  onOpenQueue: () => void;
}

const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  currentTime,
  isPlaying,
  onPlayPause,
  onSeek,
  accentColor,
  isLiked,
  onToggleLike,
  onAddToQueue,
  playlists,
  onAddToPlaylist,
  onOpenQueue,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const manualScrollUntilRef = useRef<number>(0);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lyricsStatus, setLyricsStatus] = useState<
    "loading" | "ready" | "unavailable-notice" | "hidden"
  >("loading");
  const [isSynced, setIsSynced] = useState(true);
  const [lyricOffset, setLyricOffset] = useState(0);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [queuedFlash, setQueuedFlash] = useState(false);

  useEffect(() => {
    setLyricOffset(0);
    setPlaylistMenuOpen(false);
    if (!currentTrack) {
      setLyrics([]);
      setActiveIndex(-1);
      setLyricsStatus("hidden");
      return;
    }

    let cancelled = false;
    let hideTimer: number | undefined;
    setLyricsStatus("loading");

    const markUnavailable = () => {
      setLyrics([]);
      setIsSynced(false);
      setActiveIndex(-1);
      setLyricsStatus("unavailable-notice");
      hideTimer = window.setTimeout(() => {
        if (!cancelled) setLyricsStatus("hidden");
      }, 3200);
    };

    fetchTrackLyrics(currentTrack)
      .then((res) => {
        if (cancelled) return;
        if (res.lines.length === 0) {
          markUnavailable();
          return;
        }
        setLyrics(res.lines);
        setIsSynced(res.isSynced);
        setActiveIndex(-1);
        setLyricsStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[Lyrics] Failed to fetch lyrics:", err);
        markUnavailable();
      });

    return () => {
      cancelled = true;
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [currentTrack]);

  useEffect(() => {
    if (lyrics.length === 0 || !isSynced) {
      setActiveIndex(-1);
      return;
    }

    const effectiveTime = currentTime + lyricOffset;
    let currentActive = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (effectiveTime >= lyrics[i].time) {
        currentActive = i;
      } else {
        break;
      }
    }
    setActiveIndex(currentActive);
  }, [currentTime, lyricOffset, lyrics, isSynced]);

  useEffect(() => {
    if (activeIndex === -1 || !listRef.current) return;
    if (Date.now() < manualScrollUntilRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [activeIndex]);

  if (!currentTrack) {
    return null;
  }

  const handleManualScroll = () => {
    manualScrollUntilRef.current = Date.now() + 3500;
  };

  const handleQueue = () => {
    onAddToQueue();
    setQueuedFlash(true);
    window.setTimeout(() => setQueuedFlash(false), 1200);
  };

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
      {/* Left: Album Art with ambient glow */}
      <div className="flex justify-center lg:justify-end w-full min-w-0">
        <div className="relative w-full max-w-[440px] aspect-square shrink-0">
          {/* Ambient glow behind cover */}
          <div
            className={`absolute -inset-6 rounded-[64px] blur-3xl transition-opacity duration-1000 pointer-events-none ${
              isPlaying ? "opacity-45" : "opacity-20"
            }`}
            style={{ background: accentColor }}
          />

          <div
            className={`relative w-full h-full rounded-[44px] overflow-hidden glass-card p-2 group z-10 transition-transform duration-700 ${
              isPlaying ? "scale-[1.01]" : "scale-100"
            }`}
          >
            <img
              className="w-full h-full object-cover rounded-[36px] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
            />
            {/* Play Overlay (Hover) */}
            <div
              onClick={onPlayPause}
              className="absolute inset-2 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm cursor-pointer z-20 rounded-[36px]"
            >
              <div className="w-20 h-20 glass-btn rounded-full flex items-center justify-center text-white hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isPlaying ? "pause" : "play_arrow"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Track Info & Interactive Lyrics */}
      <div
        className={`flex flex-col items-center lg:items-stretch text-center lg:text-start h-full w-full min-w-0 max-h-[72vh] ${
          lyricsStatus === "hidden" || lyricsStatus === "unavailable-notice"
            ? "justify-center"
            : ""
        }`}
      >
        <div className="mb-3 flex items-center gap-2.5 flex-wrap justify-center lg:justify-start">
          <span className="px-3.5 py-1 glass-island rounded-full text-[11px] font-bold tracking-[0.2em] text-white/90 uppercase inline-flex items-center gap-2">
            {isPlaying ? (
              <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
                <span className="eq-bar w-[2.5px] bg-white rounded-full" style={{ animationDelay: "0s" }} />
                <span className="eq-bar w-[2.5px] bg-white rounded-full" style={{ animationDelay: "0.2s" }} />
                <span className="eq-bar w-[2.5px] bg-white rounded-full" style={{ animationDelay: "0.4s" }} />
              </span>
            ) : null}
            {isPlaying ? "Playing" : "Paused"}
          </span>

          {isSynced && lyrics.length > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-white/8 border border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/65">
              Synced · Tap line to seek
            </span>
          )}
        </div>

        <h2
          dir="auto"
          className="font-display-lg text-3xl md:text-5xl text-white mb-1.5 leading-tight drop-shadow-lg truncate w-full max-w-full"
        >
          {currentTrack.title}
        </h2>
        <p dir="auto" className="font-body-lg text-base md:text-lg text-white/65 mb-4 drop-shadow-md truncate w-full max-w-full">
          {currentTrack.artist}
        </p>

        {/* Action Strip */}
        <div className="flex items-center flex-wrap justify-center lg:justify-start gap-2 mb-5">
          <button
            type="button"
            onClick={onToggleLike}
            className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 border transition-colors ${
              isLiked
                ? "bg-rose-500/20 border-rose-400/35 text-rose-300"
                : "bg-white/6 hover:bg-white/12 border-white/10 text-white/75"
            }`}
            title="Like Song (L)"
          >
            <span
              className="material-symbols-outlined text-[16px]"
              style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}
            >
              favorite
            </span>
            <span>{isLiked ? "Liked" : "Like"}</span>
          </button>

          <button
            type="button"
            onClick={handleQueue}
            className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 bg-white/6 hover:bg-white/12 border border-white/10 text-white/75 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {queuedFlash ? "check" : "playlist_add"}
            </span>
            <span>{queuedFlash ? "Queued" : "Queue"}</span>
          </button>

          {playlists.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPlaylistMenuOpen((prev) => !prev)}
                className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 bg-white/6 hover:bg-white/12 border border-white/10 text-white/75 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">library_add</span>
                <span>Playlist</span>
              </button>

              {playlistMenuOpen && (
                <div className="absolute left-0 top-9 w-48 rounded-xl border border-white/15 bg-[#16161b]/95 backdrop-blur-2xl shadow-2xl p-1.5 z-40 text-left">
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => {
                        onAddToPlaylist(pl.id);
                        setPlaylistMenuOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-white/85 hover:bg-white/10 truncate"
                    >
                      {pl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onOpenQueue}
            className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 bg-white/6 hover:bg-white/12 border border-white/10 text-white/75 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">queue_music</span>
            <span>Up Next</span>
          </button>

          {isSynced && lyrics.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/6 border border-white/10 text-[11px] text-white/70">
              <button
                type="button"
                onClick={() => setLyricOffset((o) => Number((o - 0.5).toFixed(1)))}
                className="px-1.5 hover:text-white"
                title="Delay lyrics (-0.5s)"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => setLyricOffset(0)}
                className="px-1 font-mono text-white/90"
                title="Reset sync offset"
              >
                {lyricOffset >= 0 ? `+${lyricOffset.toFixed(1)}s` : `${lyricOffset.toFixed(1)}s`}
              </button>
              <button
                type="button"
                onClick={() => setLyricOffset((o) => Number((o + 0.5).toFixed(1)))}
                className="px-1.5 hover:text-white"
                title="Advance lyrics (+0.5s)"
              >
                +0.5s
              </button>
            </div>
          )}
        </div>

        {/* Lyrics Area / Unavailable Notice */}
        {lyricsStatus === "unavailable-notice" && (
          <div className="inline-flex items-center gap-2 self-center lg:self-start px-4 py-2 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/70 animate-fade-in">
            <span className="material-symbols-outlined text-[16px] text-white/50">lyrics</span>
            <span>Lyrics unavailable for this track</span>
          </div>
        )}

        {(lyricsStatus === "loading" || lyricsStatus === "ready") && (
          <div className="w-full flex-1 relative min-h-[260px] max-h-[420px] rounded-[32px] overflow-hidden bg-white/[0.03] border border-white/10 backdrop-blur-2xl">
            <div
              ref={scrollContainerRef}
              onWheel={handleManualScroll}
              onTouchMove={handleManualScroll}
              className="w-full h-full overflow-y-auto overflow-x-hidden custom-scrollbar lyrics-mask"
            >
              <div
                ref={listRef}
                className="space-y-5 font-body-lg text-[20px] md:text-[22px] leading-[1.75] text-center lg:text-start py-10 px-7 pb-32"
              >
                {lyricsStatus === "loading" ? (
                  <p className="lyric-inactive animate-pulse">Loading lyrics...</p>
                ) : (
                  lyrics.map((line, idx) => {
                    const isActive = isSynced ? idx === activeIndex : false;
                    const rtl = isRtlText(line.text);
                    return (
                      <p
                        key={`${idx}-${line.time}`}
                        dir="auto"
                        onClick={() => {
                          if (isSynced) {
                            manualScrollUntilRef.current = 0;
                            onSeek(Math.max(0, line.time - lyricOffset));
                          }
                        }}
                        className={`transition-all duration-300 transform text-center lg:text-start origin-center ${
                          rtl ? "lg:origin-right" : "lg:origin-left"
                        } ${isSynced ? "cursor-pointer" : ""} ${
                          isActive
                            ? "lyric-active font-semibold scale-[1.02]"
                            : "lyric-inactive hover:opacity-90"
                        }`}
                      >
                        {line.text}
                      </p>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LyricsView;
