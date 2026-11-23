import { MusicSource, Playlist, RepeatMode, ThemePreset, Track } from "../types/music";

const KEYS = {
  liked: "pulseplay_liked_tracks",
  recent: "pulseplay_recent_tracks",
  playlists: "pulseplay_playlists",
  searches: "pulseplay_recent_searches",
  volume: "pulseplay_volume",
  muted: "pulseplay_muted",
  theme: "pulseplay_theme",
  shuffle: "pulseplay_shuffle",
  repeat: "pulseplay_repeat",
  autoplay: "pulseplay_autoplay",
  searchSource: "pulseplay_search_source",
  showDots: "pulseplay_show_dots",
  localTracks: "pulseplay_local_tracks",
  localFolder: "pulseplay_local_folder",
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or private mode storage errors
  }
}

export function loadLikedTracks(): Track[] {
  const data = readJson<Track[]>(KEYS.liked, []);
  return Array.isArray(data) ? data : [];
}

export function saveLikedTracks(tracks: Track[]): void {
  writeJson(KEYS.liked, tracks);
}

export function loadRecentTracks(): Track[] {
  const data = readJson<Track[]>(KEYS.recent, []);
  return Array.isArray(data) ? data.slice(0, 24) : [];
}

export function saveRecentTracks(tracks: Track[]): void {
  writeJson(KEYS.recent, tracks.slice(0, 24));
}

export function loadPlaylists(): Playlist[] {
  const data = readJson<Playlist[]>(KEYS.playlists, []);
  return Array.isArray(data) ? data : [];
}

export function savePlaylists(playlists: Playlist[]): void {
  writeJson(KEYS.playlists, playlists);
}

export function loadRecentSearches(): string[] {
  const data = readJson<string[]>(KEYS.searches, []);
  return Array.isArray(data) ? data.slice(0, 8) : [];
}

export function saveRecentSearches(searches: string[]): void {
  writeJson(KEYS.searches, searches.slice(0, 8));
}

export function loadVolume(): number {
  const val = readJson<number>(KEYS.volume, 0.75);
  return typeof val === "number" && Number.isFinite(val) ? Math.min(1, Math.max(0, val)) : 0.75;
}

export function saveVolume(volume: number): void {
  writeJson(KEYS.volume, Math.min(1, Math.max(0, volume)));
}

export function loadMuted(): boolean {
  return readJson<boolean>(KEYS.muted, false);
}

export function saveMuted(muted: boolean): void {
  writeJson(KEYS.muted, muted);
}

export function loadTheme(): ThemePreset {
  const val = readJson<ThemePreset>(KEYS.theme, "dynamic");
  const valid: ThemePreset[] = ["dynamic", "obsidian", "aurora", "sunset", "ocean", "emerald"];
  return valid.includes(val) ? val : "dynamic";
}

export function saveTheme(theme: ThemePreset): void {
  writeJson(KEYS.theme, theme);
}

export function loadShuffle(): boolean {
  return readJson<boolean>(KEYS.shuffle, false);
}

export function saveShuffle(shuffle: boolean): void {
  writeJson(KEYS.shuffle, shuffle);
}

export function loadRepeatMode(): RepeatMode {
  const val = readJson<RepeatMode>(KEYS.repeat, "off");
  return val === "off" || val === "all" || val === "one" ? val : "off";
}

export function saveRepeatMode(mode: RepeatMode): void {
  writeJson(KEYS.repeat, mode);
}

export function loadAutoplay(): boolean {
  return readJson<boolean>(KEYS.autoplay, true);
}

export function saveAutoplay(autoplay: boolean): void {
  writeJson(KEYS.autoplay, autoplay);
}

export function loadSearchSource(): MusicSource {
  const val = readJson<MusicSource>(KEYS.searchSource, "soundcloud");
  return val === "soundcloud" || val === "youtube" ? val : "soundcloud";
}

export function saveSearchSource(source: MusicSource): void {
  writeJson(KEYS.searchSource, source);
}

export function loadShowDots(): boolean {
  return readJson<boolean>(KEYS.showDots, true);
}

export function saveShowDots(show: boolean): void {
  writeJson(KEYS.showDots, show);
}

export function loadLocalTracks(): Track[] {
  const data = readJson<Track[]>(KEYS.localTracks, []);
  return Array.isArray(data) ? data.filter((t) => Boolean(t.localPath)) : [];
}

export function saveLocalTracks(tracks: Track[]): void {
  // Only persist disk-backed tracks; session blob URLs expire on reload
  const persistable = tracks.filter((t) => Boolean(t.localPath));
  writeJson(KEYS.localTracks, persistable);
}

export function loadLocalFolder(): string {
  return readJson<string>(KEYS.localFolder, "");
}

export function saveLocalFolder(folder: string): void {
  writeJson(KEYS.localFolder, folder);
}
