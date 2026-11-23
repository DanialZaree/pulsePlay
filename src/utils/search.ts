import { MusicSource, Track } from "../types/music";
import { isTauri, safeInvoke } from "./tauri";
import { searchYouTubeSongs } from "./youtube";
import { searchITunesSongs } from "./itunes";
import { searchSoundCloudSongs } from "./soundcloud";

export function upgradeCoverUrl(track: Track): Track {
  if (!track.coverUrl) return track;
  return {
    ...track,
    coverUrl: track.coverUrl
      .replace("mqdefault.jpg", "hqdefault.jpg")
      .replace("/default.jpg", "/hqdefault.jpg"),
  };
}

function cleanQueryPart(value: string): string {
  return value
    .replace(/\(.*?(official|lyric|lyrics|video|audio|music video|visualizer|hd|4k|remastered|live|performance).*?\)/gi, "")
    .replace(/\[.*?(official|lyric|lyrics|video|audio|music video|visualizer|hd|4k|remastered|live|performance).*?\]/gi, "")
    .replace(/\|.*$/g, "")
    .replace(/\s*-\s*Topic$/i, "")
    .trim();
}

async function searchSoundCloudUnified(query: string): Promise<Track[]> {
  if (isTauri()) {
    const tracks = await safeInvoke<Track[]>("search_soundcloud_music", { query });
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks;
    }
  }
  const jsTracks = await searchSoundCloudSongs(query);
  return jsTracks.map((t) => ({
    ...t,
    source: "soundcloud" as const,
    streamProtocol: "progressive" as const,
  }));
}

async function searchYouTubeUnified(query: string): Promise<Track[]> {
  if (isTauri()) {
    try {
      const tracks = await safeInvoke<Track[]>("search_youtube_music", { query });
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks.map((t) => ({ ...upgradeCoverUrl(t), source: "youtube" as const }));
      }
    } catch (err) {
      console.warn("[Search] Rust YouTube search failed, falling back:", err);
    }
  }
  const ytTracks = await searchYouTubeSongs(query);
  return ytTracks.map((t) => ({ ...upgradeCoverUrl(t), source: "youtube" as const }));
}

/**
 * Unified search pipeline supporting SoundCloud (default, full-length HLS/MP3)
 * and YouTube, with automatic fallbacks to iTunes if nodes are unreachable.
 */
export async function searchMusic(
  query: string,
  source: MusicSource = "soundcloud"
): Promise<Track[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (source === "soundcloud") {
    try {
      const scTracks = await searchSoundCloudUnified(trimmed);
      if (scTracks.length > 0) return scTracks;
    } catch (scErr) {
      console.warn("[Search] SoundCloud search failed, falling back to YouTube:", scErr);
    }

    try {
      const ytTracks = await searchYouTubeUnified(trimmed);
      if (ytTracks.length > 0) return ytTracks;
    } catch (ytErr) {
      console.warn("[Search] YouTube fallback failed, falling back to iTunes:", ytErr);
    }
  } else {
    try {
      const ytTracks = await searchYouTubeUnified(trimmed);
      if (ytTracks.length > 0) return ytTracks;
    } catch (ytErr) {
      console.warn("[Search] YouTube search failed, falling back to SoundCloud:", ytErr);
    }

    try {
      const scTracks = await searchSoundCloudUnified(trimmed);
      if (scTracks.length > 0) return scTracks;
    } catch (scErr) {
      console.warn("[Search] SoundCloud fallback failed, falling back to iTunes:", scErr);
    }
  }

  try {
    const itunesTracks = await searchITunesSongs(trimmed);
    if (itunesTracks.length > 0) {
      return itunesTracks.map((t) => ({ ...t, source: "itunes" as const }));
    }
  } catch (itunesErr) {
    console.warn("[Search] iTunes fallback failed:", itunesErr);
  }

  throw new Error("Search failed. Please check your connection and try again.");
}

/**
 * Finds the best matching SoundCloud track for a restricted/blocked YouTube track
 * so playback succeeds seamlessly without user intervention.
 */
export async function findSoundCloudMatch(
  title: string,
  artist: string
): Promise<Track | null> {
  const cleanedTitle = cleanQueryPart(title);
  const cleanedArtist = cleanQueryPart(artist);
  const combined = cleanedTitle.toLowerCase().includes(cleanedArtist.toLowerCase())
    ? cleanedTitle
    : `${cleanedTitle} ${cleanedArtist}`.trim();

  if (!combined) return null;

  try {
    const results = await searchSoundCloudUnified(combined);
    if (results.length > 0) return results[0];

    if (cleanedTitle && cleanedTitle !== combined) {
      const titleOnly = await searchSoundCloudUnified(cleanedTitle);
      if (titleOnly.length > 0) return titleOnly[0];
    }
  } catch (err) {
    console.warn("[SoundCloud Rescue] Failed to locate match:", err);
  }

  return null;
}
