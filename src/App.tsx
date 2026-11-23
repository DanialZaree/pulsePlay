import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TitleBar from "./TitleBar";
import SearchBar from "./components/SearchBar";
import HomeView from "./components/HomeView";
import LyricsView from "./components/LyricsView";
import Player from "./components/Player";
import QueueDrawer from "./components/QueueDrawer";
import ShortcutsModal from "./components/ShortcutsModal";
import ColorBends from "./components/ColorBends";
import DotField from "./components/DotField";
import { DrawerTab, MusicSource, Playlist, RepeatMode, ThemePreset, Track } from "./types/music";
import { searchMusic } from "./utils/search";
import { extractColorsFromImage, THEME_PALETTES } from "./utils/colors";
import { createDefaultLocalCover, parseAudioFiles } from "./utils/localAudio";
import { isTauri, safeInvoke } from "./utils/tauri";
import {
  loadAutoplay,
  loadLikedTracks,
  loadLocalFolder,
  loadLocalTracks,
  loadMuted,
  loadPlaylists,
  loadRecentSearches,
  loadRecentTracks,
  loadRepeatMode,
  loadSearchSource,
  loadShowDots,
  loadShuffle,
  loadTheme,
  loadVolume,
  saveAutoplay,
  saveLikedTracks,
  saveLocalFolder,
  saveLocalTracks,
  saveMuted,
  savePlaylists,
  saveRecentSearches,
  saveRecentTracks,
  saveRepeatMode,
  saveSearchSource,
  saveShowDots,
  saveShuffle,
  saveTheme,
  saveVolume,
} from "./utils/storage";
import "./App.css";

const DEFAULT_COLORS = ["#262626", "#141414", "#080808"];
const DEFAULT_ACCENT = "#e5e5e5";

function App() {
  // Playback & Queue state
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState<boolean>(() => loadShuffle());
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => loadRepeatMode());
  const [autoplay, setAutoplay] = useState<boolean>(() => loadAutoplay());
  const [volume, setVolume] = useState<number>(() => loadVolume());
  const [muted, setMuted] = useState<boolean>(() => loadMuted());
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekTarget, setSeekTarget] = useState<{ time: number; seq: number } | null>(null);

  // Library & History
  const [likedTracks, setLikedTracks] = useState<Track[]>(() => loadLikedTracks());
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => loadRecentTracks());
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [localTracks, setLocalTracks] = useState<Track[]>(() => loadLocalTracks());
  const [localFolder, setLocalFolder] = useState<string>(() => loadLocalFolder());
  const [scanningLocal, setScanningLocal] = useState(false);
  const [localScanError, setLocalScanError] = useState("");
  const [localCoverPort, setLocalCoverPort] = useState<number | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // UI & Theme state
  const [activeView, setActiveView] = useState<"home" | "now-playing">("home");
  const [theme, setTheme] = useState<ThemePreset>(() => loadTheme());
  const [showDots, setShowDots] = useState<boolean>(() => loadShowDots());
  const [dynamicColors, setDynamicColors] = useState<{ colors: string[]; accent: string }>({
    colors: DEFAULT_COLORS,
    accent: DEFAULT_ACCENT,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("queue");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Search state
  const [searchSource, setSearchSource] = useState<MusicSource>(() => loadSearchSource());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showResults, setShowResults] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const seekSeqRef = useRef(0);
  const autoplayFetchingRef = useRef(false);

  const currentTrack = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
  const likedIds = useMemo(() => new Set(likedTracks.map((t) => t.id)), [likedTracks]);
  const isCurrentLiked = currentTrack ? likedIds.has(currentTrack.id) : false;

  // Persist user preferences & library
  useEffect(() => saveLikedTracks(likedTracks), [likedTracks]);
  useEffect(() => saveRecentTracks(recentTracks), [recentTracks]);
  useEffect(() => savePlaylists(playlists), [playlists]);
  useEffect(() => saveRecentSearches(recentSearches), [recentSearches]);
  useEffect(() => saveVolume(volume), [volume]);
  useEffect(() => saveMuted(muted), [muted]);
  useEffect(() => saveTheme(theme), [theme]);
  useEffect(() => saveShuffle(shuffle), [shuffle]);
  useEffect(() => saveRepeatMode(repeatMode), [repeatMode]);
  useEffect(() => saveAutoplay(autoplay), [autoplay]);
  useEffect(() => saveSearchSource(searchSource), [searchSource]);
  useEffect(() => saveShowDots(showDots), [showDots]);
  useEffect(() => saveLocalTracks(localTracks), [localTracks]);
  useEffect(() => saveLocalFolder(localFolder), [localFolder]);

  // Extract ambient colors from current album art when theme is dynamic
  useEffect(() => {
    if (theme !== "dynamic") return;
    if (!currentTrack) {
      setDynamicColors({ colors: DEFAULT_COLORS, accent: DEFAULT_ACCENT });
      return;
    }

    let cancelled = false;
    extractColorsFromImage(currentTrack.coverUrl, `${currentTrack.id}-${currentTrack.title}`).then(
      (res) => {
        if (!cancelled) setDynamicColors(res);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [theme, currentTrack]);

  const activePalette = useMemo(() => {
    if (theme === "dynamic") return dynamicColors;
    const preset = THEME_PALETTES[theme];
    return { colors: preset.colors, accent: preset.accent };
  }, [theme, dynamicColors]);

  const recordRecentTrack = useCallback((track: Track) => {
    setRecentTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 24));
  }, []);

  const triggerSeek = useCallback((time: number) => {
    seekSeqRef.current += 1;
    setSeekTarget({ time: Math.max(0, time), seq: seekSeqRef.current });
  }, []);

  const playTrack = useCallback(
    (track: Track) => {
      (window as any).__playerUnlock?.();

      const existingIdx = queue.findIndex((t) => t.id === track.id);
      if (existingIdx !== -1) {
        setQueueIndex(existingIdx);
      } else if (queue.length === 0) {
        setQueue([track]);
        setQueueIndex(0);
      } else {
        const insertAt = queueIndex + 1;
        setQueue((prev) => [...prev.slice(0, insertAt), track, ...prev.slice(insertAt)]);
        setQueueIndex(insertAt);
      }

      recordRecentTrack(track);
      setIsPlaying(true);
      setActiveView("now-playing");
      setShowResults(false);
    },
    [queue, queueIndex, recordRecentTrack]
  );

  const playTrackList = useCallback(
    (tracks: Track[], startIndex = 0, startShuffled = false) => {
      if (tracks.length === 0) return;
      (window as any).__playerUnlock?.();

      let list = [...tracks];
      let targetIdx = Math.max(0, Math.min(startIndex, list.length - 1));

      if (startShuffled) {
        setShuffle(true);
        const picked = list[targetIdx];
        const rest = list.filter((_, i) => i !== targetIdx);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        list = [picked, ...rest];
        targetIdx = 0;
      }

      setQueue(list);
      setQueueIndex(targetIdx);
      recordRecentTrack(list[targetIdx]);
      setIsPlaying(true);
      setActiveView("now-playing");
      setShowResults(false);
    },
    [recordRecentTrack]
  );

  const addToQueue = useCallback((track: Track) => {
    setQueue((prev) => {
      if (prev.length === 0) {
        setQueueIndex(0);
        setIsPlaying(true);
        return [track];
      }
      if (prev.some((t) => t.id === track.id)) return prev;
      return [...prev, track];
    });
  }, []);

  const toggleLike = useCallback((track: Track) => {
    setLikedTracks((prev) => {
      const exists = prev.some((t) => t.id === track.id);
      return exists ? prev.filter((t) => t.id !== track.id) : [track, ...prev];
    });
  }, []);

  const createPlaylist = useCallback((name: string, initialTracks: Track[] = []) => {
    const newPlaylist: Playlist = {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      description: "",
      coverUrl: initialTracks[0]?.coverUrl || "",
      tracks: initialTracks,
    };
    setPlaylists((prev) => [newPlaylist, ...prev]);
  }, []);

  const deletePlaylist = useCallback((playlistId: string) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
  }, []);

  const addToPlaylist = useCallback((playlistId: string, track: Track) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        if (pl.tracks.some((t) => t.id === track.id)) return pl;
        const tracks = [...pl.tracks, track];
        return { ...pl, tracks, coverUrl: pl.coverUrl || track.coverUrl };
      })
    );
  }, []);

  const removeFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const tracks = pl.tracks.filter((t) => t.id !== trackId);
        return { ...pl, tracks, coverUrl: tracks[0]?.coverUrl || "" };
      })
    );
  }, []);

  const handleSubmitSearch = useCallback(
    async (rawQuery: string, overrideSource?: MusicSource) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;

      const activeSource = overrideSource ?? searchSource;
      setSearchQuery(trimmed);
      setSearching(true);
      setSearchError("");
      setShowResults(true);
      setRecentSearches((prev) =>
        [trimmed, ...prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8)
      );

      try {
        const tracks = await searchMusic(trimmed, activeSource);
        setSearchResults(tracks);
      } catch (err: any) {
        setSearchResults([]);
        setSearchError(err?.message || "Search failed.");
      } finally {
        setSearching(false);
      }
    },
    [searchSource]
  );

  const handleChangeSearchSource = useCallback(
    (source: MusicSource) => {
      setSearchSource(source);
      if (searchQuery.trim()) {
        void handleSubmitSearch(searchQuery, source);
      }
    },
    [searchQuery, handleSubmitSearch]
  );

  const handlePickLocalFiles = useCallback(
    async (files: FileList | File[], autoPlayFirst = false) => {
      try {
        setLocalScanError("");
        const parsed = await parseAudioFiles(files);
        if (parsed.length === 0) {
          setLocalScanError("No supported audio files found in selection.");
          return;
        }
        setLocalTracks((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const uniqueNew = parsed.filter((t) => !existingIds.has(t.id));
          return [...uniqueNew, ...prev];
        });
        if (autoPlayFirst) {
          playTrackList(parsed, 0, false);
        }
      } catch (err: any) {
        setLocalScanError(err?.message || "Failed to load selected audio files.");
      }
    },
    [playTrackList]
  );

  const buildLocalCoverUrl = useCallback(
    (track: Track, port: number | null) => {
      if (track.source === "local" && track.localPath && port) {
        return `http://localhost:${port}/cover?path=${encodeURIComponent(track.localPath)}`;
      }
      return track.coverUrl || createDefaultLocalCover(track.title, track.artist);
    },
    []
  );

  // Initialize local cover server port in Tauri & hydrate existing local tracks
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    safeInvoke<number>("get_local_cover_port")
      .then((port) => {
        if (cancelled) return;
        setLocalCoverPort(port);
        const hydrate = (list: Track[]) =>
          list.map((t) =>
            t.source === "local" && t.localPath
              ? { ...t, coverUrl: `http://localhost:${port}/cover?path=${encodeURIComponent(t.localPath)}` }
              : t
          );
        setLocalTracks(hydrate);
        setRecentTracks(hydrate);
        setLikedTracks(hydrate);
        setPlaylists((prev) => prev.map((pl) => ({ ...pl, tracks: hydrate(pl.tracks) })));

        // Auto-refresh saved folder metadata if any local tracks are missing durations
        if (localFolder && localTracks.some((t) => t.localPath && (!t.duration || t.duration === 0))) {
          safeInvoke<{ folder: string; tracks: Track[] }>("scan_local_music_folder", {
            folderPath: localFolder,
          })
            .then((res) => {
              if (cancelled || !res.tracks) return;
              const refreshed = res.tracks.map((t) => ({
                ...t,
                coverUrl: t.localPath
                  ? `http://localhost:${port}/cover?path=${encodeURIComponent(t.localPath)}`
                  : createDefaultLocalCover(t.title, t.artist),
              }));
              setLocalTracks((prev) => {
                const pickedInSession = prev.filter((t) => !t.localPath);
                return [...pickedInSession, ...refreshed];
              });
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        console.warn("[LocalCover] Failed to start cover server:", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyLocalScanResult = useCallback(
    (res: { folder: string; tracks: Track[] }) => {
      const enriched = (res.tracks || []).map((t) => ({
        ...t,
        coverUrl: buildLocalCoverUrl(t, localCoverPort),
      }));
      setLocalFolder(res.folder);
      setLocalTracks((prev) => {
        const pickedInSession = prev.filter((t) => !t.localPath);
        const map = new Map<string, Track>();
        for (const t of [...pickedInSession, ...enriched]) {
          map.set(t.id, t);
        }
        return Array.from(map.values());
      });
      if (enriched.length === 0) {
        setLocalScanError(`No audio files found in ${res.folder}`);
      }
    },
    [buildLocalCoverUrl, localCoverPort]
  );

  const handleScanLocalFolder = useCallback(
    async (customPath?: string) => {
      setScanningLocal(true);
      setLocalScanError("");
      try {
        const res = await safeInvoke<{ folder: string; tracks: Track[] }>(
          "scan_local_music_folder",
          { folderPath: customPath ?? null }
        );
        applyLocalScanResult(res);
      } catch (err: any) {
        setLocalScanError(err?.message || "Failed to scan local folder.");
      } finally {
        setScanningLocal(false);
      }
    },
    [applyLocalScanResult]
  );

  const handlePickLocalFolder = useCallback(async () => {
    setScanningLocal(true);
    setLocalScanError("");
    try {
      const res = await safeInvoke<{ folder: string; tracks: Track[] } | null>(
        "pick_local_music_folder"
      );
      if (res) {
        applyLocalScanResult(res);
      }
    } catch (err: any) {
      setLocalScanError(err?.message || "Failed to open folder picker.");
    } finally {
      setScanningLocal(false);
    }
  }, [applyLocalScanResult]);

  const handleRemoveLocalTrack = useCallback((trackId: string) => {
    setLocalTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);

  // Window-wide Drag & Drop for local audio files
  useEffect(() => {
    let dragCounter = 0;
    const hasFiles = (e: DragEvent) =>
      Boolean(e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files"));

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter++;
      setIsDraggingFiles(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setIsDraggingFiles(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      setIsDraggingFiles(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void handlePickLocalFiles(e.dataTransfer.files, true);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handlePickLocalFiles]);

  const handleNextTrack = useCallback(async (fromAutoEnd = false) => {
    if (queue.length === 0 || !currentTrack) return;

    if (repeatMode === "one") {
      triggerSeek(0);
      setIsPlaying(true);
      return;
    }

    // If a single local track was queued alone, expand into the full localTracks playlist
    if (currentTrack.source === "local" && queue.length === 1 && localTracks.length > 1) {
      const idx = localTracks.findIndex((t) => t.id === currentTrack.id);
      const startAt = idx >= 0 ? idx : 0;
      const nextIdx = shuffle
        ? (() => {
            const candidates = localTracks.map((_, i) => i).filter((i) => i !== startAt);
            return candidates[Math.floor(Math.random() * candidates.length)];
          })()
        : (startAt + 1) % localTracks.length;
      setQueue(localTracks);
      setQueueIndex(nextIdx);
      recordRecentTrack(localTracks[nextIdx]);
      setIsPlaying(true);
      return;
    }

    if (shuffle && queue.length > 1) {
      const candidates = queue.map((_, idx) => idx).filter((idx) => idx !== queueIndex);
      const nextIdx = candidates[Math.floor(Math.random() * candidates.length)];
      setQueueIndex(nextIdx);
      recordRecentTrack(queue[nextIdx]);
      setIsPlaying(true);
      return;
    }

    if (queueIndex + 1 < queue.length) {
      const nextIdx = queueIndex + 1;
      setQueueIndex(nextIdx);
      recordRecentTrack(queue[nextIdx]);
      setIsPlaying(true);
      return;
    }

    if (repeatMode === "all" || (!fromAutoEnd && queue.length > 1)) {
      setQueueIndex(0);
      recordRecentTrack(queue[0]);
      setIsPlaying(true);
      return;
    }

    // Autoplay Radio: fetch a related track for online tracks if at end of queue
    if (currentTrack.source !== "local" && autoplay && !autoplayFetchingRef.current) {
      autoplayFetchingRef.current = true;
      try {
        const related = await searchMusic(`${currentTrack.artist} ${currentTrack.title}`, searchSource);
        const existingIds = new Set(queue.map((t) => t.id));
        const nextTrack = related.find((t) => !existingIds.has(t.id));
        if (nextTrack) {
          setQueue((prev) => {
            const nextList = [...prev, nextTrack];
            setQueueIndex(nextList.length - 1);
            return nextList;
          });
          recordRecentTrack(nextTrack);
          setIsPlaying(true);
          return;
        }
      } catch (err) {
        console.warn("[Autoplay] Failed to fetch next radio track:", err);
      } finally {
        autoplayFetchingRef.current = false;
      }
    }

    setIsPlaying(false);
  }, [queue, currentTrack, queueIndex, repeatMode, shuffle, autoplay, localTracks, searchSource, triggerSeek, recordRecentTrack]);

  const handlePrevTrack = useCallback(() => {
    if (!currentTrack) return;
    if (currentTime > 3) {
      triggerSeek(0);
      setIsPlaying(true);
      return;
    }
    if (shuffle && queue.length > 1) {
      const candidates = queue.map((_, idx) => idx).filter((idx) => idx !== queueIndex);
      const prevIdx = candidates[Math.floor(Math.random() * candidates.length)];
      setQueueIndex(prevIdx);
      recordRecentTrack(queue[prevIdx]);
      setIsPlaying(true);
      return;
    }
    if (queueIndex > 0) {
      const prevIdx = queueIndex - 1;
      setQueueIndex(prevIdx);
      recordRecentTrack(queue[prevIdx]);
      setIsPlaying(true);
    } else if (queue.length > 1) {
      const lastIdx = queue.length - 1;
      setQueueIndex(lastIdx);
      recordRecentTrack(queue[lastIdx]);
      setIsPlaying(true);
    } else {
      triggerSeek(0);
    }
  }, [currentTrack, currentTime, shuffle, queueIndex, queue, triggerSeek, recordRecentTrack]);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === "off" ? "all" : prev === "all" ? "one" : "off"));
  }, []);

  const handleMoveQueueItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      setQueue((prev) => {
        if (toIndex < 0 || toIndex >= prev.length) return prev;
        const copy = [...prev];
        const [moved] = copy.splice(fromIndex, 1);
        copy.splice(toIndex, 0, moved);

        setQueueIndex((curr) => {
          if (curr === fromIndex) return toIndex;
          if (fromIndex < curr && toIndex >= curr) return curr - 1;
          if (fromIndex > curr && toIndex <= curr) return curr + 1;
          return curr;
        });

        return copy;
      });
    },
    []
  );

  const handleRemoveFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      const copy = prev.filter((_, i) => i !== index);
      setQueueIndex((curr) => {
        if (copy.length === 0) {
          setIsPlaying(false);
          setActiveView("home");
          return -1;
        }
        if (index < curr) return curr - 1;
        if (index === curr) return Math.min(curr, copy.length - 1);
        return curr;
      });
      return copy;
    });
  }, []);

  const handleClearQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(-1);
    setIsPlaying(false);
    setActiveView("home");
  }, []);

  // Media Session metadata & action handlers
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || "PulsePlay",
        artwork: currentTrack.coverUrl
          ? [{ src: currentTrack.coverUrl, sizes: "512x512", type: "image/jpeg" }]
          : [],
      });
    } else {
      navigator.mediaSession.metadata = null;
    }

    navigator.mediaSession.setActionHandler("play", () => setIsPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", handlePrevTrack);
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void handleNextTrack();
    });
  }, [currentTrack, handleNextTrack, handlePrevTrack]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowResults(true);
        return;
      }

      if (e.key === "Escape") {
        setShowResults(false);
        setDrawerOpen(false);
        setShortcutsOpen(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      switch (e.key) {
        case " ":
          if (currentTrack) {
            e.preventDefault();
            setIsPlaying((prev) => !prev);
          }
          break;
        case "/":
          e.preventDefault();
          searchInputRef.current?.focus();
          setShowResults(true);
          break;
        case "?":
          e.preventDefault();
          setShortcutsOpen((prev) => !prev);
          break;
        case "ArrowLeft":
          if (currentTrack) {
            e.preventDefault();
            triggerSeek(Math.max(0, currentTime - 5));
          }
          break;
        case "ArrowRight":
          if (currentTrack) {
            e.preventDefault();
            triggerSeek(currentTime + 5);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          setMuted(false);
          setVolume((v) => Math.min(1, Number((v + 0.05).toFixed(2))));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => Math.max(0, Number((v - 0.05).toFixed(2))));
          break;
        case "m":
        case "M":
          setMuted((m) => !m);
          break;
        case "n":
        case "N":
          void handleNextTrack();
          break;
        case "p":
        case "P":
          handlePrevTrack();
          break;
        case "s":
        case "S":
          setShuffle((s) => !s);
          break;
        case "r":
        case "R":
          cycleRepeat();
          break;
        case "l":
        case "L":
          if (currentTrack) toggleLike(currentTrack);
          break;
        case "q":
        case "Q":
          setDrawerOpen((o) => !o);
          break;
        case "h":
        case "H":
          if (currentTrack) {
            setActiveView((v) => (v === "home" ? "now-playing" : "home"));
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentTrack,
    currentTime,
    triggerSeek,
    handleNextTrack,
    handlePrevTrack,
    cycleRepeat,
    toggleLike,
    searchSource,
  ]);

  const showHome = !currentTrack || activeView === "home";

  const handleDurationUpdate = useCallback(
    (newDur: number) => {
      setDuration(newDur);
      const rounded = Math.round(newDur);
      if (rounded > 0 && currentTrack && (!currentTrack.duration || currentTrack.duration === 0)) {
        const trackId = currentTrack.id;
        const patch = (list: Track[]) =>
          list.map((t) => (t.id === trackId && (!t.duration || t.duration === 0) ? { ...t, duration: rounded } : t));
        setLocalTracks(patch);
        setRecentTracks(patch);
      }
    },
    [currentTrack]
  );

  return (
    <div className="text-on-background select-none h-screen flex flex-col bg-background overflow-hidden">
      {/* Custom TitleBar */}
      <TitleBar
        activeView={activeView}
        onChangeView={setActiveView}
        hasTrack={Boolean(currentTrack)}
        theme={theme}
        onChangeTheme={setTheme}
        showDots={showDots}
        onToggleDots={() => setShowDots((prev) => !prev)}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((prev) => !prev)}
        queueCount={queue.length}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      {/* Main Scrollable Viewport */}
      <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden relative custom-scrollbar">
        {/* Atmospheric Liquid Background */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute inset-0">
            <ColorBends
              colors={activePalette.colors}
              resolution={0.5}
              speed={0.2}
              frequency={1.0}
              noise={0.12}
              bandWidth={6}
              rotation={90}
              iterations={1}
              intensity={0.85}
              scale={1}
              warpStrength={1}
              mouseInfluence={1}
              parallax={0.5}
              autoRotate={0}
            />
          </div>
          {showDots && (
            <div className="absolute inset-0 opacity-75">
              <DotField
                dotRadius={1.0}
                dotSpacing={11}
                cursorRadius={55}
                cursorForce={0.0}
                bulgeOnly={true}
                bulgeStrength={65}
                glowRadius={50}
                sparkle={true}
                waveAmplitude={0}
                gradientFrom="#444444"
                gradientTo="#222222"
                glowColor="#111111"
              />
            </div>
          )}
        </div>

        {/* Floating Search Bar */}
        <SearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSubmitSearch={handleSubmitSearch}
          searchSource={searchSource}
          onChangeSearchSource={handleChangeSearchSource}
          results={searchResults}
          searching={searching}
          error={searchError}
          showResults={showResults}
          onShowResultsChange={setShowResults}
          recentSearches={recentSearches}
          onClearRecentSearches={() => setRecentSearches([])}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={playTrack}
          onAddToQueue={addToQueue}
          onToggleLike={toggleLike}
          onAddToPlaylist={addToPlaylist}
        />

        {/* Main Content Canvas */}
        <main
          className={`flex-1 flex flex-col items-center ${
            showHome ? "justify-start" : "justify-center"
          } pt-28 ${currentTrack ? "pb-32" : "pb-16"} px-5 md:px-8 relative w-full max-w-6xl mx-auto z-10`}
          onClick={() => setShowResults(false)}
        >
          {showHome ? (
            <HomeView
              recentTracks={recentTracks}
              likedTracks={likedTracks}
              playlists={playlists}
              localTracks={localTracks}
              localFolder={localFolder}
              scanningLocal={scanningLocal}
              localScanError={localScanError}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              onPlayTrackList={playTrackList}
              onAddToQueue={addToQueue}
              onToggleLike={toggleLike}
              likedIds={likedIds}
              onCreatePlaylist={(name) => createPlaylist(name)}
              onOpenLibraryTab={(tab) => {
                setDrawerTab(tab);
                setDrawerOpen(true);
              }}
              onPickLocalFiles={(files) => {
                void handlePickLocalFiles(files, false);
              }}
              onPickLocalFolder={() => {
                void handlePickLocalFolder();
              }}
              onScanLocalFolder={(customPath) => {
                void handleScanLocalFolder(customPath);
              }}
              onRemoveLocalTrack={handleRemoveLocalTrack}
            />
          ) : (
            <LyricsView
              currentTrack={currentTrack}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying((prev) => !prev)}
              onSeek={triggerSeek}
              accentColor={activePalette.accent}
              isLiked={isCurrentLiked}
              onToggleLike={() => currentTrack && toggleLike(currentTrack)}
              onAddToQueue={() => currentTrack && addToQueue(currentTrack)}
              playlists={playlists}
              onAddToPlaylist={(plId) => currentTrack && addToPlaylist(plId, currentTrack)}
              onOpenQueue={() => {
                setDrawerTab("queue");
                setDrawerOpen(true);
              }}
            />
          )}
        </main>

        {/* Playback Footer */}
        <div className="z-50">
          <Player
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            onNextTrack={(fromAutoEnd) => {
              void handleNextTrack(fromAutoEnd);
            }}
            onPrevTrack={handlePrevTrack}
            repeatMode={repeatMode}
            onCycleRepeat={cycleRepeat}
            shuffle={shuffle}
            onToggleShuffle={() => setShuffle((prev) => !prev)}
            volume={volume}
            onVolumeChange={(v) => {
              setMuted(false);
              setVolume(v);
            }}
            muted={muted}
            onToggleMute={() => setMuted((prev) => !prev)}
            isLiked={isCurrentLiked}
            onToggleLike={() => currentTrack && toggleLike(currentTrack)}
            onToggleQueue={() => {
              setDrawerTab("queue");
              setDrawerOpen((prev) => !prev);
            }}
            queueCount={queue.length}
            currentTime={currentTime}
            setCurrentTime={setCurrentTime}
            duration={duration}
            setDuration={handleDurationUpdate}
            seekTarget={seekTarget}
            onOpenNowPlaying={() => setActiveView("now-playing")}
          />
        </div>
      </div>

      {/* Queue & Library Slide-over Drawer */}
      <QueueDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTab={drawerTab}
        onChangeTab={setDrawerTab}
        queue={queue}
        queueIndex={queueIndex}
        currentTrack={currentTrack}
        autoplay={autoplay}
        onToggleAutoplay={() => setAutoplay((prev) => !prev)}
        onPlayFromQueue={(idx) => {
          if (idx < 0 || idx >= queue.length) return;
          (window as any).__playerUnlock?.();
          setQueueIndex(idx);
          recordRecentTrack(queue[idx]);
          setIsPlaying(true);
          setActiveView("now-playing");
        }}
        onMoveQueueItem={handleMoveQueueItem}
        onRemoveFromQueue={handleRemoveFromQueue}
        onClearQueue={handleClearQueue}
        onSaveQueueAsPlaylist={(name) => createPlaylist(name, queue)}
        likedTracks={likedTracks}
        onPlayTrackList={playTrackList}
        onToggleLike={toggleLike}
        playlists={playlists}
        onCreatePlaylist={(name) => createPlaylist(name)}
        onDeletePlaylist={deletePlaylist}
        onRemoveFromPlaylist={removeFromPlaylist}
        localTracks={localTracks}
        onRemoveLocalTrack={handleRemoveLocalTrack}
      />

      {/* Keyboard Shortcuts Modal */}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Drag & Drop Audio Overlay */}
      {isDraggingFiles && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-6 pointer-events-none">
          <div className="px-10 py-8 rounded-[32px] border-2 border-dashed border-white/40 bg-white/10 text-center space-y-2 shadow-2xl">
            <span className="material-symbols-outlined text-5xl text-white">audio_file</span>
            <p className="text-lg font-bold text-white">Drop audio files to play locally</p>
            <p className="text-xs text-white/65">MP3, FLAC, WAV, M4A, AAC, OGG, OPUS</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
