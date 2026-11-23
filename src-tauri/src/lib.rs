// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::sync::Arc;
use tokio::sync::Mutex;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/// Shared HTTP client for connection and TLS session reuse across commands.
struct HttpClient(reqwest::Client);

impl HttpClient {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(15))
            .pool_max_idle_per_host(8)
            .build()
            .expect("failed to build shared reqwest client");
        Self(client)
    }
}

/// Shared state for the audio streaming proxy.
#[derive(Default)]
struct AudioProxy {
    abort_handle: Option<tokio::task::AbortHandle>,
}

type AudioProxyState = Mutex<AudioProxy>;

/// Cached SoundCloud public client_id extracted from soundcloud.com assets.
#[derive(Default)]
struct SoundCloudClientId(Mutex<Option<String>>);

/// Persistent localhost HTTP port serving embedded/folder covers for local tracks.
#[derive(Default)]
struct LocalCoverServer(Mutex<Option<u16>>);

// ---------------------------------------------------------------------------
// OAuth helper
// ---------------------------------------------------------------------------

#[tauri::command]
async fn start_oauth_server(app: tauri::AppHandle, port: u16) -> Result<(), String> {
    use std::io::{Read, Write};
    let listener =
        std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0; 2048];
            if stream.read(&mut buffer).is_ok() {
                let request = String::from_utf8_lossy(&buffer);
                if let Some(line) = request.lines().next() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() > 1 {
                        let url = parts[1];
                        let _ = app.emit("oauth_callback", url.to_string());
                    }
                }
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                    <html><head><style>\
                    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #03000a; color: white; }\
                    h1 { color: #10b981; }\
                    </style></head><body>\
                    <h1>Authentication Successful!</h1>\
                    <p>You can securely close this tab and return to PulsePlay.</p>\
                    <script>setTimeout(() => window.close(), 1000)</script>\
                    </body></html>";
                let _ = stream.write_all(response.as_bytes());
            }
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio URL resolution (Invidious + Piped raced via Rust — no CORS)
// ---------------------------------------------------------------------------

fn score_mime_and_bitrate(mime: &str, bitrate: u64) -> (u8, u64) {
    // Prefer MP4/AAC for widest WebView2 compatibility, then WebM/Opus, then others
    let codec_tier = if mime.contains("audio/mp4") || mime.contains("mp4a") {
        2
    } else if mime.contains("audio/webm") || mime.contains("opus") {
        1
    } else {
        0
    };
    (codec_tier, bitrate)
}

const ANDROID_VR_UA: &str = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

async fn fetch_via_innertube_android_vr(
    client: &reqwest::Client,
    video_id: &str,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "ANDROID_VR",
                "clientVersion": "1.60.19",
                "deviceMake": "Oculus",
                "deviceModel": "Quest 3",
                "osName": "Android",
                "osVersion": "12L",
                "hl": "en",
                "gl": "US"
            }
        },
        "contentCheckOk": true,
        "racyCheckOk": true
    });

    let resp = client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", ANDROID_VR_UA)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("InnerTube request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("InnerTube HTTP {}", resp.status()));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("InnerTube JSON parse failed: {}", e))?;

    let status = data["playabilityStatus"]["status"].as_str().unwrap_or("");
    if status != "OK" {
        let reason = data["playabilityStatus"]["reason"]
            .as_str()
            .unwrap_or("unplayable");
        return Err(format!("InnerTube playability {}: {}", status, reason));
    }

    let formats = data["streamingData"]["adaptiveFormats"]
        .as_array()
        .ok_or_else(|| "InnerTube missing adaptiveFormats".to_string())?;

    let best = formats
        .iter()
        .filter(|f| {
            let mime = f["mimeType"].as_str().unwrap_or("");
            let url = f["url"].as_str().unwrap_or("");
            mime.contains("audio") && !url.is_empty()
        })
        .max_by_key(|f| {
            let mime = f["mimeType"].as_str().unwrap_or("");
            let br = f["bitrate"].as_u64().unwrap_or(0);
            score_mime_and_bitrate(mime, br)
        })
        .ok_or_else(|| "InnerTube returned no direct audio stream URL".to_string())?;

    best["url"]
        .as_str()
        .filter(|u| !u.is_empty())
        .map(|u| u.to_string())
        .ok_or_else(|| "InnerTube audio URL missing".to_string())
}

/// Fetch the best audio URL for a videoId.
/// Tries YouTube InnerTube ANDROID_VR first, then falls back to racing Invidious and Piped instances.
#[tauri::command]
async fn get_invidious_audio_url(
    video_id: String,
    http: tauri::State<'_, HttpClient>,
) -> Result<String, String> {
    let client = http.0.clone();

    match fetch_via_innertube_android_vr(&client, &video_id).await {
        Ok(url) => {
            println!("[Rust] Got audio URL via InnerTube ANDROID_VR");
            return Ok(url);
        }
        Err(err) => {
            println!(
                "[Rust] InnerTube ANDROID_VR failed ({}), racing Invidious/Piped...",
                err
            );
        }
    }

    let invidious_instances = [
        "https://inv.thepixora.com",
        "https://invidious.tiekoetter.com",
        "https://inv.nadeko.net",
        "https://invidious.perennialte.ch",
    ];

    let piped_instances = [
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.tokhmi.xyz",
        "https://api.piped.private.coffee",
    ];

    let mut set = tokio::task::JoinSet::new();

    for instance in invidious_instances {
        let client_clone = client.clone();
        let vid = video_id.clone();
        set.spawn(async move {
            let url = format!("{}/api/v1/videos/{}?fields=adaptiveFormats", instance, vid);
            let resp = client_clone
                .get(&url)
                .header("Accept", "application/json")
                .timeout(std::time::Duration::from_secs(3))
                .send()
                .await
                .map_err(|_| ())?;
            if !resp.status().is_success() {
                return Err(());
            }

            let data: serde_json::Value = resp.json().await.map_err(|_| ())?;
            let formats = data["adaptiveFormats"].as_array().ok_or(())?;
            if formats.is_empty() {
                return Err(());
            }

            let best = formats
                .iter()
                .filter(|f| {
                    let t = f["type"].as_str().unwrap_or("");
                    let u = f["url"].as_str().unwrap_or("");
                    t.contains("audio") && !u.is_empty()
                })
                .max_by_key(|f| {
                    let t = f["type"].as_str().unwrap_or("");
                    let br = f["bitrate"].as_u64().unwrap_or(0);
                    score_mime_and_bitrate(t, br)
                })
                .ok_or(())?;

            let audio_url = best["url"].as_str().filter(|u| !u.is_empty()).ok_or(())?;
            Ok::<(&'static str, String), ()>((instance, audio_url.to_string()))
        });
    }

    for instance in piped_instances {
        let client_clone = client.clone();
        let vid = video_id.clone();
        set.spawn(async move {
            let url = format!("{}/streams/{}", instance, vid);
            let resp = client_clone
                .get(&url)
                .header("Accept", "application/json")
                .timeout(std::time::Duration::from_secs(3))
                .send()
                .await
                .map_err(|_| ())?;
            if !resp.status().is_success() {
                return Err(());
            }

            let data: serde_json::Value = resp.json().await.map_err(|_| ())?;
            let streams = data["audioStreams"].as_array().ok_or(())?;
            if streams.is_empty() {
                return Err(());
            }

            let best = streams
                .iter()
                .filter(|s| {
                    let m = s["mimeType"].as_str().unwrap_or("");
                    let u = s["url"].as_str().unwrap_or("");
                    m.contains("audio") && !u.is_empty()
                })
                .max_by_key(|s| {
                    let m = s["mimeType"].as_str().unwrap_or("");
                    let br = s["bitrate"].as_u64().unwrap_or(0);
                    score_mime_and_bitrate(m, br)
                })
                .ok_or(())?;

            let audio_url = best["url"].as_str().filter(|u| !u.is_empty()).ok_or(())?;
            Ok::<(&'static str, String), ()>((instance, audio_url.to_string()))
        });
    }

    while let Some(res) = set.join_next().await {
        if let Ok(Ok((instance, audio_url))) = res {
            println!("[Rust] Got audio URL via {}", instance);
            set.abort_all();
            return Ok(audio_url);
        }
    }

    Err("All streaming instances failed to return an audio URL".to_string())
}

// ---------------------------------------------------------------------------
// Local streaming proxy (incremental streaming + Range/HEAD/OPTIONS support)
// ---------------------------------------------------------------------------

/// Start a local TCP streaming proxy for the given audio URL.
/// Returns the localhost port number.
#[tauri::command]
async fn start_audio_proxy(
    url: String,
    state: tauri::State<'_, AudioProxyState>,
    http: tauri::State<'_, HttpClient>,
) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Abort previous proxy if running
    {
        let mut proxy = state.lock().await;
        if let Some(handle) = proxy.abort_handle.take() {
            handle.abort();
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let url = Arc::new(url);
    let client = http.0.clone();

    let task = tokio::task::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let url = Arc::clone(&url);
            let client = client.clone();

            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let method = first_line.split_whitespace().next().unwrap_or("GET");

                // Handle CORS preflight
                if method.eq_ignore_ascii_case("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Range, Content-Type\r\n\
                        Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
                        Content-Length: 0\r\n\
                        Connection: close\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // Parse Range header for seeking support
                let range = request
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .map(|l| l[6..].trim().to_string());

                let mut req = if method.eq_ignore_ascii_case("HEAD") {
                    client.head(url.as_str())
                } else {
                    client.get(url.as_str())
                };

                req = req
                    .header("Accept", "*/*")
                    .header("Referer", "https://www.youtube.com/")
                    .header("Origin", "https://www.youtube.com")
                    .timeout(std::time::Duration::from_secs(60));

                if let Some(ref range_val) = range {
                    req = req.header("Range", range_val);
                }

                let mut resp = match req.send().await {
                    Ok(r) => r,
                    Err(e) => {
                        let body = e.to_string();
                        let msg = format!(
                            "HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = socket.write_all(msg.as_bytes()).await;
                        return;
                    }
                };

                let status = resp.status();
                let status_code = status.as_u16();
                if status_code >= 400 {
                    eprintln!(
                        "[AudioProxy] Upstream CDN returned HTTP {} for {}",
                        status_code, method
                    );
                }
                let reason = status.canonical_reason().unwrap_or("OK");
                let content_type = resp
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("audio/mp4")
                    .to_string();
                let content_length = resp
                    .headers()
                    .get("content-length")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let content_range = resp
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());

                let mut headers = format!(
                    "HTTP/1.1 {} {}\r\n\
                    Content-Type: {}\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
                    Accept-Ranges: bytes\r\n\
                    Connection: close\r\n",
                    status_code, reason, content_type
                );
                if let Some(ref cl) = content_length {
                    headers.push_str(&format!("Content-Length: {}\r\n", cl));
                }
                if let Some(ref cr) = content_range {
                    headers.push_str(&format!("Content-Range: {}\r\n", cr));
                }
                headers.push_str("\r\n");

                if socket.write_all(headers.as_bytes()).await.is_err() {
                    return;
                }

                if method.eq_ignore_ascii_case("HEAD") {
                    return;
                }

                // Stream chunks incrementally so playback starts immediately without full buffering
                while let Ok(Some(chunk)) = resp.chunk().await {
                    if socket.write_all(&chunk).await.is_err() {
                        break;
                    }
                }
                let _ = socket.flush().await;
            });
        }
    });

    {
        let mut proxy = state.lock().await;
        proxy.abort_handle = Some(task.abort_handle());
    }

    Ok(port)
}

// ---------------------------------------------------------------------------
// SoundCloud search, stream resolution, and local HLS proxy
// ---------------------------------------------------------------------------

async fn fetch_soundcloud_client_id(client: &reqwest::Client) -> Result<String, String> {
    let html = client
        .get("https://soundcloud.com")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to reach soundcloud.com: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read soundcloud.com HTML: {}", e))?;

    let mut script_urls: Vec<String> = Vec::new();
    let prefix = "https://a-v2.sndcdn.com/assets/";
    let mut search_from = 0;
    while let Some(pos) = html[search_from..].find(prefix) {
        let start = search_from + pos;
        if let Some(end_rel) = html[start..].find('"') {
            let candidate = &html[start..start + end_rel];
            if candidate.ends_with(".js") {
                script_urls.push(candidate.to_string());
            }
            search_from = start + end_rel;
        } else {
            break;
        }
    }

    for script_url in script_urls.into_iter().rev().take(6) {
        let Ok(resp) = client
            .get(&script_url)
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await
        else {
            continue;
        };
        let Ok(js) = resp.text().await else {
            continue;
        };
        if let Some(idx) = js.find("client_id:\"") {
            let rest = &js[idx + "client_id:\"".len()..];
            if let Some(end) = rest.find('"') {
                let cid = &rest[..end];
                if !cid.is_empty() && cid.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return Ok(cid.to_string());
                }
            }
        }
    }

    Err("Could not extract SoundCloud client_id".to_string())
}

async fn get_sc_client_id(
    client: &reqwest::Client,
    sc_state: &SoundCloudClientId,
    force_refresh: bool,
) -> Result<String, String> {
    if !force_refresh {
        let guard = sc_state.0.lock().await;
        if let Some(ref cid) = *guard {
            return Ok(cid.clone());
        }
    }
    let cid = fetch_soundcloud_client_id(client).await?;
    let mut guard = sc_state.0.lock().await;
    *guard = Some(cid.clone());
    Ok(cid)
}

#[derive(serde::Serialize)]
struct SCTrackResult {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u64,
    #[serde(rename = "coverUrl")]
    cover_url: String,
    #[serde(rename = "previewUrl")]
    preview_url: Option<String>,
    source: String,
    #[serde(rename = "streamEndpoint")]
    stream_endpoint: String,
    #[serde(rename = "streamProtocol")]
    stream_protocol: String,
    #[serde(rename = "trackAuthorization")]
    track_authorization: Option<String>,
}

fn score_sc_transcoding(t: &serde_json::Value) -> Option<(u8, String, String, bool)> {
    let url = t["url"].as_str()?.trim();
    if url.is_empty() {
        return None;
    }
    let protocol = t["format"]["protocol"].as_str().unwrap_or("");
    let mime = t["format"]["mime_type"].as_str().unwrap_or("");
    let preset = t["preset"].as_str().unwrap_or("");
    let snipped = t["snipped"].as_bool().unwrap_or(false);

    let tier = if protocol == "progressive" && !snipped {
        6
    } else if protocol == "hls" && mime.contains("audio/mp4") && !snipped {
        if preset.contains("160") { 5 } else { 4 }
    } else if protocol == "hls" && mime.contains("audio/mpeg") && !snipped {
        3
    } else if protocol == "progressive" {
        2
    } else if protocol == "hls" && (mime.contains("audio/mp4") || mime.contains("audio/mpeg")) {
        1
    } else {
        return None;
    };

    Some((tier, url.to_string(), protocol.to_string(), snipped))
}

#[tauri::command]
async fn search_soundcloud_music(
    query: String,
    http: tauri::State<'_, HttpClient>,
    sc_state: tauri::State<'_, SoundCloudClientId>,
) -> Result<Vec<SCTrackResult>, String> {
    search_soundcloud_music_inner(&http.0, &sc_state, &query).await
}

async fn search_soundcloud_music_inner(
    client: &reqwest::Client,
    sc_state: &SoundCloudClientId,
    query: &str,
) -> Result<Vec<SCTrackResult>, String> {
    let mut force_refresh = false;
    let mut data: Option<serde_json::Value> = None;

    for attempt in 0..2 {
        let cid = get_sc_client_id(client, sc_state, force_refresh).await?;
        let resp = client
            .get("https://api-v2.soundcloud.com/search/tracks")
            .query(&[("q", query), ("client_id", cid.as_str()), ("limit", "30")])
            .header("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("SoundCloud search failed: {}", e))?;

        if (resp.status().as_u16() == 401 || resp.status().as_u16() == 403) && attempt == 0 {
            force_refresh = true;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("SoundCloud search HTTP {}", resp.status()));
        }
        data = Some(resp.json().await.map_err(|e| e.to_string())?);
        break;
    }

    let data = data.ok_or_else(|| "SoundCloud search failed".to_string())?;
    let collection = data["collection"]
        .as_array()
        .ok_or("Empty SoundCloud response")?;

    let mut full_tracks = Vec::new();
    let mut short_tracks = Vec::new();
    let mut preview_tracks = Vec::new();

    for item in collection {
        let Some(transcodings) = item["media"]["transcodings"].as_array() else {
            continue;
        };
        let Some((_, stream_endpoint, stream_protocol, transcoding_snipped)) = transcodings
            .iter()
            .filter_map(score_sc_transcoding)
            .max_by_key(|(tier, _, _, _)| *tier)
        else {
            continue;
        };

        let duration_ms = item["duration"].as_u64().unwrap_or(0);
        let full_duration_ms = item["full_duration"].as_u64().unwrap_or(duration_ms);
        let policy = item["policy"].as_str().unwrap_or("");
        let is_snippet = transcoding_snipped
            || policy.eq_ignore_ascii_case("SNIP")
            || (full_duration_ms > 0 && duration_ms > 0 && duration_ms + 5000 < full_duration_ms);

        let id = item["id"]
            .as_u64()
            .map(|n| n.to_string())
            .unwrap_or_else(|| stream_endpoint.clone());
        let title = item["title"]
            .as_str()
            .unwrap_or("Unknown Track")
            .to_string();
        let artist = item["user"]["username"]
            .as_str()
            .unwrap_or("Unknown Artist")
            .to_string();
        let duration = duration_ms / 1000;
        let artwork = item["artwork_url"]
            .as_str()
            .or_else(|| item["user"]["avatar_url"].as_str())
            .unwrap_or("")
            .replace("-large", "-t500x500");
        let track_authorization = item["track_authorization"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let track = SCTrackResult {
            id,
            title,
            artist,
            album: "SoundCloud".to_string(),
            duration,
            cover_url: artwork,
            preview_url: None,
            source: "soundcloud".to_string(),
            stream_endpoint,
            stream_protocol,
            track_authorization,
        };

        if is_snippet {
            preview_tracks.push(track);
        } else if duration >= 45 {
            full_tracks.push(track);
        } else {
            short_tracks.push(track);
        }
    }

    if !full_tracks.is_empty() {
        full_tracks.truncate(20);
        Ok(full_tracks)
    } else if !short_tracks.is_empty() {
        short_tracks.truncate(20);
        Ok(short_tracks)
    } else {
        preview_tracks.truncate(20);
        Ok(preview_tracks)
    }
}

#[tauri::command]
async fn resolve_soundcloud_stream(
    stream_endpoint: String,
    track_authorization: Option<String>,
    http: tauri::State<'_, HttpClient>,
    sc_state: tauri::State<'_, SoundCloudClientId>,
) -> Result<String, String> {
    resolve_soundcloud_stream_inner(
        &http.0,
        &sc_state,
        &stream_endpoint,
        track_authorization.as_deref(),
    )
    .await
}

async fn resolve_soundcloud_stream_inner(
    client: &reqwest::Client,
    sc_state: &SoundCloudClientId,
    stream_endpoint: &str,
    track_authorization: Option<&str>,
) -> Result<String, String> {
    let mut force_refresh = false;

    for attempt in 0..2 {
        let cid = get_sc_client_id(client, sc_state, force_refresh).await?;
        let mut req = client
            .get(stream_endpoint)
            .query(&[("client_id", cid.as_str())])
            .header("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(10));

        if let Some(auth) = track_authorization {
            if !auth.is_empty() {
                req = req.query(&[("track_authorization", auth)]);
            }
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("Failed to resolve SoundCloud stream: {}", e))?;

        if (resp.status().as_u16() == 401 || resp.status().as_u16() == 403) && attempt == 0 {
            force_refresh = true;
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("SoundCloud stream HTTP {}", resp.status()));
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(url) = json["url"].as_str().filter(|u| !u.is_empty()) {
            return Ok(url.to_string());
        }
        return Err("SoundCloud stream JSON missing url".to_string());
    }

    Err("Failed to resolve SoundCloud stream".to_string())
}

fn rewrite_m3u8_playlist(raw_m3u8: &str, base_url: &str, port: u16) -> (String, Vec<String>) {
    let mut segment_urls: Vec<String> = Vec::new();
    let mut rewritten = String::with_capacity(raw_m3u8.len() + 512);

    let resolve_url = |raw: &str| -> String {
        if raw.starts_with("http://") || raw.starts_with("https://") {
            raw.to_string()
        } else if let Ok(base) = reqwest::Url::parse(base_url) {
            base.join(raw)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| raw.to_string())
        } else {
            raw.to_string()
        }
    };

    for line in raw_m3u8.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-MAP:") {
            if let Some(uri_start) = trimmed.find("URI=\"") {
                let after = &trimmed[uri_start + 5..];
                if let Some(uri_end) = after.find('"') {
                    let remote = resolve_url(&after[..uri_end]);
                    let idx = segment_urls.len();
                    segment_urls.push(remote);
                    let prefix = &trimmed[..uri_start + 5];
                    let suffix = &after[uri_end..];
                    rewritten.push_str(&format!(
                        "{}http://localhost:{}/seg/{}{}\n",
                        prefix, port, idx, suffix
                    ));
                    continue;
                }
            }
            rewritten.push_str(line);
            rewritten.push('\n');
        } else if !trimmed.is_empty() && !trimmed.starts_with('#') {
            let remote = resolve_url(trimmed);
            let idx = segment_urls.len();
            segment_urls.push(remote);
            rewritten.push_str(&format!("http://localhost:{}/seg/{}\n", port, idx));
        } else {
            rewritten.push_str(line);
            rewritten.push('\n');
        }
    }

    (rewritten, segment_urls)
}

#[tauri::command]
async fn start_hls_proxy(
    m3u8_url: String,
    state: tauri::State<'_, AudioProxyState>,
    http: tauri::State<'_, HttpClient>,
) -> Result<u16, String> {
    start_hls_proxy_inner(&m3u8_url, &state, &http.0).await
}

async fn start_hls_proxy_inner(
    m3u8_url: &str,
    state: &AudioProxyState,
    client: &reqwest::Client,
) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    {
        let mut proxy = state.lock().await;
        if let Some(handle) = proxy.abort_handle.take() {
            handle.abort();
        }
    }

    let raw_m3u8 = client
        .get(m3u8_url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch HLS playlist: {}", e))?
        .error_for_status()
        .map_err(|e| format!("HLS playlist HTTP error: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read HLS playlist: {}", e))?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (rewritten_m3u8, segment_urls) = rewrite_m3u8_playlist(&raw_m3u8, m3u8_url, port);
    let playlist_body = Arc::new(rewritten_m3u8);
    let segments = Arc::new(segment_urls);
    let client = client.clone();

    let task = tokio::task::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let playlist_body = Arc::clone(&playlist_body);
            let segments = Arc::clone(&segments);
            let client = client.clone();

            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let mut parts = first_line.split_whitespace();
                let method = parts.next().unwrap_or("GET");
                let path = parts.next().unwrap_or("/");

                if method.eq_ignore_ascii_case("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Range, Content-Type\r\n\
                        Content-Length: 0\r\n\
                        Connection: close\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                if path.starts_with("/playlist.m3u8") {
                    let headers = format!(
                        "HTTP/1.1 200 OK\r\n\
                        Content-Type: application/vnd.apple.mpegurl\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Content-Length: {}\r\n\
                        Connection: close\r\n\r\n",
                        playlist_body.len()
                    );
                    let _ = socket.write_all(headers.as_bytes()).await;
                    if !method.eq_ignore_ascii_case("HEAD") {
                        let _ = socket.write_all(playlist_body.as_bytes()).await;
                    }
                    let _ = socket.flush().await;
                    return;
                }

                if let Some(idx_str) = path.strip_prefix("/seg/") {
                    let idx_clean = idx_str.split('?').next().unwrap_or("");
                    if let Ok(idx) = idx_clean.parse::<usize>() {
                        if let Some(seg_url) = segments.get(idx) {
                            let mut resp = match client
                                .get(seg_url)
                                .timeout(std::time::Duration::from_secs(20))
                                .send()
                                .await
                            {
                                Ok(r) => r,
                                Err(_) => {
                                    let _ = socket
                                        .write_all(b"HTTP/1.1 502 Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                                        .await;
                                    return;
                                }
                            };

                            let status = resp.status();
                            let code = status.as_u16();
                            let reason = status.canonical_reason().unwrap_or("OK");
                            let content_type = resp
                                .headers()
                                .get("content-type")
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("audio/mp4")
                                .to_string();
                            let content_length = resp
                                .headers()
                                .get("content-length")
                                .and_then(|v| v.to_str().ok())
                                .map(|s| s.to_string());

                            let mut headers = format!(
                                "HTTP/1.1 {} {}\r\n\
                                Content-Type: {}\r\n\
                                Access-Control-Allow-Origin: *\r\n\
                                Connection: close\r\n",
                                code, reason, content_type
                            );
                            if let Some(ref cl) = content_length {
                                headers.push_str(&format!("Content-Length: {}\r\n", cl));
                            }
                            headers.push_str("\r\n");

                            if socket.write_all(headers.as_bytes()).await.is_err() {
                                return;
                            }
                            if !method.eq_ignore_ascii_case("HEAD") {
                                while let Ok(Some(chunk)) = resp.chunk().await {
                                    if socket.write_all(&chunk).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            let _ = socket.flush().await;
                            return;
                        }
                    }
                }

                let _ = socket
                    .write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await;
            });
        }
    });

    {
        let mut proxy = state.lock().await;
        proxy.abort_handle = Some(task.abort_handle());
    }

    Ok(port)
}

// ---------------------------------------------------------------------------
// YouTube search via rusty_ytdl
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct YTTrack {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u64,
    #[serde(rename = "coverUrl")]
    cover_url: String,
    #[serde(rename = "previewUrl")]
    preview_url: Option<String>,
}

#[tauri::command]
async fn search_youtube_music(query: String) -> Result<Vec<YTTrack>, String> {
    use rusty_ytdl::search::{SearchOptions, SearchType, YouTube};

    let yt = YouTube::new().map_err(|e| e.to_string())?;

    let options = SearchOptions {
        search_type: SearchType::Video,
        limit: 15,
        ..Default::default()
    };

    let results = yt
        .search(query, Some(&options))
        .await
        .map_err(|e| e.to_string())?;

    let mut tracks = Vec::new();
    for res in results {
        if let rusty_ytdl::search::SearchResult::Video(v) = res {
            tracks.push(YTTrack {
                id: v.id.clone(),
                title: v.title.clone(),
                artist: v.channel.name.clone(),
                album: "YouTube".to_string(),
                duration: v.duration / 1000,
                cover_url: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", v.id),
                preview_url: None,
            });
        }
    }

    Ok(tracks)
}

// ---------------------------------------------------------------------------
// Local music folder scanner & Range-capable local file streaming proxy
// ---------------------------------------------------------------------------

const ALLOWED_LOCAL_EXTS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "webm"];

fn local_audio_mime(ext: &str) -> &'static str {
    match ext {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}

fn parse_local_track_name(stem: &str, parent_name: Option<&str>) -> (String, String) {
    let clean = stem.replace('_', " ");
    let trimmed = clean.trim();
    if let Some(idx) = trimmed.find(" - ") {
        let artist = trimmed[..idx].trim();
        let title = trimmed[idx + 3..].trim();
        if !artist.is_empty() && !title.is_empty() {
            return (title.to_string(), artist.to_string());
        }
    }
    let title = if trimmed.is_empty() {
        "Unknown Track".to_string()
    } else {
        trimmed.to_string()
    };
    let artist = parent_name
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("music"))
        .unwrap_or("Local Music")
        .to_string();
    (title, artist)
}

#[derive(serde::Serialize)]
struct LocalTrackResult {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u64,
    #[serde(rename = "coverUrl")]
    cover_url: String,
    #[serde(rename = "previewUrl")]
    preview_url: Option<String>,
    source: String,
    #[serde(rename = "localPath")]
    local_path: String,
}

#[derive(serde::Serialize)]
struct LocalScanResult {
    folder: String,
    tracks: Vec<LocalTrackResult>,
}

#[tauri::command]
async fn scan_local_music_folder(folder_path: Option<String>) -> Result<LocalScanResult, String> {
    scan_local_music_folder_inner(folder_path).await
}

#[tauri::command]
async fn pick_local_music_folder() -> Result<Option<LocalScanResult>, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Err(
            "Native folder picker is not available on mobile. Use file import or scan /storage/emulated/0/Music.".to_string(),
        );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let picked = tokio::task::spawn_blocking(|| {
            rfd::FileDialog::new()
                .set_title("Select Music Folder")
                .pick_folder()
        })
        .await
        .map_err(|e| format!("Folder dialog task failed: {}", e))?;

        match picked {
            Some(path) => {
                let res =
                    scan_local_music_folder_inner(Some(path.to_string_lossy().to_string())).await?;
                Ok(Some(res))
            }
            None => Ok(None),
        }
    }
}

fn open_lofty_tagged_file(path: &std::path::Path) -> Option<lofty::file::TaggedFile> {
    use lofty::probe::Probe;

    if let Ok(probe) = Probe::open(path) {
        if let Ok(guessed) = probe.guess_file_type() {
            if let Ok(tagged) = guessed.read() {
                return Some(tagged);
            }
        }
    }
    Probe::open(path).ok().and_then(|p| p.read().ok())
}

fn read_local_audio_tags(
    path: &std::path::Path,
    fallback_title: String,
    fallback_artist: String,
    fallback_album: String,
) -> (String, String, String, u64) {
    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::tag::Accessor;

    let Some(tagged) = open_lofty_tagged_file(path) else {
        return (fallback_title, fallback_artist, fallback_album, 0);
    };

    let duration = tagged.properties().duration().as_secs_f64().round() as u64;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let Some(tag) = tag else {
        return (fallback_title, fallback_artist, fallback_album, duration);
    };

    let title = tag
        .title()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_title);
    let artist = tag
        .artist()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_artist);
    let album = tag
        .album()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_album);

    (title, artist, album, duration)
}

async fn scan_local_music_folder_inner(
    folder_path: Option<String>,
) -> Result<LocalScanResult, String> {
    use std::path::PathBuf;

    let root = match folder_path
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(custom) => PathBuf::from(custom),
        None => {
            #[cfg(target_os = "android")]
            {
                PathBuf::from("/storage/emulated/0/Music")
            }
            #[cfg(not(target_os = "android"))]
            {
                std::env::var_os("USERPROFILE")
                    .or_else(|| std::env::var_os("HOME"))
                    .map(|h| PathBuf::from(h).join("Music"))
                    .ok_or_else(|| "Could not determine default Music folder".to_string())?
            }
        }
    };

    if !root.exists() || !root.is_dir() {
        return Err(format!("Folder does not exist: {}", root.display()));
    }

    tokio::task::spawn_blocking(move || {
        let root_display = root.to_string_lossy().to_string();
        let mut stack: Vec<(PathBuf, usize)> = vec![(root, 0)];
        let mut tracks: Vec<LocalTrackResult> = Vec::new();

        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if depth < 4 {
                        stack.push((path, depth + 1));
                    }
                    continue;
                }
                if !path.is_file() {
                    continue;
                }
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !ALLOWED_LOCAL_EXTS.contains(&ext.as_str()) {
                    continue;
                }

                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown Track");
                let parent_name = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str());
                let (fb_title, fb_artist) = parse_local_track_name(stem, parent_name);
                let fb_album = parent_name.unwrap_or("Local Music").to_string();
                let (title, artist, album, duration) =
                    read_local_audio_tags(&path, fb_title, fb_artist, fb_album);
                let full_path = path.to_string_lossy().to_string();

                tracks.push(LocalTrackResult {
                    id: format!("local:{}", full_path),
                    title,
                    artist,
                    album,
                    duration,
                    cover_url: String::new(),
                    preview_url: None,
                    source: "local".to_string(),
                    local_path: full_path,
                });
            }
        }

        tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(LocalScanResult {
            folder: root_display,
            tracks,
        })
    })
    .await
    .map_err(|e| format!("Local music scan task failed: {}", e))?
}

fn default_local_cover_svg(seed: &str) -> Vec<u8> {
    let mut hash: u32 = 0;
    for b in seed.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as u32);
    }
    let h1 = hash % 360;
    let h2 = (h1 + 52) % 360;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl({},65%,36%)"/>
      <stop offset="100%" stop-color="hsl({},55%,16%)"/>
    </linearGradient>
  </defs>
  <rect width="500" height="500" fill="url(#g)"/>
  <circle cx="250" cy="250" r="110" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <path d="M278 175v112.5a34 34 0 1 1-16-28.9V208l-56 15v79.5a34 34 0 1 1-16-28.9V194l88-19z" fill="rgba(255,255,255,0.88)"/>
</svg>"#,
        h1, h2
    )
    .into_bytes()
}

fn resolve_local_cover_bytes(path: &std::path::Path) -> (&'static str, Vec<u8>) {
    use lofty::file::TaggedFileExt;

    // 1. Try embedded artwork via lofty (with content-type guessing fallback)
    if let Some(tagged) = open_lofty_tagged_file(path) {
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            if let Some(pic) = tag.pictures().first() {
                let mime = match pic.mime_type() {
                    Some(lofty::picture::MimeType::Png) => "image/png",
                    Some(lofty::picture::MimeType::Jpeg) => "image/jpeg",
                    Some(lofty::picture::MimeType::Gif) => "image/gif",
                    Some(lofty::picture::MimeType::Bmp) => "image/bmp",
                    Some(lofty::picture::MimeType::Tiff) => "image/tiff",
                    _ => "image/jpeg",
                };
                if !pic.data().is_empty() {
                    return (mime, pic.data().to_vec());
                }
            }
        }
    }

    // 2. Try sibling folder artwork files
    if let Some(dir) = path.parent() {
        let candidates = [
            ("cover.jpg", "image/jpeg"),
            ("cover.jpeg", "image/jpeg"),
            ("cover.png", "image/png"),
            ("folder.jpg", "image/jpeg"),
            ("folder.jpeg", "image/jpeg"),
            ("folder.png", "image/png"),
            ("front.jpg", "image/jpeg"),
            ("front.png", "image/png"),
            ("album.jpg", "image/jpeg"),
            ("artwork.jpg", "image/jpeg"),
        ];
        for (name, mime) in candidates {
            let img_path = dir.join(name);
            if img_path.is_file() {
                if let Ok(bytes) = std::fs::read(&img_path) {
                    if !bytes.is_empty() {
                        return (mime, bytes);
                    }
                }
            }
        }
    }

    // 3. Deterministic SVG fallback
    let seed = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Local Track");
    ("image/svg+xml", default_local_cover_svg(seed))
}

#[tauri::command]
async fn get_local_cover_port(state: tauri::State<'_, LocalCoverServer>) -> Result<u16, String> {
    ensure_local_cover_server(&state).await
}

async fn ensure_local_cover_server(state: &LocalCoverServer) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let mut guard = state.0.lock().await;
    if let Some(port) = *guard {
        return Ok(port);
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *guard = Some(port);
    drop(guard);

    tokio::task::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };

            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let mut parts = first_line.split_whitespace();
                let method = parts.next().unwrap_or("GET");
                let raw_path = parts.next().unwrap_or("/");

                if method.eq_ignore_ascii_case("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                        Content-Length: 0\r\n\
                        Connection: close\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                let file_param = reqwest::Url::parse(&format!("http://localhost{}", raw_path))
                    .ok()
                    .and_then(|u| {
                        u.query_pairs()
                            .find(|(k, _)| k == "path")
                            .map(|(_, v)| v.into_owned())
                    });

                let Some(file_path_str) = file_param else {
                    let _ = socket
                        .write_all(b"HTTP/1.1 400 Bad Request\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await;
                    return;
                };

                let path = std::path::PathBuf::from(&file_path_str);
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();

                if !path.is_file() || !ALLOWED_LOCAL_EXTS.contains(&ext.as_str()) {
                    let _ = socket
                        .write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await;
                    return;
                }

                let (mime, body) =
                    tokio::task::spawn_blocking(move || resolve_local_cover_bytes(&path))
                        .await
                        .unwrap_or_else(|_| {
                            ("image/svg+xml", default_local_cover_svg(&file_path_str))
                        });

                let headers = format!(
                    "HTTP/1.1 200 OK\r\n\
                    Content-Type: {}\r\n\
                    Content-Length: {}\r\n\
                    Cache-Control: public, max-age=86400\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Connection: close\r\n\r\n",
                    mime,
                    body.len()
                );

                if socket.write_all(headers.as_bytes()).await.is_err() {
                    return;
                }
                if !method.eq_ignore_ascii_case("HEAD") {
                    let _ = socket.write_all(&body).await;
                }
                let _ = socket.flush().await;
            });
        }
    });

    Ok(port)
}

fn parse_byte_range(header: &str, total_len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if total_len == 0 {
        return None;
    }
    if start_s.is_empty() {
        let suffix: u64 = end_s.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total_len.saturating_sub(suffix);
        return Some((start, total_len - 1));
    }
    let start: u64 = start_s.trim().parse().ok()?;
    if start >= total_len {
        return None;
    }
    let end = if end_s.trim().is_empty() {
        total_len - 1
    } else {
        end_s.trim().parse::<u64>().ok()?.min(total_len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

#[tauri::command]
async fn start_local_file_proxy(
    file_path: String,
    state: tauri::State<'_, AudioProxyState>,
) -> Result<u16, String> {
    start_local_file_proxy_inner(&file_path, &state).await
}

async fn start_local_file_proxy_inner(
    file_path: &str,
    state: &AudioProxyState,
) -> Result<u16, String> {
    use std::path::PathBuf;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let path = PathBuf::from(file_path);
    if !path.exists() || !path.is_file() {
        return Err(format!("Local audio file not found: {}", file_path));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_LOCAL_EXTS.contains(&ext.as_str()) {
        return Err(format!("Unsupported audio format: .{}", ext));
    }

    let mime = local_audio_mime(&ext);
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let total_len = meta.len();

    {
        let mut proxy = state.lock().await;
        if let Some(handle) = proxy.abort_handle.take() {
            handle.abort();
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let path_arc = Arc::new(path);

    let task = tokio::task::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                continue;
            };
            let path_arc = Arc::clone(&path_arc);

            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                let method = first_line.split_whitespace().next().unwrap_or("GET");

                if method.eq_ignore_ascii_case("OPTIONS") {
                    let resp = "HTTP/1.1 204 No Content\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Range, Content-Type\r\n\
                        Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
                        Content-Length: 0\r\n\
                        Connection: close\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                let range_header = request
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .map(|l| l[6..].trim().to_string());

                let (status_line, start, length, content_range) = if let Some(ref rh) = range_header
                {
                    match parse_byte_range(rh, total_len) {
                        Some((s, e)) => (
                            "206 Partial Content",
                            s,
                            e - s + 1,
                            Some(format!("bytes {}-{}/{}", s, e, total_len)),
                        ),
                        None => {
                            let resp = format!(
                                "HTTP/1.1 416 Range Not Satisfiable\r\n\
                                Content-Range: bytes */{}\r\n\
                                Access-Control-Allow-Origin: *\r\n\
                                Content-Length: 0\r\n\
                                Connection: close\r\n\r\n",
                                total_len
                            );
                            let _ = socket.write_all(resp.as_bytes()).await;
                            return;
                        }
                    }
                } else {
                    ("200 OK", 0, total_len, None)
                };

                let mut headers = format!(
                    "HTTP/1.1 {}\r\n\
                    Content-Type: {}\r\n\
                    Content-Length: {}\r\n\
                    Accept-Ranges: bytes\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n\
                    Connection: close\r\n",
                    status_line, mime, length
                );
                if let Some(ref cr) = content_range {
                    headers.push_str(&format!("Content-Range: {}\r\n", cr));
                }
                headers.push_str("\r\n");

                if socket.write_all(headers.as_bytes()).await.is_err() {
                    return;
                }
                if method.eq_ignore_ascii_case("HEAD") || length == 0 {
                    let _ = socket.flush().await;
                    return;
                }

                let Ok(mut file) = tokio::fs::File::open(path_arc.as_ref()).await else {
                    return;
                };
                if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                    return;
                }

                let mut remaining = length;
                let mut chunk = vec![0u8; 64 * 1024];
                while remaining > 0 {
                    let to_read = (remaining as usize).min(chunk.len());
                    match file.read(&mut chunk[..to_read]).await {
                        Ok(0) => break,
                        Ok(read_n) => {
                            if socket.write_all(&chunk[..read_n]).await.is_err() {
                                break;
                            }
                            remaining -= read_n as u64;
                        }
                        Err(_) => break,
                    }
                }
                let _ = socket.flush().await;
            });
        }
    });

    {
        let mut proxy = state.lock().await;
        proxy.abort_handle = Some(task.abort_handle());
    }

    Ok(port)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HttpClient::new())
        .manage(AudioProxyState::default())
        .manage(SoundCloudClientId::default())
        .manage(LocalCoverServer::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_oauth_server,
            get_invidious_audio_url,
            start_audio_proxy,
            search_youtube_music,
            search_soundcloud_music,
            resolve_soundcloud_stream,
            start_hls_proxy,
            scan_local_music_folder,
            pick_local_music_folder,
            start_local_file_proxy,
            get_local_cover_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn soundcloud_hls_proxy_serves_segments() {
        let http = HttpClient::new();
        let sc_state = SoundCloudClientId::default();
        let proxy_state = AudioProxyState::default();

        let tracks = search_soundcloud_music_inner(&http.0, &sc_state, "the weeknd starboy")
            .await
            .expect("SoundCloud search should succeed");
        assert!(!tracks.is_empty(), "Expected SoundCloud results");
        assert!(
            tracks.iter().all(|t| t.duration >= 45),
            "Expected all returned tracks to be full-length (>=45s), got durations: {:?}",
            tracks.iter().map(|t| t.duration).collect::<Vec<_>>()
        );

        let hls_track = tracks
            .iter()
            .find(|t| t.stream_protocol == "hls")
            .unwrap_or(&tracks[0]);

        let stream_url = resolve_soundcloud_stream_inner(
            &http.0,
            &sc_state,
            &hls_track.stream_endpoint,
            hls_track.track_authorization.as_deref(),
        )
        .await
        .expect("SoundCloud stream URL should resolve");
        assert!(stream_url.starts_with("https://"));

        if hls_track.stream_protocol == "hls" {
            let port = start_hls_proxy_inner(&stream_url, &proxy_state, &http.0)
                .await
                .expect("HLS proxy should start");
            let m3u8 = http
                .0
                .get(format!("http://127.0.0.1:{}/playlist.m3u8", port))
                .send()
                .await
                .expect("playlist fetch should succeed")
                .text()
                .await
                .unwrap();
            assert!(m3u8.contains("#EXTM3U"));
            assert!(m3u8.contains(&format!("http://localhost:{}/seg/0", port)));

            let seg0 = http
                .0
                .get(format!("http://127.0.0.1:{}/seg/0", port))
                .send()
                .await
                .expect("seg/0 fetch should succeed");
            assert_eq!(seg0.status().as_u16(), 200);
            let bytes = seg0.bytes().await.unwrap();
            assert!(
                !bytes.is_empty(),
                "Expected non-empty fMP4 init/audio bytes"
            );
        }
    }

    #[tokio::test]
    async fn local_file_proxy_serves_range_bytes() {
        let http = HttpClient::new();
        let proxy_state = AudioProxyState::default();
        let temp_path = std::env::temp_dir().join("pulseplay_range_test.mp3");
        let payload = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        std::fs::write(&temp_path, payload).expect("write temp audio file");

        let port = start_local_file_proxy_inner(temp_path.to_str().unwrap(), &proxy_state)
            .await
            .expect("local file proxy should start");

        let resp = http
            .0
            .get(format!("http://127.0.0.1:{}/", port))
            .header("Range", "bytes=4-15")
            .send()
            .await
            .expect("Range GET should succeed");

        assert_eq!(resp.status().as_u16(), 206);
        assert_eq!(
            resp.headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok()),
            Some("bytes 4-15/36")
        );
        let bytes = resp.bytes().await.unwrap();
        assert_eq!(bytes.as_ref(), b"456789ABCDEF");

        let _ = std::fs::remove_file(&temp_path);
    }

    #[tokio::test]
    async fn local_cover_server_serves_embedded_or_folder_cover() {
        let http = HttpClient::new();
        let cover_state = LocalCoverServer::default();
        let temp_dir = std::env::temp_dir().join("pulseplay_cover_test_dir");
        let _ = std::fs::create_dir_all(&temp_dir);
        let audio_path = temp_dir.join("song.mp3");
        let cover_path = temp_dir.join("cover.png");

        let fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRfake";
        std::fs::write(&audio_path, b"not_real_mp3_data").expect("write temp audio");
        std::fs::write(&cover_path, fake_png).expect("write temp cover.png");

        let port = ensure_local_cover_server(&cover_state)
            .await
            .expect("cover server should start");

        let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{}/cover", port)).unwrap();
        url.query_pairs_mut()
            .append_pair("path", audio_path.to_str().unwrap());

        let resp = http
            .0
            .get(url)
            .send()
            .await
            .expect("cover GET should succeed");

        assert_eq!(resp.status().as_u16(), 200);
        assert_eq!(
            resp.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("*")
        );
        assert_eq!(
            resp.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("image/png")
        );
        let bytes = resp.bytes().await.unwrap();
        assert_eq!(bytes.as_ref(), fake_png);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
