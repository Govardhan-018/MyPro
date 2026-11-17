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
  SkipBack,
  SkipForward,
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
import { api } from "../../lib/api";
import { isApiConfigured } from "../../lib/env";

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
  /** Every podcast in the library, for the previous/next controls. */
  queue?: LibraryItem[];
  /** Open another episode in this same player. */
  onSelectEpisode?: (item: LibraryItem) => void;
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
  queue = [],
  onSelectEpisode,
}: MyProPodcastPlayerProps) {
  // No invented length or position: a placeholder here was written straight
  // back to the library, so an episode you had never played claimed to be 38%
  // through a 64-minute show. 0 means "not known yet"; YouTube fills it in.
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(
    podcast.playbackSpeed || 1.0,
  );
  const [playMode, setPlayMode] = useState<"embedded" | "audio">("audio");
  const [volume, setVolume] = useState<number>(85);
  const [isMuted, setIsMuted] = useState(false);

  // Episode notes (sticky-note style). Stored as annotations against this
  // library item — the same table the reader writes to — so they survive a
  // reload and show up in Knowledge, with `page` holding the timestamp in
  // seconds rather than a page number.
  const [notes, setNotes] = useState<NoteItem[]>(podcast.notes ?? []);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteEditDraft, setNoteEditDraft] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");

  // Edit Metadata state
  // Every field here is the episode's own. The old placeholders meant an
  // episode added without a link played an unrelated video, and saving the
  // details filed someone else's show name and host under your item.
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(podcast.youtubeUrl || "");
  const [episodeTitle, setEpisodeTitle] = useState(
    podcast.episodeTitle || podcast.title || "",
  );
  const [podcastName, setPodcastName] = useState(podcast.podcastName || "");
  const [creator, setCreator] = useState(podcast.creator || "");
  const [artworkUrl, setArtworkUrl] = useState(podcast.image || "");
  const [description, setDescription] = useState(podcast.description || "");

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

  /**
   * The one playback state.
   *
   * The clock, scrubber and speed control all describe what the YouTube
   * player is actually doing. There used to be a second copy of `playing`
   * and `currentTime` mirrored into this component's state by two effects;
   * they could — and did — drift out of step with the player, so they are
   * gone and everything below reads the hook directly.
   */
  const playback = useYouTubePlayer({
    videoId,
    startAt: podcast.currentTimeSeconds || 0,
    rate: playbackSpeed,
  });
  const isPlaying = playback.playing;

  // YouTube knows the real length; the stored one is a guess until it loads.
  const totalDuration = playback.duration || podcast.durationSeconds || 0;
  // A stored position past the real length (the link changed, or the duration
  // was only ever an estimate) would read as "100% listened" with the scrubber
  // stuck at the end, so it is clamped for display.
  const currentTime = totalDuration
    ? Math.min(playback.currentTime, totalDuration)
    : playback.currentTime;

  // Depend on the callbacks, not on `playback`: that object changes identity
  // every time the position ticks, which re-applied the rate and re-ran
  // `unMute()` twice a second for the whole episode.
  const { setRate: setPlayerRate, setVolume: setPlayerVolume, ready: playerReady } = playback;
  useEffect(() => {
    if (playerReady) setPlayerRate(playbackSpeed);
  }, [playbackSpeed, playerReady, setPlayerRate]);

  useEffect(() => {
    if (playerReady) setPlayerVolume(volume, isMuted);
  }, [volume, isMuted, playerReady, setPlayerVolume]);

  // Synchronize progress to parent on time change. The parent's write-back is
  // debounced, so this stays a cheap in-memory update.
  useEffect(() => {
    if (!isOpen || !totalDuration) return;
    onUpdateProgress(podcast.title, Math.round(currentTime), totalDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, totalDuration, isOpen]);

  const toastTimer = useRef<number | undefined>(undefined);
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(""), 2400);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

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

  /* ----- Episode queue --------------------------------------------------
   * The library's podcasts in order. Selecting one replaces this player's
   * item, which remounts it (App keys the player by item) — so the previous
   * episode's YouTube player is destroyed rather than left playing.
   * -------------------------------------------------------------------- */
  const queueIndex = queue.findIndex(
    (item) => (item.id ?? item.title) === (podcast.id ?? podcast.title),
  );
  const previousEpisode = queueIndex > 0 ? queue[queueIndex - 1] : null;
  const nextEpisode =
    queueIndex !== -1 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] : null;
  const goToEpisode = (item: LibraryItem | null) => {
    if (!item || !onSelectEpisode) return;
    onSelectEpisode(item);
  };

  /* ----- Notes ----------------------------------------------------------
   * Two places have to agree: the library item in memory (which is what
   * Knowledge derives from when there is no backend) and the annotations
   * table (which is what survives a reload). Both are written here.
   *
   * The in-memory write used to be the only one, and it was keyed by the
   * *edited* episode title — so it matched no row and the note was gone the
   * moment the component re-rendered.
   * -------------------------------------------------------------------- */
  const itemId = podcast.id;
  const canSync = isApiConfigured && !!itemId;

  /**
   * Mirror the notes onto the library item.
   *
   * Deliberately *not* the metadata: this used to send the whole edit form
   * back, so typing a note silently renamed the library row to the episode
   * title and rewrote its show, host and artwork. Renaming is what the
   * "Save Details" button is for.
   */
  const mirrorToItem = (updated: NoteItem[]) => {
    setNotes(updated);
    onSavePodcastDetails({
      ...podcast,
      notes: updated,
      currentTimeSeconds: Math.round(currentTime),
      durationSeconds: totalDuration,
      playbackSpeed,
    });
  };

  // Load the episode's saved notes when it opens.
  useEffect(() => {
    if (!canSync || !itemId) return;
    let active = true;
    api.reader
      .annotations(itemId)
      .then((rows) => {
        if (!active) return;
        setNotes(
          rows
            .filter((row) => row.kind === "note")
            .map((row) => ({
              id: row.id,
              page: row.page ?? 0,
              text: row.body ?? row.anchor_text ?? "",
              createdAt: row.created_at,
            })),
        );
      })
      .catch(() => {
        if (active) setNotesError("Saved notes could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [canSync, itemId]);

  const addNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    const at = Math.round(currentTime);
    const local: NoteItem = {
      id: `pn-${Date.now()}`,
      page: at,
      text,
      createdAt: new Date().toISOString(),
    };
    mirrorToItem([local, ...notes]);
    setNoteDraft("");
    setNotesError(null);
    triggerToast("Note saved to Knowledge");
    if (!canSync || !itemId) return;
    try {
      // `page` carries the timestamp in seconds; `paragraph` is unused here.
      const row = await api.reader.createAnnotation(itemId, {
        kind: "note",
        page: at,
        paragraph: 0,
        body: text,
      });
      // Swap the temporary id for the server's, so edit and delete can find it.
      setNotes((cur) => cur.map((n) => (n.id === local.id ? { ...n, id: row.id } : n)));
    } catch {
      setNotesError("That note is saved on this device but not synced yet.");
    }
  };

  const saveNoteEdit = async (id: string) => {
    const text = noteEditDraft.trim();
    setEditingNoteId(null);
    if (!text) return;
    mirrorToItem(notes.map((n) => (n.id === id ? { ...n, text } : n)));
    if (!canSync || id.startsWith("pn-")) return;
    try {
      await api.reader.updateAnnotation(id, { body: text });
    } catch {
      setNotesError("That edit is not synced yet.");
    }
  };

  const deleteNote = async (id: string) => {
    mirrorToItem(notes.filter((n) => n.id !== id));
    if (!canSync || id.startsWith("pn-")) return;
    try {
      await api.reader.deleteAnnotation(id);
    } catch {
      setNotesError("That note was removed here but not on the server.");
    }
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
      progress: progressPercent,
      accessed: "Just now",
    };
    onSavePodcastDetails(updated);
    setIsEditingMeta(false);
    triggerToast("Podcast details updated");
  };

  if (!isOpen) return null;

  // `totalDuration` is 0 until YouTube reports it, so every derived number
  // has to survive that — `0/0` rendered as "NaN% listened".
  const progressPercent = totalDuration
    ? Math.min(100, Math.max(0, Math.round((currentTime / totalDuration) * 100)))
    : 0;
  const remainingSeconds = Math.max(0, totalDuration - currentTime);

  const collapse = () => onExpandedChange?.(false);
  const expand = () => onExpandedChange?.(true);

  /*
   * The backdrop exists only while the player is expanded.
   *
   * It used to wrap the mini bar too, as a 0x0 pointer-events:none shell —
   * but `.modal-backdrop` carries `backdrop-filter`, and a filtered element
   * becomes the containing block for any `position: fixed` descendant. The
   * mini bar is fixed, so it was being positioned against that empty 0x0 box
   * at the top of the page instead of against the viewport: `bottom: 106px`
   * resolved to 106px *above* y=0, parking the bar off the top of the screen
   * where it simply could not be seen. Collapsed, there is now no wrapper at
   * all for it to be caught by.
   */
  const player = (
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
              <p>Artwork, link and show details.</p>
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
              {/* Without a link there is nothing to play, and the transport
                  used to sit there looking functional. */}
              {!videoId && (
                <p className="player-error" role="status">
                  No link yet — add one with the pencil above.
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
                {podcastName && <span className="podcast-show-pill">{podcastName}</span>}
                <h3 id="podcast-player-title" className="podcast-episode-title">
                  {episodeTitle || podcast.title}
                </h3>
                {creator && <span className="podcast-creator-name">with {creator}</span>}
              </div>
            </div>

            {/* ================= TIMELINE & PROGRESS ================= */}
            <div className="playback-timeline-section">
              <div className="timeline-scrubber-bar">
                <input
                  type="range"
                  min={0}
                  max={totalDuration || 1}
                  value={Math.round(currentTime)}
                  onChange={(e) => playback.seekTo(Number(e.target.value))}
                  disabled={!totalDuration}
                  aria-label="Seek"
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
                  {totalDuration ? `${progressPercent}% listened` : "Length unknown"}
                </span>
                <span className="time-remaining">
                  {totalDuration ? `-${formatTime(remainingSeconds)}` : "--:--"}
                </span>
              </div>
            </div>

            {/*
              ================= PLAYBACK CONTROLS =================
              Two rows on purpose. Seven controls in one centred row did not
              fit a phone: the speed and mode pills were clipped off either
              edge and the play button, being the only flexible item, was
              squashed from a 64px circle into a narrow oval. Transport
              (which you reach for constantly) is its own row; speed and
              output mode sit under it.
            */}
            <div className="player-controls-row">
              {/* Previous episode */}
              <button
                type="button"
                className="control-icon-btn episode-step-btn"
                onClick={() => goToEpisode(previousEpisode)}
                disabled={!previousEpisode}
                title={
                  previousEpisode
                    ? `Previous: ${previousEpisode.episodeTitle || previousEpisode.title}`
                    : "No earlier episode"
                }
                aria-label="Previous episode"
              >
                <SkipBack size={18} />
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
                disabled={!videoId}
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

              {/* Next episode */}
              <button
                type="button"
                className="control-icon-btn episode-step-btn"
                onClick={() => goToEpisode(nextEpisode)}
                disabled={!nextEpisode}
                title={
                  nextEpisode
                    ? `Next: ${nextEpisode.episodeTitle || nextEpisode.title}`
                    : "No later episode"
                }
                aria-label="Next episode"
              >
                <SkipForward size={18} />
              </button>

            </div>

            <div className="player-options-row">
              {/* Speed selector */}
              <button
                type="button"
                className="control-pill-btn speed-btn"
                onClick={cycleSpeed}
                title="Change Playback Speed"
              >
                {playbackSpeed}x
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
              {notesError && (
                <p className="composer-error" role="alert">
                  {notesError}
                </p>
              )}

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
                    Notes appear here and in your Knowledge.
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
  );

  if (!expanded) return player;

  return (
    <div className="modal-backdrop podcast-backdrop" onMouseDown={collapse}>
      {player}
    </div>
  );
}
