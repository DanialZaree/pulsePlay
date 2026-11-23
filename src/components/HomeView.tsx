import React, { useMemo, useRef, useState } from "react";
import { Playlist, Track } from "../types/music";
import { isTauri } from "../utils/tauri";

interface HomeViewProps {
  recentTracks: Track[];
  likedTracks: Track[];
  playlists: Playlist[];
  localTracks: Track[];
  localFolder: string;
  scanningLocal: boolean;
  localScanError: string;
  currentTrack: Track | null;
  isPlaying: boolean;
  onPlayTrackList: (tracks: Track[], startIndex?: number, shuffle?: boolean) => void;
  onAddToQueue: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  likedIds: Set<string>;
  onCreatePlaylist: (name: string) => void;
  onOpenLibraryTab: (tab: "liked" | "playlists" | "local") => void;
  onPickLocalFiles: (files: FileList) => void;
  onPickLocalFolder: () => void;
  onScanLocalFolder: (customPath?: string) => void;
  onRemoveLocalTrack: (trackId: string) => void;
}

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function HomeView({
  recentTracks,
  likedTracks,
  playlists,
  localTracks,
  localFolder,
  scanningLocal,
  localScanError,
  currentTrack,
  isPlaying,
  onPlayTrackList,
  onAddToQueue,
  onToggleLike,
  likedIds,
  onCreatePlaylist,
  onOpenLibraryTab,
  onPickLocalFiles,
  onPickLocalFolder,
  onScanLocalFolder,
  onRemoveLocalTrack,
}: HomeViewProps) {
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [localFilter, setLocalFilter] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const inTauri = isTauri();

  const filteredLocalTracks = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return localTracks;
    return localTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [localTracks, localFilter]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    onCreatePlaylist(trimmed);
    setNewPlaylistName("");
    setCreatingPlaylist(false);
  };

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-8 py-4 animate-fade-in">
      {/* Hidden native pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.webm"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onPickLocalFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported in Chromium/WebView2
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onPickLocalFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Local Music Section */}
      <section className="glass-card rounded-[28px] p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500/35 to-indigo-500/35 border border-white/15 flex items-center justify-center text-sky-300 shrink-0">
              <span className="material-symbols-outlined text-[22px]">folder_open</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white">Local Music</h2>
              <p className="text-xs text-white/55 truncate">
                {localTracks.length > 0
                  ? `${localTracks.length} local ${localTracks.length === 1 ? "track" : "tracks"}${
                      localFolder ? ` · ${localFolder}` : ""
                    }`
                  : "Play MP3, FLAC, WAV, M4A, or OGG files from your device"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {localTracks.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onPlayTrackList(localTracks, 0, false)}
                  className="px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 flex items-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    play_arrow
                  </span>
                  Play All
                </button>
                <button
                  type="button"
                  onClick={() => onPlayTrackList(localTracks, 0, true)}
                  className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/18 border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">shuffle</span>
                  Shuffle
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/18 border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">audio_file</span>
              Add Files
            </button>

            <button
              type="button"
              disabled={scanningLocal}
              onClick={() => {
                if (inTauri) {
                  onPickLocalFolder();
                } else {
                  folderInputRef.current?.click();
                }
              }}
              className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/18 border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
              {scanningLocal ? "Scanning..." : "Select Folder"}
            </button>

            {inTauri && (
              <button
                type="button"
                disabled={scanningLocal}
                onClick={() => onScanLocalFolder()}
                className="px-3 py-1.5 rounded-full bg-white/6 hover:bg-white/14 border border-white/10 text-xs text-white/80 transition-colors disabled:opacity-50"
                title="Quick-scan your default Music folder"
              >
                My Music
              </button>
            )}
          </div>
        </div>

        {localScanError && (
          <div className="px-4 py-2 rounded-2xl bg-rose-500/15 border border-rose-400/25 text-xs text-rose-200">
            {localScanError}
          </div>
        )}

        {localTracks.length > 0 ? (
          <>
            {localTracks.length > 5 && (
              <div className="relative">
                <span className="material-symbols-outlined text-[16px] text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2">
                  search
                </span>
                <input
                  type="text"
                  dir="auto"
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  placeholder="Filter local tracks..."
                  className="w-full pl-9 pr-4 py-2 rounded-full bg-white/6 border border-white/10 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/25"
                />
              </div>
            )}

            <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1 pr-1">
              {filteredLocalTracks.map((track, idx) => {
                const isCurrent = currentTrack?.id === track.id;
                const isLiked = likedIds.has(track.id);
                const formattedDur = formatDuration(track.duration);
                return (
                  <div
                    key={track.id}
                    onClick={() => onPlayTrackList(filteredLocalTracks, idx, false)}
                    className={`flex items-center gap-3 p-2 rounded-2xl cursor-pointer transition-colors group ${
                      isCurrent ? "bg-white/14" : "hover:bg-white/8"
                    }`}
                  >
                    <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-white/10 shrink-0 flex items-center justify-center">
                      {track.coverUrl ? (
                        <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <span className="material-symbols-outlined text-[18px] text-white/60">music_note</span>
                      )}
                      <div
                        className={`absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity ${
                          isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isCurrent && isPlaying ? "pause" : "play_arrow"}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p dir="auto" className="text-sm font-semibold text-white truncate">
                        {track.title}
                      </p>
                      <p dir="auto" className="text-xs text-white/55 truncate">
                        {track.artist}
                      </p>
                    </div>

                    {formattedDur && (
                      <span className="text-xs font-mono text-white/45 shrink-0">
                        {formattedDur}
                      </span>
                    )}

                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onAddToQueue(track)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10"
                        title="Add to Queue"
                      >
                        <span className="material-symbols-outlined text-[16px]">playlist_add</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLike(track)}
                        className={`w-7 h-7 rounded-full flex items-center justify-center ${
                          isLiked ? "text-rose-400" : "text-white/50 hover:text-white hover:bg-white/10"
                        }`}
                        title="Like"
                      >
                        <span
                          className="material-symbols-outlined text-[16px]"
                          style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          favorite
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveLocalTrack(track.id)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from list"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors text-center"
          >
            <span className="material-symbols-outlined text-3xl text-white/40">library_music</span>
            <p className="text-xs md:text-sm text-white/75 font-medium">
              Drag &amp; drop audio files anywhere, or click here to pick songs
            </p>
            <p className="text-[11px] text-white/45">
              Supports MP3, FLAC, WAV, M4A, AAC, OGG &amp; OPUS
            </p>
          </div>
        )}
      </section>

      {/* Liked Songs & Playlists Summary Row */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Liked Songs Card */}
        <div className="glass-card rounded-[28px] p-6 flex flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500/40 to-purple-500/40 border border-white/15 flex items-center justify-center text-rose-300 shrink-0">
              <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                favorite
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenLibraryTab("liked")}
              className="text-xs text-white/55 hover:text-white transition-colors"
            >
              View all
            </button>
          </div>

          <div>
            <h2 className="text-xl font-bold text-white">Liked Songs</h2>
            <p className="text-xs text-white/55 mt-1">
              {likedTracks.length} {likedTracks.length === 1 ? "track" : "tracks"} saved
            </p>
          </div>

          <button
            type="button"
            disabled={likedTracks.length === 0}
            onClick={() => onPlayTrackList(likedTracks, 0)}
            className="w-full py-2.5 rounded-full bg-white/12 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none text-xs font-bold uppercase tracking-wider text-white flex items-center justify-center gap-2 transition-colors border border-white/15"
          >
            <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              play_arrow
            </span>
            Play Liked
          </button>
        </div>

        {/* Playlists Section */}
        <div className="lg:col-span-2 glass-card rounded-[28px] p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Your Playlists</h2>
              <p className="text-xs text-white/55">
                {playlists.length === 0
                  ? "Create a playlist to organize your favorite tracks"
                  : `${playlists.length} custom ${playlists.length === 1 ? "playlist" : "playlists"}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {playlists.length > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenLibraryTab("playlists")}
                  className="px-3 py-1.5 rounded-full text-xs text-white/65 hover:text-white hover:bg-white/10 transition-colors"
                >
                  Manage
                </button>
              )}
              <button
                type="button"
                onClick={() => setCreatingPlaylist((prev) => !prev)}
                className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                New Playlist
              </button>
            </div>
          </div>

          {creatingPlaylist && (
            <form onSubmit={handleCreateSubmit} className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                dir="auto"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Playlist name..."
                className="flex-1 px-4 py-2 rounded-full bg-white/10 border border-white/15 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/35"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingPlaylist(false);
                  setNewPlaylistName("");
                }}
                className="px-3 py-2 rounded-full text-xs text-white/60 hover:text-white"
              >
                Cancel
              </button>
            </form>
          )}

          {playlists.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {playlists.slice(0, 4).map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => (pl.tracks.length > 0 ? onPlayTrackList(pl.tracks, 0) : onOpenLibraryTab("playlists"))}
                  className="flex items-center gap-3.5 p-3 rounded-2xl bg-white/5 hover:bg-white/12 border border-white/10 cursor-pointer transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
                    {pl.tracks[0]?.coverUrl ? (
                      <img src={pl.tracks[0].coverUrl} alt={pl.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="material-symbols-outlined text-white/45">queue_music</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p dir="auto" className="text-sm font-semibold text-white truncate">
                      {pl.name}
                    </p>
                    <p className="text-xs text-white/50">
                      {pl.tracks.length} {pl.tracks.length === 1 ? "song" : "songs"}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-white group-hover:text-black text-white flex items-center justify-center transition-colors shrink-0">
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      play_arrow
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !creatingPlaylist && (
              <div className="flex-1 flex items-center justify-center py-6 text-xs text-white/45 border border-dashed border-white/10 rounded-2xl">
                Save your queue or click &ldquo;New Playlist&rdquo; to start a collection.
              </div>
            )
          )}
        </div>
      </section>

      {/* Recently Played */}
      {recentTracks.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Recently Played</h2>
            <span className="text-xs text-white/45">{recentTracks.length} tracks</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {recentTracks.slice(0, 8).map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              const isLiked = likedIds.has(track.id);
              return (
                <div
                  key={track.id}
                  onClick={() => onPlayTrackList(recentTracks, idx, false)}
                  className="glass-card rounded-[24px] p-3.5 cursor-pointer group flex flex-col gap-3"
                >
                  <div className="relative aspect-square rounded-2xl overflow-hidden bg-white/5">
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div
                      className={`absolute inset-0 bg-black/35 flex items-center justify-center transition-opacity ${
                        isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <div className="w-11 h-11 rounded-full bg-white/90 text-black flex items-center justify-center shadow-lg">
                        <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {isCurrent && isPlaying ? "pause" : "play_arrow"}
                        </span>
                      </div>
                    </div>

                    {/* Quick hover actions */}
                    <div
                      className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onAddToQueue(track)}
                        className="w-7 h-7 rounded-full bg-black/60 backdrop-blur-md text-white hover:bg-black/80 flex items-center justify-center"
                        title="Add to Queue"
                      >
                        <span className="material-symbols-outlined text-[15px]">playlist_add</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLike(track)}
                        className={`w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center ${
                          isLiked ? "text-rose-400" : "text-white hover:bg-black/80"
                        }`}
                        title="Like"
                      >
                        <span
                          className="material-symbols-outlined text-[15px]"
                          style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          favorite
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p dir="auto" className="text-sm font-semibold text-white truncate">
                      {track.title}
                    </p>
                    <p dir="auto" className="text-xs text-white/55 truncate">
                      {track.artist}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
