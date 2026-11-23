import type { Track, Playlist } from "../types/music";
export type { Track, Playlist };

/**
 * Extracts a playlist ID from a Spotify playlist URL or returns it directly if it's already an ID.
 */
export function extractPlaylistId(urlOrId: string): string | null {
  const clean = urlOrId.trim();
  if (!clean) return null;

  // Pattern for: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGo3hRjo?si=xxxx
  const match = clean.match(/spotify\.com\/playlist\/([a-zA-Z0-9]{22})/);
  if (match && match[1]) {
    return match[1];
  }

  // Fallback if it is just a 22-character alphanumeric ID
  if (/^[a-zA-Z0-9]{22}$/.test(clean)) {
    return clean;
  }

  return null;
}

/**
 * Requests an access token from Spotify using Client Credentials grant.
 */
export async function getSpotifyAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error_description || "Failed to authenticate with Spotify. Please check your credentials.");
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Fetches playlist details and tracks from Spotify.
 * Uses separate calls for metadata and items to comply with Feb 2026 API changes.
 */
export async function fetchSpotifyPlaylist(playlistId: string, accessToken: string): Promise<Playlist> {
  // Step 1: Fetch playlist metadata (name, description, images) — this rarely fails
  const metaResponse = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,description,images`,
    {
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );

  if (!metaResponse.ok) {
    const errorBody = await metaResponse.text().catch(() => "");
    console.error(`Spotify metadata error (${metaResponse.status}):`, errorBody);
    if (metaResponse.status === 401) {
      throw new Error("Spotify session expired. Please log in again from Settings.");
    }
    throw new Error(`Failed to fetch Spotify playlist. Code: ${metaResponse.status}. ${errorBody}`);
  }

  const meta = await metaResponse.json();
  const coverUrl = meta.images && meta.images[0] ? meta.images[0].url : "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&auto=format&fit=crop";

  // Step 2: Fetch tracks via the /items endpoint (replaces deprecated /tracks)
  // Adding market=US and additional_types=track avoids 403 from region/episode issues
  const itemsResponse = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}/items?market=US&additional_types=track&limit=50&fields=items(track(id,name,duration_ms,preview_url,artists(name),album(name,images)))`,
    {
      headers: { "Authorization": `Bearer ${accessToken}` },
    }
  );

  if (!itemsResponse.ok) {
    const errorBody = await itemsResponse.text().catch(() => "");
    console.error(`Spotify items error (${itemsResponse.status}):`, errorBody);
    if (itemsResponse.status === 401) {
      throw new Error("Spotify session expired. Please log in again from Settings.");
    }
    throw new Error(`Failed to fetch playlist tracks. Code: ${itemsResponse.status}. ${errorBody}`);
  }

  const itemsData = await itemsResponse.json();
  const tracks: Track[] = [];
  
  if (itemsData.items) {
    for (const item of itemsData.items) {
      if (!item || !item.track) continue;
      const t = item.track;
      
      const artistsName = t.artists ? t.artists.map((a: any) => a.name).join(", ") : "Unknown Artist";
      const trackCoverUrl = t.album && t.album.images && t.album.images[0]
        ? t.album.images[0].url
        : "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&auto=format&fit=crop";

      tracks.push({
        id: t.id || Math.random().toString(36).substring(2, 9),
        title: t.name || "Unknown Track",
        artist: artistsName,
        album: t.album ? t.album.name : "Unknown Album",
        duration: Math.round((t.duration_ms || 0) / 1000),
        coverUrl: trackCoverUrl,
        previewUrl: t.preview_url || null,
      });
    }
  }

  return {
    id: meta.id,
    name: meta.name || "Untitled Playlist",
    description: meta.description || "No description available.",
    coverUrl,
    tracks,
  };
}

// --- OAUTH PKCE FLOW ---

function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return hash;
}

function base64encode(input: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function createPkceChallenge(): Promise<{ verifier: string, challenge: string }> {
  const verifier = generateRandomString(64);
  const hashed = await sha256(verifier);
  const challenge = base64encode(hashed);
  return { verifier, challenge };
}

export async function exchangeSpotifyCodeForToken(clientId: string, code: string, verifier: string, redirectUri: string): Promise<string> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error_description || "Failed to exchange authorization code for token.");
  }

  const data = await response.json();
  return data.access_token;
}

export async function fetchUserPlaylists(accessToken: string): Promise<Playlist[]> {
  const response = await fetch("https://api.spotify.com/v1/me/playlists?limit=20", {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(`Spotify user playlists error (${response.status}):`, errorBody);
    throw new Error(`Failed to fetch user playlists. Code: ${response.status}`);
  }

  const data = await response.json();
  const playlists: Playlist[] = [];

  if (data.items) {
    for (const item of data.items) {
      if (!item) continue;
      const coverUrl = item.images && item.images[0] ? item.images[0].url : "https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=300&auto=format&fit=crop";
      playlists.push({
        id: item.id,
        name: item.name,
        description: item.description || "",
        coverUrl,
        tracks: [], // Tracks will be fetched lazily when selected
      });
    }
  }

  return playlists;
}
