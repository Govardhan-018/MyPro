/**
 * "Read offline" for one book: download it, watch it download, see that it is
 * saved (size, pages, chapters, when), remove it. Backed by `offlineBooks`,
 * so the state is the same wherever the book appears.
 */
import { CloudOff, Download, RotateCw, Trash2, WifiOff } from "lucide-react";
import type { LibraryItem } from "../../types/library";
import { formatSize, useOfflineBooks } from "../../lib/offlineBooks";

export function OfflineDownloadCard({ book }: { book: LibraryItem }) {
  const offline = useOfflineBooks();
  const state = offline.state(book);
  const download = () => void offline.download(book).catch(() => undefined);

  return (
    <div className="offline-card" aria-live="polite">
      <div className="offline-card-head">
        <span className="section-kicker">OFFLINE READING</span>
        {state.phase === "done" && (
          <span className="offline-badge">
            <WifiOff size={12} /> Available offline
          </span>
        )}
      </div>

      {state.phase === "idle" && (
        <>
          <p>Save this book on this device to read it with no connection. Your progress and notes sync when you’re back online.</p>
          <button type="button" className="secondary-button offline-action" onClick={download}>
            <Download size={15} /> Download for offline
          </button>
        </>
      )}

      {state.phase === "downloading" && (
        <>
          <p>
            {state.step}… {state.percent}%
          </p>
          <div
            className="offline-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent}
            aria-label="Download progress"
          >
            <span style={{ width: `${state.percent}%` }} />
          </div>
        </>
      )}

      {state.phase === "done" && (
        <>
          <p>
            {state.record.pageCount} pages
            {state.record.chapters ? ` · ${state.record.chapters} chapters` : ""} ·{" "}
            {formatSize(state.record.sizeBytes)} · saved{" "}
            {new Date(state.record.savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </p>
          <button type="button" className="secondary-button offline-action" onClick={() => void offline.remove(book)}>
            <Trash2 size={15} /> Remove download
          </button>
        </>
      )}

      {state.phase === "failed" && (
        <>
          <p className="offline-error">
            <CloudOff size={14} /> {state.reason}
          </p>
          <button type="button" className="secondary-button offline-action" onClick={download}>
            <RotateCw size={15} /> Try again
          </button>
        </>
      )}
    </div>
  );
}
