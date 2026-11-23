import React, { useEffect, useRef, useState } from "react";
import { GlassCard } from "@developer-hub/liquid-glass";
import { MusicSource, Playlist, Track } from "../types/music";

interface SearchBarProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (val: string) => void;
  onSubmitSearch: (query: string) => void;
  searchSource: MusicSource;
  onChangeSearchSource: (source: MusicSource) => void;
  results: Track[];
  searching: boolean;
  error: string;
  showResults: boolean;
  onShowResultsChange: (show: boolean) => void;
  recentSearches: string[];
  onClearRecentSearches: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  likedIds: Set<string>;
  playlists: Playlist[];
  onPlayTrack: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, track: Track) => void;
}

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0:00";
  const mins = Math.floor(secs / 60);
  const rSecs = Math.floor(secs % 60);
  return `${mins}:${rSecs < 10 ? "0" : ""}${rSecs}`;
}

export default function SearchBar({
  inputRef,
  query,
  onQueryChange,
  onSubmitSearch,
  searchSource,
  onChangeSearchSource,
  results,
  searching,
  error,
  showResults,
  onShowResultsChange,
  recentSearches,
  onClearRecentSearches,
  currentTrack,
  isPlaying,
  likedIds,
  playlists,
  onPlayTrack,
  onAddToQueue,
  onToggleLike,
  onAddToPlaylist,
}: SearchBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [playlistMenuTrackId, setPlaylistMenuTrackId] = useState<string | null>(null);
  const [queuedFlashId, setQueuedFlashId] = useState<string | null>(null);

  useEffect(() => {
    setHighlightedIdx(-1);
  }, [results]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onShowResultsChange(false);
        setPlaylistMenuTrackId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onShowResultsChange]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightedIdx >= 0 && results[highlightedIdx]) {
      onPlayTrack(results[highlightedIdx]);
      setPlaylistMenuTrackId(null);
      return;
    }
    if (query.trim()) {
      onSubmitSearch(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onShowResultsChange(false);
      setPlaylistMenuTrackId(null);
      inputRef.current?.blur();
      return;
    }
    if (!showResults || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    }
  };

  const handleQueueClick = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    onAddToQueue(track);
    setQueuedFlashId(track.id);
    window.setTimeout(() => {
      setQueuedFlashId((curr) => (curr === track.id ? null : curr));
    }, 1200);
  };

  const showRecentDropdown = showResults && !query.trim() && recentSearches.length > 0 && results.length === 0 && !error;
  const showResultsDropdown = showResults && (results.length > 0 || Boolean(error) || searching);

  return (
    <header className="fixed top-9 pt-5 left-0 w-full z-40 bg-transparent flex flex-col items-center px-4 md:px-8 pointer-events-none">
      <div ref={containerRef} className="w-full max-w-[920px] relative pointer-events-auto">
        <div className="w-full relative glass-full">
          <GlassCard
            cornerRadius={999}
            blurAmount={0.02}
            displacementScale={90}
            className="w-full relative shadow-xl"
            style={{ width: "100%", display: "block" }}
          >
            <form onSubmit={handleFormSubmit} className="flex items-center gap-3 px-5 py-3 w-full">
              <span className="material-symbols-outlined text-primary/90 shrink-0">search</span>
              <input
                ref={inputRef}
                dir="auto"
                className="bg-transparent border-none focus:outline-none text-base md:text-lg text-on-surface placeholder:text-on-surface-variant/45 w-full min-w-0"
                placeholder="Search songs, artists, or paste a mood..."
                type="text"
                value={query}
                onChange={(e) => {
                  const val = e.target.value;
                  onQueryChange(val);
                  if (!val.trim()) {
                    setHighlightedIdx(-1);
                    onShowResultsChange(recentSearches.length > 0);
                  }
                }}
                onFocus={() => {
                  if (results.length > 0 || error || (!query.trim() && recentSearches.length > 0)) {
                    onShowResultsChange(true);
                  }
                }}
                onKeyDown={handleKeyDown}
              />

              {searching ? (
                <div className="w-5 h-5 border-2 border-white/25 border-t-white rounded-full animate-spin shrink-0" />
              ) : query ? (
                <button
                  type="button"
                  onClick={() => {
                    onQueryChange("");
                    onShowResultsChange(recentSearches.length > 0);
                    inputRef.current?.focus();
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  title="Clear search"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-mono text-white/45 bg-white/5 border border-white/10 rounded-full shrink-0">
                  Ctrl K
                </kbd>
              )}

              {/* Source Switcher */}
              <div
                className="flex items-center bg-white/6 border border-white/10 rounded-full p-0.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onChangeSearchSource("soundcloud")}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    searchSource === "soundcloud"
                      ? "bg-white text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                  title="Search SoundCloud (full-length tracks)"
                >
                  SoundCloud
                </button>
                <button
                  type="button"
                  onClick={() => onChangeSearchSource("youtube")}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    searchSource === "youtube"
                      ? "bg-white text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                  title="Search YouTube"
                >
                  YouTube
                </button>
              </div>
            </form>
          </GlassCard>
        </div>

        {/* Recent Searches Dropdown */}
        {showRecentDropdown && (
          <div className="absolute top-full left-0 right-0 mt-3 z-50">
            <div className="w-full shadow-2xl border border-white/15 bg-[#121216]/85 backdrop-blur-2xl rounded-[24px] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/45">
                  Recent Searches
                </span>
                <button
                  type="button"
                  onClick={onClearRecentSearches}
                  className="text-[11px] text-white/45 hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    type="button"
                    dir="auto"
                    onClick={() => {
                      onQueryChange(term);
                      onSubmitSearch(term);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-xs text-white/85 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px] text-white/45">history</span>
                    <span>{term}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Search Results Dropdown */}
        {showResultsDropdown && (
          <div className="absolute top-full left-0 right-0 mt-3 z-50">
            <div className="w-full relative shadow-2xl border border-white/15 bg-[#121216]/85 backdrop-blur-2xl rounded-[24px]">
              <div className="max-h-[56vh] flex flex-col overflow-hidden rounded-[24px]">
                <div className="overflow-y-auto overflow-x-hidden custom-scrollbar">
                  {searching && results.length === 0 && (
                    <div className="p-6 text-center text-xs text-white/60 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin" />
                      Searching music catalog...
                    </div>
                  )}

                  {error && (
                    <div className="p-4 text-rose-300 text-xs font-semibold text-center">{error}</div>
                  )}

                  {results.length > 0 && (
                    <div className="py-2">
                      {results.map((track, index) => {
                        const isCurrent = currentTrack?.id === track.id;
                        const isLiked = likedIds.has(track.id);
                        const isHighlighted = index === highlightedIdx;
                        const justQueued = queuedFlashId === track.id;
                        const menuOpen = playlistMenuTrackId === track.id;

                        return (
                          <div
                            key={track.id}
                            onClick={() => {
                              onPlayTrack(track);
                              setPlaylistMenuTrackId(null);
                            }}
                            className={`relative flex items-center gap-3.5 px-4 md:px-5 py-2.5 cursor-pointer transition-colors duration-150 group ${
                              isHighlighted || isCurrent ? "bg-white/12" : "hover:bg-white/8"
                            }`}
                          >
                            <div className="relative w-11 h-11 rounded-xl overflow-hidden shadow-md border border-white/10 shrink-0">
                              <img
                                src={track.coverUrl}
                                alt={track.title}
                                className="w-full h-full object-cover"
                              />
                              <div
                                className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${
                                  isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                              >
                                <span
                                  className="material-symbols-outlined text-[20px] text-white"
                                  style={{ fontVariationSettings: "'FILL' 1" }}
                                >
                                  {isCurrent && isPlaying ? "pause" : "play_arrow"}
                                </span>
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <p
                                dir="auto"
                                className={`truncate text-sm font-semibold ${
                                  isCurrent ? "text-white" : "text-white/95"
                                }`}
                              >
                                {track.title}
                              </p>
                              <p dir="auto" className="truncate text-xs text-white/55">
                                {track.artist}
                              </p>
                            </div>

                            <span className="hidden sm:inline text-xs text-white/45 font-mono shrink-0">
                              {formatDuration(track.duration)}
                            </span>

                            {/* Row Actions */}
                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => handleQueueClick(e, track)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                  justQueued
                                    ? "bg-emerald-500/25 text-emerald-300"
                                    : "text-white/55 hover:text-white hover:bg-white/10"
                                }`}
                                title="Add to Queue"
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {justQueued ? "check" : "playlist_add"}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleLike(track);
                                }}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                  isLiked
                                    ? "text-rose-400 hover:bg-rose-500/15"
                                    : "text-white/55 hover:text-white hover:bg-white/10"
                                }`}
                                title={isLiked ? "Remove from Liked" : "Like Song"}
                              >
                                <span
                                  className="material-symbols-outlined text-[18px]"
                                  style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}
                                >
                                  favorite
                                </span>
                              </button>

                              {playlists.length > 0 && (
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPlaylistMenuTrackId(menuOpen ? null : track.id);
                                    }}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors"
                                    title="Add to Playlist"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">library_add</span>
                                  </button>

                                  {menuOpen && (
                                    <div className="absolute right-0 top-9 w-48 rounded-xl border border-white/15 bg-[#18181d]/95 backdrop-blur-2xl shadow-2xl p-1.5 z-[70]">
                                      <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
                                        Add to Playlist
                                      </p>
                                      {playlists.map((pl) => (
                                        <button
                                          key={pl.id}
                                          type="button"
                                          onClick={() => {
                                            onAddToPlaylist(pl.id, track);
                                            setPlaylistMenuTrackId(null);
                                          }}
                                          className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-white/80 hover:bg-white/10 truncate"
                                        >
                                          {pl.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
