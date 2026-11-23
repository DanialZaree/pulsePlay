import { Track } from "../types/music";

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "flac",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "webm",
]);

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function isAudioFile(file: File): boolean {
  if (file.type && file.type.startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.has(getExtension(file.name));
}

export function createDefaultLocalCover(title: string, artist: string): string {
  const seed = `${title}-${artist}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const h1 = hash % 360;
  const h2 = (h1 + 52) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${h1},65%,36%)"/>
        <stop offset="100%" stop-color="hsl(${h2},55%,16%)"/>
      </linearGradient>
    </defs>
    <rect width="500" height="500" fill="url(#g)"/>
    <circle cx="250" cy="250" r="110" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
    <path d="M278 175v112.5a34 34 0 1 1-16-28.9V208l-56 15v79.5a34 34 0 1 1-16-28.9V194l88-19z" fill="rgba(255,255,255,0.88)"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function parseFilenameMetadata(filename: string): { title: string; artist: string } {
  const stem = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ").trim();
  const dashIdx = stem.indexOf(" - ");
  if (dashIdx > 0) {
    const artist = stem.slice(0, dashIdx).trim();
    const title = stem.slice(dashIdx + 3).trim();
    if (artist && title) return { title, artist };
  }
  return { title: stem || "Unknown Track", artist: "Local File" };
}

function decodeId3Text(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const encoding = bytes[0];
  const payload = bytes.slice(1);
  try {
    if (encoding === 1 || encoding === 2) {
      const decoder = new TextDecoder(encoding === 2 ? "utf-16be" : "utf-16");
      return decoder.decode(payload).replace(/\0/g, "").trim();
    }
    if (encoding === 3) {
      return new TextDecoder("utf-8").decode(payload).replace(/\0/g, "").trim();
    }
    return new TextDecoder("iso-8859-1").decode(payload).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

function decodeId3Apic(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const encoding = bytes[0];
  let idx = 1;
  while (idx < bytes.length && bytes[idx] !== 0) idx++;
  if (idx >= bytes.length) return null;
  const mime = new TextDecoder("iso-8859-1").decode(bytes.slice(1, idx)) || "image/jpeg";
  idx += 2; // skip null + picture type
  if (encoding === 1 || encoding === 2) {
    while (idx + 1 < bytes.length && !(bytes[idx] === 0 && bytes[idx + 1] === 0)) idx += 2;
    idx += 2;
  } else {
    while (idx < bytes.length && bytes[idx] !== 0) idx++;
    idx += 1;
  }
  if (idx >= bytes.length) return null;
  const imgBytes = bytes.slice(idx);
  if (imgBytes.length < 16) return null;
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < imgBytes.length; i += chunk) {
    binary += String.fromCharCode(...imgBytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function readBasicId3(file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
}> {
  try {
    const headBuf = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
    if (
      headBuf.length < 10 ||
      headBuf[0] !== 0x49 ||
      headBuf[1] !== 0x44 ||
      headBuf[2] !== 0x33
    ) {
      return {};
    }
    const major = headBuf[3];
    const tagSize =
      ((headBuf[6] & 0x7f) << 21) |
      ((headBuf[7] & 0x7f) << 14) |
      ((headBuf[8] & 0x7f) << 7) |
      (headBuf[9] & 0x7f);
    const limit = Math.min(headBuf.length, 10 + tagSize);

    let offset = 10;
    const out: { title?: string; artist?: string; album?: string; coverUrl?: string } = {};

    while (offset + 10 <= limit) {
      const frameId = String.fromCharCode(
        headBuf[offset],
        headBuf[offset + 1],
        headBuf[offset + 2],
        headBuf[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      const frameSize =
        major === 4
          ? ((headBuf[offset + 4] & 0x7f) << 21) |
            ((headBuf[offset + 5] & 0x7f) << 14) |
            ((headBuf[offset + 6] & 0x7f) << 7) |
            (headBuf[offset + 7] & 0x7f)
          : (headBuf[offset + 4] << 24) |
            (headBuf[offset + 5] << 16) |
            (headBuf[offset + 6] << 8) |
            headBuf[offset + 7];

      offset += 10;
      if (frameSize <= 0 || offset + frameSize > limit) break;
      const frameData = headBuf.subarray(offset, offset + frameSize);

      if (frameId === "TIT2") out.title = decodeId3Text(frameData) || out.title;
      else if (frameId === "TPE1") out.artist = decodeId3Text(frameData) || out.artist;
      else if (frameId === "TALB") out.album = decodeId3Text(frameData) || out.album;
      else if (frameId === "APIC" && !out.coverUrl) {
        out.coverUrl = decodeId3Apic(frameData) || undefined;
      }

      offset += frameSize;
    }

    return out;
  } catch {
    return {};
  }
}

async function probeDuration(objectUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let done = false;
    const finish = (secs: number) => {
      if (done) return;
      done = true;
      audio.src = "";
      resolve(Number.isFinite(secs) && secs > 0 ? Math.round(secs) : 0);
    };
    const timer = window.setTimeout(() => finish(0), 1500);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    audio.src = objectUrl;
  });
}

export async function parseAudioFiles(files: FileList | File[]): Promise<Track[]> {
  const audioFiles = Array.from(files).filter(isAudioFile);
  const tracks: Track[] = [];

  for (const file of audioFiles) {
    const fallback = parseFilenameMetadata(file.name);
    const id3 = await readBasicId3(file);
    const title = id3.title || fallback.title;
    const artist = id3.artist || fallback.artist;
    const album = id3.album || "Local Music";
    const coverUrl = id3.coverUrl || createDefaultLocalCover(title, artist);

    const previewUrl = URL.createObjectURL(file);
    const duration = await probeDuration(previewUrl);
    const relativeOrName =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

    tracks.push({
      id: `local-file:${relativeOrName}:${file.size}:${file.lastModified}`,
      title,
      artist,
      album,
      duration,
      coverUrl,
      previewUrl,
      source: "local",
    });
  }

  return tracks;
}
