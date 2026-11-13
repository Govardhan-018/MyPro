import { useState, useEffect, useRef } from "react";
import {
  ExternalLink,
  Headphones,
  Maximize2,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Clock,
  Check,
  CheckCircle2,
  Pencil,
  Save,
  Info,
  AlertCircle,
  RefreshCw,
  Video,
} from "lucide-react";
import type { LibraryItem } from "../../types/library";

function YoutubeIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <polygon points="10 15 15 12 10 9 10 15" fill="currentColor" />
    </svg>
  );
}

interface MyProPodcastPlayerProps {
  podcast: LibraryItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdateProgress: (
    title: string,
    currentTimeSeconds: number,
    durationSeconds: number,
  ) => void;
  onSavePodcastDetails: (updatedPodcast: LibraryItem) => void;
  colorMode?: boolean;
}

export function MyProPodcastPlayer({
  podcast,
  isOpen,
  onClose,
  onUpdateProgress,
  onSavePodcastDetails,
  colorMode = false,
}: MyProPodcastPlayerProps) {
  // Playback state
  const totalDuration = podcast.durationSeconds || 3852; // Default 1h 04m 12s
  const [currentTime, setCurrentTime] = useState<number>(
    podcast.currentTimeSeconds || 1475, // Default 24m 35s
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(
    podcast.playbackSpeed || 1.0,
  );
  const [playMode, setPlayMode] = useState<"embedded" | "audio">("audio");
  const [volume, setVolume] = useState<number>(85);
  const [isMuted, setIsMuted] = useState(false);

  // Manual timestamp sync dialog for external YouTube listening
  const [showManualSync, setShowManualSync] = useState(false);
  const [syncMinutes, setSyncMinutes] = useState(
    Math.floor((podcast.currentTimeSeconds || 1475) / 60),
  );
  const [syncSeconds, setSyncSeconds] = useState(
    (podcast.currentTimeSeconds || 1475) % 60,
  );
  const [toastMessage, setToastMessage] = useState("");

  // Edit Metadata state
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(
    podcast.youtubeUrl || "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  const [episodeTitle, setEpisodeTitle] = useState(
    podcast.episodeTitle || podcast.title || "Designing Calm, Trustworthy Systems",
  );
  const [podcastName, setPodcastName] = useState(
    podcast.podcastName || "Design Better",
  );
  const [creator, setCreator] = useState(
    podcast.creator || "Aarron Walter & Eli Woolery",
  );
  const [artworkUrl, setArtworkUrl] = useState(podcast.image || "");
  const [description, setDescription] = useState(
    podcast.description ||
      "Exploring how calm technology principles reduce cognitive friction, prevent alarm fatigue, and build lasting user trust.",
  );

  const timerRef = useRef<number | null>(null);

  // Format seconds to HH:MM:SS or MM:SS
  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
    }
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Playback tick
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = window.setInterval(() => {
        setCurrentTime((prev) => {
          const next = prev + playbackSpeed;
          if (next >= totalDuration) {
            setIsPlaying(false);
            return totalDuration;
          }
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playbackSpeed, totalDuration]);

  // Synchronize progress to parent on time change
  useEffect(() => {
    if (isOpen) {
      onUpdateProgress(podcast.title, Math.round(currentTime), totalDuration);
    }
  }, [currentTime, totalDuration, isOpen]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 2400);
  };

  // Skip handlers
  const handleSkipBackward = () => {
    setCurrentTime((t) => Math.max(0, t - 15));
    triggerToast("Skipped back 15s");
  };

  const handleSkipForward = () => {
    setCurrentTime((t) => Math.min(totalDuration, t + 15));
    triggerToast("Skipped forward 15s");
  };

  // Speed cycle
  const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
  const cycleSpeed = () => {
    const idx = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(idx + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    triggerToast(`${nextSpeed}x playback speed`);
  };

  // Generate Timestamped YouTube Link
  const getTimestampedYoutubeUrl = () => {
    const cleanUrl = youtubeUrl.trim();
    const roundSeconds = Math.round(currentTime);
    if (!cleanUrl) return `https://www.youtube.com?t=${roundSeconds}s`;
    
    // Check if URL already has query parameters
    const separator = cleanUrl.includes("?") ? "&" : "?";
    // Strip existing &t= parameter if present
    const base = cleanUrl.replace(/[?&]t=[0-9smh]+/g, "");
    const baseSep = base.includes("?") ? "&" : "?";
    return `${base}${baseSep}t=${roundSeconds}s`;
  };

  // Open in YouTube action
  const handleOpenInYouTube = () => {
    const ytUrl = getTimestampedYoutubeUrl();
    window.open(ytUrl, "_blank", "noopener,noreferrer");
    setShowManualSync(true);
    setSyncMinutes(Math.floor(currentTime / 60));
    setSyncSeconds(Math.round(currentTime % 60));
  };

  // Manual Sync Save
  const handleApplyManualSync = () => {
    const totalSec = Math.max(0, Math.min(totalDuration, syncMinutes * 60 + syncSeconds));
    setCurrentTime(totalSec);
    setShowManualSync(false);
    triggerToast(`Progress updated to ${formatTime(totalSec)}`);
  };

  // Save Metadata Changes
  const handleSaveMetadata = () => {
    const updated: LibraryItem = {
      ...podcast,
      title: episodeTitle,
      episodeTitle,
      podcastName,
      creator,
      youtubeUrl,
      image: artworkUrl || podcast.image,
      description,
      currentTimeSeconds: Math.round(currentTime),
      durationSeconds: totalDuration,
      playbackSpeed,
      progress: Math.round((currentTime / totalDuration) * 100),
      accessed: "Just now",
    };
    onSavePodcastDetails(updated);
    setIsEditingMeta(false);
    triggerToast("Podcast details updated");
  };

  if (!isOpen) return null;

  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((currentTime / totalDuration) * 100)),
  );
  const remainingSeconds = totalDuration - currentTime;

  // Extract embed video ID from YouTube URL
  const extractVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : "dQw4w9WgXcQ";
  };
  const videoId = extractVideoId(youtubeUrl);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`mypro-podcast-modal glass-card ${colorMode ? "color-mode" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="podcast-player-title"
      >
        {/* Modal Top Header */}
        <div className="podcast-modal-header">
          <div className="header-meta">
            <span className="section-kicker">MYPRO AUDIO ENVIRONMENT</span>
            <div className="header-status-pill">
              <Headphones size={13} />
              <span>Personal Listening</span>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className={`icon-button edit-toggle ${isEditingMeta ? "active" : ""}`}
              onClick={() => setIsEditingMeta((v) => !v)}
              title="Edit Episode & YouTube details"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="icon-button close-btn"
              onClick={onClose}
              aria-label="Close Player"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ================= METADATA EDITOR VIEW ================= */}
        {isEditingMeta ? (
          <div className="podcast-editor-pane">
            <div className="editor-heading">
              <h3>Edit Episode & YouTube Link</h3>
              <p>Configure episode artwork, YouTube URL, and personal notes.</p>
            </div>

            <div className="editor-form-grid">
              <label className="editor-field">
                <span>YOUTUBE VIDEO LINK</span>
                <div className="input-with-icon">
                  <YoutubeIcon size={16} />
                  <input
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
              </label>

              <label className="editor-field">
                <span>EPISODE TITLE</span>
                <input
                  value={episodeTitle}
                  onChange={(e) => setEpisodeTitle(e.target.value)}
                  placeholder="Episode Title"
                />
              </label>

              <div className="editor-row">
                <label className="editor-field half">
                  <span>PODCAST SHOW</span>
                  <input
                    value={podcastName}
                    onChange={(e) => setPodcastName(e.target.value)}
                    placeholder="e.g. Design Better"
                  />
                </label>
                <label className="editor-field half">
                  <span>HOST / CREATOR</span>
                  <input
                    value={creator}
                    onChange={(e) => setCreator(e.target.value)}
                    placeholder="e.g. Aarron Walter & Eli Woolery"
                  />
                </label>
              </div>

              <label className="editor-field">
                <span>ARTWORK IMAGE URL</span>
                <input
                  value={artworkUrl}
                  onChange={(e) => setArtworkUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                />
              </label>

              <label className="editor-field">
                <span>PERSONAL NOTES / DESCRIPTION</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Key takeaways, references, and notes..."
                />
              </label>
            </div>

            <div className="editor-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsEditingMeta(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleSaveMetadata}
              >
                <Save size={15} /> Save Details
              </button>
            </div>
          </div>
        ) : (
          /* ================= PLAYER VIEW ================= */
          <div className="podcast-player-content">
            {/* Main Stage: Artwork / Embedded Player */}
            <div className="player-stage">
              {playMode === "embedded" ? (
                <div className="embedded-youtube-frame">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.round(
                      currentTime,
                    )}&autoplay=1&enablejsapi=1`}
                    title={episodeTitle}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="yt-iframe"
                  />
                </div>
              ) : (
                <div className="vinyl-artwork-display">
                  <div
                    className={`artwork-container ${isPlaying ? "playing" : ""}`}
                  >
                    {podcast.image ? (
                      <img
                        src={podcast.image}
                        alt={episodeTitle}
                        className="artwork-img"
                      />
                    ) : (
                      <div className="artwork-placeholder">
                        <Headphones size={48} />
                      </div>
                    )}
                    <div className="vinyl-groove-ring" />
                    <div className="vinyl-center-dot" />
                  </div>
                </div>
              )}

              {/* Title & Show Meta */}
              <div className="player-meta-info">
                <span className="podcast-show-pill">{podcastName}</span>
                <h3 id="podcast-player-title" className="podcast-episode-title">
                  {episodeTitle}
                </h3>
                <span className="podcast-creator-name">with {creator}</span>
              </div>
            </div>

            {/* ================= TIMELINE & PROGRESS ================= */}
            <div className="playback-timeline-section">
              <div className="timeline-scrubber-bar">
                <input
                  type="range"
                  min={0}
                  max={totalDuration}
                  value={Math.round(currentTime)}
                  onChange={(e) => setCurrentTime(Number(e.target.value))}
                  className="timeline-slider"
                />
                <div
                  className="timeline-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="timeline-labels">
                <span className="time-current">{formatTime(currentTime)}</span>
                <span className="time-progress-stat">
                  {progressPercent}% listened
                </span>
                <span className="time-remaining">
                  -{formatTime(remainingSeconds)}
                </span>
              </div>
            </div>

            {/* ================= PLAYBACK CONTROLS ================= */}
            <div className="player-controls-row">
              {/* Speed selector */}
              <button
                type="button"
                className="control-pill-btn speed-btn"
                onClick={cycleSpeed}
                title="Change Playback Speed"
              >
                {playbackSpeed}x
              </button>

              {/* Skip Back 15s */}
              <button
                type="button"
                className="control-icon-btn skip-btn"
                onClick={handleSkipBackward}
                title="Rewind 15 seconds"
              >
                <RotateCcw size={20} />
                <span className="skip-number">15</span>
              </button>

              {/* Master Play / Pause */}
              <button
                type="button"
                className="master-play-btn"
                onClick={() => setIsPlaying((p) => !p)}
                title={isPlaying ? "Pause" : "Play inside MyPro"}
              >
                {isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="play-triangle" />
                )}
              </button>

              {/* Skip Forward 15s */}
              <button
                type="button"
                className="control-icon-btn skip-btn"
                onClick={handleSkipForward}
                title="Fast-forward 15 seconds"
              >
                <RotateCw size={20} />
                <span className="skip-number">15</span>
              </button>

              {/* Mode Toggle: Video Embed vs Audio */}
              <button
                type="button"
                className={`control-pill-btn mode-btn ${
                  playMode === "embedded" ? "active" : ""
                }`}
                onClick={() =>
                  setPlayMode((m) => (m === "audio" ? "embedded" : "audio"))
                }
                title="Toggle Embedded Video"
              >
                {playMode === "embedded" ? "Audio Only" : "Video"}
              </button>
            </div>

            {/* ================= THE TWO ACTIONS ================= */}
            <div className="podcast-two-actions-grid">
              {/* Action 1: Play inside MyPro */}
              <div className="action-card internal-action">
                <div className="action-card-header">
                  <div className="action-icon">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <strong>Action 1: Play Inside MyPro</strong>
                    <span>Automated In-App Progress Tracking</span>
                  </div>
                </div>
                <p>
                  Listens right inside MyPro with automatic position saving.
                  When you pause or leave, your exact timestamp is remembered.
                </p>
                <button
                  type="button"
                  className={`primary-button action-btn ${
                    isPlaying ? "active-listening" : ""
                  }`}
                  onClick={() => setIsPlaying((p) => !p)}
                >
                  {isPlaying ? (
                    <>
                      <Pause size={15} /> Pause In-App Audio
                    </>
                  ) : (
                    <>
                      <Play size={15} fill="currentColor" /> Resume Inside MyPro ({formatTime(currentTime)})
                    </>
                  )}
                </button>
              </div>

              {/* Action 2: Open in YouTube */}
              <div className="action-card external-action">
                <div className="action-card-header">
                  <div className="action-icon yt-icon">
                    <YoutubeIcon size={16} />
                  </div>
                  <div>
                    <strong>Action 2: Open in YouTube</strong>
                    <span>Timestamped External Link</span>
                  </div>
                </div>
                <p>
                  Opens in your browser or YouTube app at{" "}
                  <strong>{formatTime(currentTime)}</strong>.
                </p>

                <div className="external-sync-notice">
                  <AlertCircle size={13} />
                  <span>
                    Playback outside MyPro does not provide automatic progress
                    synchronization.
                  </span>
                </div>

                <div className="external-buttons-row">
                  <button
                    type="button"
                    className="secondary-button open-yt-btn"
                    onClick={handleOpenInYouTube}
                  >
                    <ExternalLink size={14} /> Open at {formatTime(currentTime)}
                  </button>
                  <button
                    type="button"
                    className="text-button sync-trigger-btn"
                    onClick={() => setShowManualSync(true)}
                  >
                    <RefreshCw size={13} /> Update position manually
                  </button>
                </div>
              </div>
            </div>

            {/* Manual Sync Popup Modal */}
            {showManualSync && (
              <div className="manual-sync-card glass-card">
                <div className="sync-card-top">
                  <div className="sync-title">
                    <RefreshCw size={15} />
                    <strong>Record External Progress</strong>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowManualSync(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <p className="sync-desc">
                  Enter the timestamp where you paused listening on YouTube:
                </p>
                <div className="time-pickers-row">
                  <label>
                    <span>MINUTES</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.floor(totalDuration / 60)}
                      value={syncMinutes}
                      onChange={(e) =>
                        setSyncMinutes(Math.max(0, parseInt(e.target.value) || 0))
                      }
                    />
                  </label>
                  <span className="colon">:</span>
                  <label>
                    <span>SECONDS</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={syncSeconds}
                      onChange={(e) =>
                        setSyncSeconds(
                          Math.max(0, Math.min(59, parseInt(e.target.value) || 0)),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button apply-sync-btn"
                    onClick={handleApplyManualSync}
                  >
                    Save Progress
                  </button>
                </div>
              </div>
            )}

            {/* Personal Description Callout */}
            {description && (
              <div className="podcast-description-box">
                <span className="section-kicker">EPISODE TAKEAWAY</span>
                <p>{description}</p>
              </div>
            )}
          </div>
        )}

        {/* Toast */}
        {toastMessage && (
          <div className="podcast-toast" role="status">
            <CheckCircle2 size={15} />
            <span>{toastMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
