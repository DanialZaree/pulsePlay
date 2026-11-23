import React, { useState } from "react";
import { DrawerTab, Playlist, Track } from "../types/music";

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: DrawerTab;
  onChangeTab: (tab: DrawerTab) => void;
  queue: Track[];
  queueIndex: number;
  currentTrack: Track | null;
  autoplay: boolean;
  onToggleAutoplay: () => void;
  onPlayFromQueue: (index: number) => void;
  onMoveQueueItem: (fromIndex: number, toIndex: number) => void;
  onRemoveFromQueue: (index: number) => void;
  onClearQueue: () => void;
  onSaveQueueAsPlaylist: (name: string) => void;
  likedTracks: Track[];
  onPlayTrackList: (tracks: Track[], startIndex?: number, shuffle?: boolean) => void;
  onToggleLike: (track: Track) => void;
  playlists: Playlist[];
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onRemoveFromPlaylist: (playlistId: string, trackId: string) => void;
  localTracks: Track[];
  onRemoveLocalTrack: (trackId: string) => void;
}

export default function QueueDrawer({
  open,
  onClose,
  activeTab,
  onChangeTab,
  queue,
  queueIndex,
  currentTrack,
  autoplay,
  onToggleAutoplay,
  onPlayFromQueue,
  onMoveQueueItem,
  onRemoveFromQueue,
  onClearQueue,
  onSaveQueueAsPlaylist,
  likedTracks,
  onPlayTrackList,
  onToggleLike,
  playlists,
  onCreatePlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
  localTracks,
  onRemoveLocalTrack,
}: QueueDrawerProps) {
  const [savingQueue, setSavingQueue] = useState(false);
  const [queuePlaylistName, setQueuePlaylistName] = useState("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  if (!open) return null;

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null;

  const handleSaveQueue = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = queuePlaylistName.trim();
    if (!trimmed) return;
    onSaveQueueAsPlaylist(trimmed);
    setQueuePlaylistName("");
    setSavingQueue(false);
    onChangeTab("playlists");
  };

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    onCreatePlaylist(trimmed);
    setNewPlaylistName("");
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-xs transition-opacity"
      />

      {/* Slide-over panel */}
      <aside className="relative z-10 w-full max-w-md h-full bg-[#0e0e13]/90 backdrop-blur-3xl border-l border-white/15 shadow-2xl flex flex-col pt-10 pb-6 px-5">
        {/* Header & Tabs */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1 bg-white/6 border border-white/10 p-1 rounded-full">
            {(
              [
                { id: "queue", label: "Up Next" },
                { id: "liked", label: "Liked" },
                { id: "playlists", label: "Playlists" },
                { id: "local", label: "Local" },
              ] as { id: DrawerTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onChangeTab(tab.id);
                  if (tab.id !== "playlists") setSelectedPlaylistId(null);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "bg-white text-black"
                    : "text-white/65 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="Close (Esc)"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab 1: Queue */}
        {activeTab === "queue" && (
          <div className="flex-1 flex flex-col min-h-0 gap-4">
            {/* Autoplay Radio Toggle */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-white/5 border border-white/10">
              <div>
                <p className="text-xs font-semibold text-white">Autoplay Radio</p>
                <p className="text-[11px] text-white/45">Keep playing similar tracks when queue ends</p>
              </div>
              <button
                type="button"
                onClick={onToggleAutoplay}
                className={`w-10 h-6 rounded-full transition-colors p-0.5 flex items-center ${
                  autoplay ? "bg-emerald-500 justify-end" : "bg-white/20 justify-start"
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-white shadow" />
              </button>
            </div>

            {currentTrack && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/45 mb-2">
                  Now Playing
                </p>
                <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/10 border border-white/15">
                  <img
                    src={currentTrack.coverUrl}
                    alt={currentTrack.title}
                    className="w-11 h-11 rounded-xl object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p dir="auto" className="text-sm font-semibold text-white truncate">
                      {currentTrack.title}
                    </p>
                    <p dir="auto" className="text-xs text-white/60 truncate">
                      {currentTrack.artist}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                Queue ({queue.length})
              </p>
              {queue.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSavingQueue((prev) => !prev)}
                    className="text-[11px] text-white/70 hover:text-white transition-colors"
                  >
                    Save as Playlist
                  </button>
                  <span className="text-white/20">·</span>
                  <button
                    type="button"
                    onClick={onClearQueue}
                    className="text-[11px] text-rose-300/80 hover:text-rose-200 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {savingQueue && (
              <form onSubmit={handleSaveQueue} className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  dir="auto"
                  value={queuePlaylistName}
                  onChange={(e) => setQueuePlaylistName(e.target.value)}
                  placeholder="Playlist name..."
                  className="flex-1 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs text-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-bold"
                >
                  Save
                </button>
              </form>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
              {queue.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-center text-xs text-white/45">
                  <span className="material-symbols-outlined text-3xl mb-2 text-white/25">queue_music</span>
                  Your queue is empty. Search for a song to start listening.
                </div>
              ) : (
                queue.map((track, idx) => {
                  const isActive = idx === queueIndex;
                  return (
                    <div
                      key={`${track.id}-${idx}`}
                      onClick={() => onPlayFromQueue(idx)}
                      className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-colors group ${
                        isActive
                          ? "bg-white/15 border border-white/15"
                          : "hover:bg-white/8 border border-transparent"
                      }`}
                    >
                      <img
                        src={track.coverUrl}
                        alt={track.title}
                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p dir="auto" className="text-xs font-semibold text-white truncate">
                          {track.title}
                        </p>
                        <p dir="auto" className="text-[11px] text-white/55 truncate">
                          {track.artist}
                        </p>
                      </div>

                      <div
                        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onMoveQueueItem(idx, idx - 1)}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white/55 hover:text-white disabled:opacity-25"
                          title="Move Up"
                        >
                          <span className="material-symbols-outlined text-[15px]">keyboard_arrow_up</span>
                        </button>
                        <button
                          type="button"
                          disabled={idx === queue.length - 1}
                          onClick={() => onMoveQueueItem(idx, idx + 1)}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white/55 hover:text-white disabled:opacity-25"
                          title="Move Down"
                        >
                          <span className="material-symbols-outlined text-[15px]">keyboard_arrow_down</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveFromQueue(idx)}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white/55 hover:text-rose-300"
                          title="Remove"
                        >
                          <span className="material-symbols-outlined text-[15px]">close</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Liked Songs */}
        {activeTab === "liked" && (
          <div className="flex-1 flex flex-col min-h-0 gap-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-white/60">
                {likedTracks.length} {likedTracks.length === 1 ? "song" : "songs"}
              </p>
              {likedTracks.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlayTrackList(likedTracks, 0, false)}
                    className="px-3 py-1 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90"
                  >
                    Play All
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlayTrackList(likedTracks, 0, true)}
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
                  >
                    Shuffle
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
              {likedTracks.length === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-white/45">
                  <span className="material-symbols-outlined text-3xl mb-2 text-white/25">favorite</span>
                  Tap the heart icon on any song to save it here.
                </div>
              ) : (
                likedTracks.map((track, idx) => (
                  <div
                    key={track.id}
                    onClick={() => onPlayTrackList(likedTracks, idx, false)}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/8 cursor-pointer transition-colors group"
                  >
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p dir="auto" className="text-xs font-semibold text-white truncate">
                        {track.title}
                      </p>
                      <p dir="auto" className="text-[11px] text-white/55 truncate">
                        {track.artist}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLike(track);
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-rose-400 hover:bg-rose-500/15"
                      title="Remove from Liked"
                    >
                      <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        favorite
                      </span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Playlists */}
        {activeTab === "playlists" && (
          <div className="flex-1 flex flex-col min-h-0 gap-4">
            {selectedPlaylist ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPlaylistId(null)}
                    className="flex items-center gap-1 text-xs text-white/70 hover:text-white"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                    Back
                  </button>
                  <div className="flex items-center gap-2">
                    {selectedPlaylist.tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onPlayTrackList(selectedPlaylist.tracks, 0, false)}
                        className="px-3 py-1 rounded-full bg-white text-black text-xs font-bold"
                      >
                        Play All
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onDeletePlaylist(selectedPlaylist.id);
                        setSelectedPlaylistId(null);
                      }}
                      className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold hover:bg-rose-500/30"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div>
                  <h3 dir="auto" className="text-lg font-bold text-white truncate">
                    {selectedPlaylist.name}
                  </h3>
                  <p className="text-xs text-white/50">
                    {selectedPlaylist.tracks.length} {selectedPlaylist.tracks.length === 1 ? "song" : "songs"}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                  {selectedPlaylist.tracks.length === 0 ? (
                    <p className="text-xs text-white/45 py-8 text-center">
                      No tracks in this playlist yet. Add tracks from search or Now Playing.
                    </p>
                  ) : (
                    selectedPlaylist.tracks.map((track, idx) => (
                      <div
                        key={`${track.id}-${idx}`}
                        onClick={() => onPlayTrackList(selectedPlaylist.tracks, idx, false)}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/8 cursor-pointer transition-colors group"
                      >
                        <img
                          src={track.coverUrl}
                          alt={track.title}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p dir="auto" className="text-xs font-semibold text-white truncate">
                            {track.title}
                          </p>
                          <p dir="auto" className="text-[11px] text-white/55 truncate">
                            {track.artist}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFromPlaylist(selectedPlaylist.id, track.id);
                          }}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-rose-300 opacity-0 group-hover:opacity-100"
                          title="Remove from playlist"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <form onSubmit={handleCreatePlaylist} className="flex items-center gap-2">
                  <input
                    type="text"
                    dir="auto"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder="New playlist name..."
                    className="flex-1 px-3.5 py-2 rounded-full bg-white/8 border border-white/12 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="submit"
                    disabled={!newPlaylistName.trim()}
                    className="px-4 py-2 rounded-full bg-white text-black text-xs font-bold disabled:opacity-40"
                  >
                    Create
                  </button>
                </form>

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                  {playlists.length === 0 ? (
                    <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-white/45">
                      <span className="material-symbols-outlined text-3xl mb-2 text-white/25">library_music</span>
                      Create a playlist above to group your favorite songs.
                    </div>
                  ) : (
                    playlists.map((pl) => (
                      <div
                        key={pl.id}
                        onClick={() => setSelectedPlaylistId(pl.id)}
                        className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors"
                      >
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
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
                        <span className="material-symbols-outlined text-white/40 text-[18px]">chevron_right</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 4: Local Music */}
        {activeTab === "local" && (
          <div className="flex-1 flex flex-col min-h-0 gap-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-white/60">
                {localTracks.length} local {localTracks.length === 1 ? "song" : "songs"}
              </p>
              {localTracks.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlayTrackList(localTracks, 0, false)}
                    className="px-3 py-1 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90"
                  >
                    Play All
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlayTrackList(localTracks, 0, true)}
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
                  >
                    Shuffle
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
              {localTracks.length === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-white/45 px-4">
                  <span className="material-symbols-outlined text-3xl mb-2 text-white/25">folder_open</span>
                  No local tracks loaded yet. Add files or scan your Music folder from Home.
                </div>
              ) : (
                localTracks.map((track, idx) => (
                  <div
                    key={track.id}
                    onClick={() => onPlayTrackList(localTracks, idx, false)}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/8 cursor-pointer transition-colors group"
                  >
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p dir="auto" className="text-xs font-semibold text-white truncate">
                        {track.title}
                      </p>
                      <p dir="auto" className="text-[11px] text-white/55 truncate">
                        {track.artist}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveLocalTrack(track.id);
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-rose-300 opacity-0 group-hover:opacity-100"
                      title="Remove from list"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
