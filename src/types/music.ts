export type MusicSource = "soundcloud" | "youtube";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  coverUrl: string;
  previewUrl: string | null;
  source?: MusicSource | "itunes" | "local";
  streamEndpoint?: string;
  streamProtocol?: "hls" | "progressive";
  trackAuthorization?: string;
  localPath?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  tracks: Track[];
}

export type RepeatMode = "off" | "all" | "one";

export type ThemePreset = "dynamic" | "obsidian" | "aurora" | "sunset" | "ocean" | "emerald";

export type DrawerTab = "queue" | "liked" | "playlists" | "local";

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  lines: LyricLine[];
  isSynced: boolean;
  source?: string;
}
