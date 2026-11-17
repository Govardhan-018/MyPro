/**
 * Real playback for the podcast player.
 *
 * The transport controls used to drive a `setInterval` that merely counted
 * seconds — the position moved, but nothing was playing. This hook puts the
 * YouTube player behind the same controls, so play, seek, speed and the clock
 * all describe actual audio.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadYouTubeApi, type YouTubePlayer } from "./youtube";

export interface YouTubePlayback {
  /** Attach to the element the player should replace. */
  containerRef: (node: HTMLDivElement | null) => void;
  ready: boolean;
  playing: boolean;
  /** Seconds, from the player while it plays. */
  currentTime: number;
  /** The real length, once YouTube reports it. */
  duration: number;
  error: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  skip: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number, muted: boolean) => void;
}

export function useYouTubePlayer({
  videoId,
  startAt = 0,
  rate = 1,
  onEnded,
}: {
  videoId: string | null;
  startAt?: number;
  rate?: number;
  onEnded?: () => void;
}): YouTubePlayback {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<number | null>(null);
  // Kept in refs so re-renders never rebuild the player.
  const startRef = useRef(startAt);
  const rateRef = useRef(rate);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  rateRef.current = rate;

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPlaying(false);
    if (!videoId || !nodeRef.current) return;

    void loadYouTubeApi()
      .then((api) => {
        if (cancelled || !nodeRef.current) return;
        // The API replaces the node, so give it one of its own to consume.
        const host = document.createElement("div");
        nodeRef.current.innerHTML = "";
        nodeRef.current.appendChild(host);

        playerRef.current = new api.Player(host, {
          videoId,
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            start: Math.floor(startRef.current),
          },
          events: {
            onReady: ({ target }) => {
              if (cancelled) return;
              playerRef.current = target;
              target.setPlaybackRate(rateRef.current);
              setDuration(Math.floor(target.getDuration()) || 0);
              setReady(true);
            },
            onStateChange: ({ data }) => {
              if (cancelled) return;
              setPlaying(data === api.PlayerState.PLAYING);
              if (data === api.PlayerState.ENDED) endedRef.current?.();
              // Duration is 0 until the media is actually loaded.
              const player = playerRef.current;
              if (player) {
                const total = Math.floor(player.getDuration()) || 0;
                if (total) setDuration(total);
              }
            },
            onError: () => {
              if (!cancelled) setError("This episode can’t be played here — the owner blocked embedding.");
            },
          },
        });
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load the player");
        }
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* the iframe may already be gone */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  // Follow the real position while it plays.
  useEffect(() => {
    if (!playing) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setCurrentTime(player.getCurrentTime());
    }, 500);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [playing]);

  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const toggle = useCallback(() => {
    if (playing) playerRef.current?.pauseVideo();
    else playerRef.current?.playVideo();
  }, [playing]);

  const seekTo = useCallback((seconds: number) => {
    const target = Math.max(0, seconds);
    playerRef.current?.seekTo(target, true);
    setCurrentTime(target);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const player = playerRef.current;
      if (!player) return;
      seekTo(player.getCurrentTime() + delta);
    },
    [seekTo],
  );

  const setRate = useCallback((next: number) => playerRef.current?.setPlaybackRate(next), []);

  const setVolume = useCallback((volume: number, muted: boolean) => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(volume);
    if (muted) player.mute();
    else player.unMute();
  }, []);

  // `currentTime` ticks while playing, so this object changes identity several
  // times a second. Callers must therefore depend on the individual callbacks
  // (which are stable) rather than on the whole object.
  return {
    containerRef,
    ready,
    playing,
    currentTime,
    duration,
    error,
    play,
    pause,
    toggle,
    seekTo,
    skip,
    setRate,
    setVolume,
  };
}
