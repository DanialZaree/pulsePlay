import { LyricLine, LyricsResult, Track } from "../types/music";

const lyricsCache = new Map<string, LyricsResult>();

/**
 * Parses LRC text into sorted LyricLine entries, supporting multi-timestamp lines
 * such as `[00:12.34][01:02.50]Chorus line`.
 */
export function parseLrc(lrcStr: string): LyricLine[] {
  const lines = lrcStr.split(/\r?\n/);
  const parsed: LyricLine[] = [];
  const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    timestampRegex.lastIndex = 0;

    while ((match = timestampRegex.exec(rawLine)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3] || "0";
      const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
      timestamps.push(min * 60 + sec + frac);
    }

    if (timestamps.length === 0) continue;

    const text = rawLine.replace(timestampRegex, "").trim();
    if (!text && parsed.length === 0) continue;

    for (const time of timestamps) {
      parsed.push({ time, text: text || "..." });
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}

function cleanTrackMetadata(track: Track): { title: string; artist: string } {
  let rawTitle = track.title
    .replace(/\(.*?(official|lyric|lyrics|video|audio|music video|visualizer|hd|4k|remastered|live|performance|feat\.?|ft\.?).*?\)/gi, "")
    .replace(/\[.*?(official|lyric|lyrics|video|audio|music video|visualizer|hd|4k|remastered|live|performance|feat\.?|ft\.?).*?\]/gi, "")
    .replace(/\|.*$/g, "")
    .trim();

  let rawArtist = track.artist
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/Official$/i, "")
    .trim();

  if (rawTitle.includes(" - ")) {
    const parts = rawTitle.split(" - ");
    if (parts.length >= 2 && parts[0].trim().length > 1) {
      rawArtist = parts[0].trim();
      rawTitle = parts.slice(1).join(" - ").trim();
    }
  }

  rawTitle = rawTitle.replace(/\b(feat\.?|ft\.?)\s+.*$/i, "").replace(/['"]/g, "").trim();
  rawArtist = rawArtist.split(/[,&]/)[0].trim();

  return {
    title: rawTitle || track.title,
    artist: rawArtist || track.artist,
  };
}

export async function fetchTrackLyrics(track: Track): Promise<LyricsResult> {
  const cached = lyricsCache.get(track.id);
  if (cached) return cached;

  const { title, artist } = cleanTrackMetadata(track);
  const query = `${title} ${artist}`.trim();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Lyrics search failed (${res.status})`);

    const results = (await res.json()) as any[];
    if (!Array.isArray(results) || results.length === 0) {
      const empty: LyricsResult = { lines: [], isSynced: false };
      lyricsCache.set(track.id, empty);
      return empty;
    }

    // Score candidates: synced lyrics strongly preferred, plus closeness to track duration
    const scored = results
      .filter((r) => r && (r.syncedLyrics || r.plainLyrics))
      .map((r) => {
        let score = r.syncedLyrics ? 100 : 10;
        if (track.duration > 0 && typeof r.duration === "number") {
          const diff = Math.abs(r.duration - track.duration);
          score -= Math.min(50, diff);
        }
        return { item: r, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.item;
    if (!best) {
      const empty: LyricsResult = { lines: [], isSynced: false };
      lyricsCache.set(track.id, empty);
      return empty;
    }

    if (best.syncedLyrics) {
      const lines = parseLrc(best.syncedLyrics);
      const result: LyricsResult = { lines, isSynced: true, source: "LRCLIB Synced" };
      lyricsCache.set(track.id, result);
      return result;
    }

    const plainLines: LyricLine[] = String(best.plainLyrics)
      .split(/\r?\n/)
      .map((text) => ({ time: 0, text: text.trim() || "..." }));
    const result: LyricsResult = { lines: plainLines, isSynced: false, source: "LRCLIB" };
    lyricsCache.set(track.id, result);
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}
