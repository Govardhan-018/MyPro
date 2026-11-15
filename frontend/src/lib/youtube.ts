/**
 * YouTube: the one place the app talks to YouTube.
 *
 * Two jobs:
 *  - read an episode's details from a pasted link (oEmbed, no API key)
 *  - play it inside the app through the IFrame Player API
 *
 * Playback goes through YouTube's own player rather than pulling the audio
 * stream out: that is what their terms allow, it keeps creators' view counts
 * honest, and it needs no server. "Audio only" shrinks the player instead of
 * removing it.
 */

/** YouTube's public oEmbed endpoint — no key, CORS-enabled. */
const OEMBED = "https://www.youtube.com/oembed";
/** The player API, loaded on demand. */
const IFRAME_API = "https://www.youtube.com/iframe_api";

export interface YouTubeMeta {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

/** The id inside any of YouTube's URL shapes (watch, youtu.be, embed, shorts). */
export function extractVideoId(url: string): string | null {
  if (!url) return null;
  const direct = url.trim();
  if (/^[\w-]{11}$/.test(direct)) return direct;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = direct.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Title, channel and artwork for a pasted link.
 *
 * oEmbed does not report duration — that arrives from the player once it
 * loads, which is why the player writes it back on ready.
 */
export async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  const endpoint = `${OEMBED}?format=json&url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}`;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      videoId,
      title: data.title?.trim() || "",
      channel: data.author_name?.trim() || "",
      thumbnail: data.thumbnail_url || thumbnailFor(videoId),
    };
  } catch {
    // Offline, or YouTube refused: the fields stay as the user typed them.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The IFrame Player API
// ---------------------------------------------------------------------------

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YouTubePlayer }) => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

/** Inject the player API once; every caller shares the same load. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YouTubeApi>((resolve, reject) => {
    const existing = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      existing?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API did not load"));
    };
    const script = document.createElement("script");
    script.src = IFRAME_API;
    script.async = true;
    script.onerror = () => reject(new Error("Could not reach YouTube"));
    document.head.appendChild(script);
  });
  return apiPromise;
}
