import { useEffect } from 'react';

/**
 * Wire the browser's Media Session so the OS media controls — the lock-screen
 * / notification-shade transport, the headset and car play/pause/skip keys —
 * drive the podcast player. On Android (including inside the WebView shell)
 * Chromium surfaces this as a media notification with artwork, which is the
 * "control bar like Spotify" the app wants.
 *
 * A caveat worth stating plainly: when the audio is a **cross-origin YouTube
 * iframe**, that frame publishes its own media session, and a browser may let
 * it win over the page's. Where it does, these handlers still catch hardware
 * media keys and do no harm; where the page owns the session, they give the
 * full media notification. Everything here is feature-detected and a no-op in
 * a browser without Media Session, so it can never break playback.
 */
export interface MediaSessionConfig {
  active: boolean;
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  playing: boolean;
  /** Seconds. 0/unknown is tolerated — position state is simply not set. */
  duration: number;
  position: number;
  playbackRate: number;
  onPlay: () => void;
  onPause: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  onSeekTo?: (seconds: number) => void;
}

type MediaSessionAction =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'previoustrack'
  | 'nexttrack'
  | 'seekto';

export function useMediaSession(config: MediaSessionConfig): void {
  const {
    active,
    title,
    artist,
    album,
    artwork,
    playing,
    duration,
    position,
    playbackRate,
    onPlay,
    onPause,
    onSeekBackward,
    onSeekForward,
    onPreviousTrack,
    onNextTrack,
    onSeekTo,
  } = config;

  const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  // Metadata — what the media notification shows.
  useEffect(() => {
    if (!supported || !active) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Podcast',
        artist: artist || '',
        album: album || '',
        artwork: artwork
          ? [
              { src: artwork, sizes: '96x96', type: 'image/png' },
              { src: artwork, sizes: '512x512', type: 'image/png' },
            ]
          : [],
      });
    } catch {
      /* some engines throw on exotic artwork URLs — the controls still work */
    }
  }, [supported, active, title, artist, album, artwork]);

  // Action handlers — the buttons the OS shows.
  useEffect(() => {
    if (!supported || !active) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* an unsupported action throws; skip it */
      }
    };

    set('play', onPlay);
    set('pause', onPause);
    set('seekbackward', onSeekBackward);
    set('seekforward', onSeekForward);
    set('previoustrack', onPreviousTrack ?? null);
    set('nexttrack', onNextTrack ?? null);
    set(
      'seekto',
      onSeekTo
        ? (details) => {
            if (typeof details.seekTime === 'number') onSeekTo(details.seekTime);
          }
        : null,
    );

    return () => {
      // Hand the session back cleanly so a stale podcast bar never lingers.
      for (const action of [
        'play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto',
      ] as MediaSessionAction[]) {
        set(action, null);
      }
    };
  }, [
    supported, active, onPlay, onPause, onSeekBackward, onSeekForward,
    onPreviousTrack, onNextTrack, onSeekTo,
  ]);

  // Playing/paused, so the OS shows the right button.
  useEffect(() => {
    if (!supported || !active) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      /* ignore */
    }
  }, [supported, active, playing]);

  // Scrubber position on the OS control.
  useEffect(() => {
    if (!supported || !active || !duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState?.({
        duration,
        position: Math.min(Math.max(0, position), duration),
        playbackRate: playbackRate || 1,
      });
    } catch {
      /* setPositionState is strict about its numbers; a bad tick is harmless */
    }
  }, [supported, active, duration, position, playbackRate]);

  // When the player goes away entirely, clear the session so no ghost bar is
  // left behind — the "notifications must not disturb later" rule.
  useEffect(() => {
    if (!supported) return;
    if (!active) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch {
        /* ignore */
      }
    }
  }, [supported, active]);
}
