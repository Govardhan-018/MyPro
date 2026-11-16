import { useState, useEffect, useRef } from "react";
import {
  Headphones,
  Maximize2,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
  Clock,
  Check,
  CheckCircle2,
  Pencil,
  Save,
  Info,
  Video,
  ChevronDown,
} from "lucide-react";
import type { LibraryItem, NoteItem } from "../../types/library";
import { extractVideoId } from "../../lib/youtube";
import { useYouTubePlayer } from "../../lib/useYouTubePlayer";

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
  /** When false the player is minimised to the persistent mini bar. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function MyProPodcastPlayer({
  podcast,
  isOpen,
  onClose,
  onUpdateProgress,
  onSavePodcastDetails,
  colorMode = false,
  expanded = true,
  onExpandedChange,
}: MyProPodcastPlayerProps) {
  // Playback state
  const [detectedDuration, setDetectedDuration] = useState<number>(0);
  const totalDuration = detectedDuration || podcast.durationSeconds || 3852;
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

  // Episode notes (sticky-note style) — persisted to the library item and
  // surfaced in Knowledge, linked back to this episode.
  const [notes, setNotes] = useState<NoteItem[]>(podcast.notes ?? []);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteEditDraft, setNoteEditDraft] = useState("");
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

  const videoId = extractVideoId(youtubeUrl);

  // Real playback. The clock, the scrubber and the speed control all describe
  // what the YouTube player is actually doing — this used to be a setInterval
  // counting seconds while nothing played.
  const playback = useYouTubePlayer({
    videoId,
    startAt: podcast.currentTimeSeconds || 0,
    rate: playbackSpeed,
    onEnded: () => setIsPlaying(false),
  });

  // Mirror the player's state into the existing UI state.
  useEffect(() => {
    setIsPlaying(playback.playing);
  }, [playback.playing]);

  useEffect(() => {
    if (playback.ready) setCurrentTime(playback.currentTime);
  }, [playback.currentTime, playback.ready]);

  // YouTube knows the real length; the stored one is a guess until it loads.
  useEffect(() => {
    if (playback.duration > 0) setDetectedDuration(playback.duration);
  }, [playback.duration]);

  useEffect(() => {
    playback.setRate(playbackSpeed);
  }, [playbackSpeed, playback]);

  useEffect(() => {
    playback.setVolume(volume, isMuted);
  }, [volume, isMuted, playback]);

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
    playback.skip(-15);
    triggerToast("Skipped back 15s");
  };

  const handleSkipForward = () => {
    playback.skip(15);
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

  // Open the episode on YouTube at the current timestamp.
  const handleOpenInYouTube = () => {
    const ytUrl = getTimestampedYoutubeUrl();
    window.open(ytUrl, "_blank", "noopener,noreferrer");
  };

  // --- Notes: persist to the library item so Knowledge can link back here ---
  const persistNotes = (updated: NoteItem[]) => {
    setNotes(updated);
    onSavePodcastDetails({
      ...podcast,
      title: episodeTitle,
      episodeTitle,
      podcastName,
      creator,
      youtubeUrl,
      image: artworkUrl || podcast.image,
      description,
      notes: updated,
      currentTimeSeconds: Math.round(currentTime),
      durationSeconds: totalDuration,
      playbackSpeed,
    });
  };
  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    const note: NoteItem = {
      id: `pn-${Date.now()}`,
      page: Math.round(currentTime),
      text,
      createdAt: new Date().toISOString(),
    };
    persistNotes([note, ...notes]);
    setNoteDraft("");
    triggerToast("Note saved to Knowledge");
  };
  const saveNoteEdit = (id: string) => {
    const text = noteEditDraft.trim();
    setEditingNoteId(null);
    if (!text) return;
    persistNotes(notes.map((n) => (n.id === id ? { ...n, text } : n)));
  };
  const deleteNote = (id: string) => {
    persistNotes(notes.filter((n) => n.id !== id));
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

  const collapse = () => onExpandedChange?.(false);
  const expand = () => onExpandedChange?.(true);

  return (
    <>
      {expanded && (
        <div className="modal-backdrop podcast-backdrop" onMouseDown={collapse} />
      )}
      <div
        className={`mypro-podcast-modal glass-card ${colorMode ? "color-mode" : ""} ${
          expanded ? "" : "collapsed"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={expanded}
        aria-labelledby="podcast-player-title"
      >
        {/* Mini bar — the persistent player shown when minimised. */}
        <div
          className="podcast-mini-bar"
          role="button"
          tabIndex={0}
          onClick={expand}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") expand();
          }}
          aria-label="Open podcast player"
        >
          <div className="mini-thumb">
            {podcast.image ? (
              <img src={podcast.image} alt="" />
            ) : (
              <Headphones size={16} />
            )}
          </div>
          <div className="mini-meta">
            <strong>{episodeTitle}</strong>
            <span>{podcastName}</span>
          </div>
          <button
            type="button"
            className="mini-play"
            onClick={(e) => {
              e.stopPropagation();
              playback.toggle();
            }}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="mini-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close player"
          >
            <X size={16} />
          </button>
          <div className="mini-progress" style={{ width: `${progressPercent}%` }} />
        </div>

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
              className="icon-button minimize-btn"
              onClick={collapse}
              aria-label="Minimize player"
              title="Minimize"
            >
              <ChevronDown size={18} />
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
            {/* Main Stage: Artwork / Embedded Player.
                One player instance serves both modes — "Audio Only" shrinks it
                rather than unmounting it, so switching never interrupts what
                you are listening to. */}
            <div className="player-stage">
              <div
                className={`yt-player-mount ${playMode === "embedded" ? "visible" : "audio-only"}`}
                ref={playback.containerRef}
                aria-hidden={playMode !== "embedded"}
              />
              {playback.error && playMode !== "embedded" && (
                <p className="player-error" role="alert">
                  {playback.error}
                </p>
              )}
              {playMode === "embedded" ? null : (
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
                  onChange={(e) => playback.seekTo(Number(e.target.value))}
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
                onClick={playback.toggle}
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

            {/* Secondary option: continue on YouTube at the saved timestamp. */}
            <div className="podcast-secondary-actions">
              <button
                type="button"
                className="secondary-button go-youtube-btn"
                onClick={handleOpenInYouTube}
              >
                <YoutubeIcon size={15} /> Go to YouTube
              </button>
            </div>

            {/* ================= NOTES ================= */}
            <div className="podcast-notes-section">
              <div className="podcast-notes-head">
                <span className="section-kicker">NOTES</span>
                <span className="podcast-notes-count">
                  {notes.length} {notes.length === 1 ? "note" : "notes"} · saved to Knowledge
                </span>
              </div>

              <div className="podcast-note-composer">
                <textarea
                  rows={2}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={`Jot a note at ${formatTime(currentTime)}…`}
                />
                <button
                  type="button"
                  className="primary-button add-note-btn"
                  onClick={addNote}
                  disabled={!noteDraft.trim()}
                >
                  <Save size={14} /> Add note
                </button>
              </div>

              <div className="podcast-notes-list">
                {notes.length === 0 && (
                  <p className="podcast-notes-empty">
                    Notes you add appear here and in your Knowledge, linked to this episode.
                  </p>
                )}
                {notes.map((note) => (
                  <div className="podcast-note-card" key={note.id}>
                    {editingNoteId === note.id ? (
                      <textarea
                        className="podcast-note-edit"
                        autoFocus
                        value={noteEditDraft}
                        onChange={(e) => setNoteEditDraft(e.target.value)}
                        onBlur={() => saveNoteEdit(note.id)}
                      />
                    ) : (
                      <p className="podcast-note-text">{note.text}</p>
                    )}
                    <div className="podcast-note-foot">
                      <span className="podcast-note-stamp">
                        <Clock size={11} /> {formatTime(note.page)}
                      </span>
                      <div className="podcast-note-actions">
                        <button
                          type="button"
                          aria-label="Edit note"
                          onClick={() => {
                            setEditingNoteId(note.id);
                            setNoteEditDraft(note.text);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete note"
                          onClick={() => deleteNote(note.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
    </>
  );
}
