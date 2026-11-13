import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  FileText,
  SlidersHorizontal,
  StickyNote,
  X,
  Clock,
  Sparkles,
} from "lucide-react";
import type { LibraryItem } from "../../types/library";

interface ArticleReaderModalProps {
  article: LibraryItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdateProgress: (title: string, progress: number) => void;
  colorMode?: boolean;
}

export function ArticleReaderModal({
  article,
  isOpen,
  onClose,
  onUpdateProgress,
  colorMode = false,
}: ArticleReaderModalProps) {
  const [progress, setProgress] = useState<number>(article.progress || 18);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [fontSize, setFontSize] = useState<number>(17);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (isOpen) {
      onUpdateProgress(article.title, progress);
    }
  }, [progress, isOpen]);

  if (!isOpen) return null;

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTotal = target.scrollHeight - target.clientHeight;
    if (scrollTotal > 0) {
      const pct = Math.min(100, Math.max(0, Math.round((target.scrollTop / scrollTotal) * 100)));
      setProgress(pct);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`article-reader-modal glass-card ${colorMode ? "color-mode" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <header className="article-reader-header">
          <button type="button" className="reader-back-button" onClick={onClose}>
            <ArrowLeft size={16} />
            <span>Library</span>
          </button>
          <div className="article-title-block">
            <span className="section-kicker">{article.creator}</span>
            <h3>{article.title}</h3>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`toolbar-icon-button ${isBookmarked ? "bookmarked" : ""}`}
              onClick={() => {
                setIsBookmarked(!isBookmarked);
                triggerToast(isBookmarked ? "Bookmark removed" : "Article bookmarked");
              }}
              title="Bookmark Article"
            >
              {isBookmarked ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
            </button>
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Progress Bar */}
        <div className="article-progress-indicator">
          <div className="article-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Content Body */}
        <div className="article-reader-scroll" onScroll={handleScroll}>
          <article className="article-typography" style={{ fontSize: `${fontSize}px` }}>
            <div className="article-meta-banner">
              <span className="read-time-pill">
                <Clock size={13} /> {article.readTimeMinutes || 12} min read
              </span>
              <span className="resume-stat">Resume at {progress}%</span>
            </div>

            <h1>Designing Calm Systems</h1>
            <p className="article-subheading">
              How thoughtful interfaces protect cognitive bandwidth and respect human focus.
            </p>

            <div className="article-hero-image">
              <img src={article.image} alt={article.title} />
              <span className="caption">
                Subtle systems communicate what changed without demanding immediate reaction.
              </span>
            </div>

            <p>
              The primary challenge of modern computing is no longer information retrieval; it is cognitive preservation. Our digital environments bombard us with high-urgency notifications for low-consequence events.
            </p>

            <blockquote>
              “A calm system informs without alarming, organizes without cluttering, and recedes into the background until its presence is requested.”
            </blockquote>

            <h2>1. The Periphery of Attention</h2>
            <p>
              Mark Weiser and John Seely Brown observed that human beings are capable of processing vast amounts of information simultaneously through the periphery of attention. When something changes in the room—a shift in daylight, a change in ambient hum—we register it without losing our current train of thought.
            </p>
            <p>
              Software should mirror this natural attunement. Status indicators, progress bars, and calendar transitions ought to feel fluid, non-disruptive, and respectful of the human mind at work.
            </p>

            <h2>2. Asynchronous Respect</h2>
            <p>
              When a personal assistant organizes your schedule or summarizes your reading log, it should preserve user autonomy. Automated suggestions should be proposed calmly rather than imposed abruptly.
            </p>
            <p>
              By offering clear options—such as tracking a physical book alongside a digital PDF—the tool adapts to the user's life, rather than compelling the user to adapt to the tool.
            </p>
          </article>
        </div>

        {/* Footer */}
        <footer className="article-reader-footer">
          <span>Reading progress: {progress}%</span>
          <div className="font-controls">
            <button type="button" onClick={() => setFontSize((s) => Math.max(14, s - 1))}>
              A-
            </button>
            <button type="button" onClick={() => setFontSize((s) => Math.min(22, s + 1))}>
              A+
            </button>
          </div>
          <button type="button" className="primary-button" onClick={onClose}>
            Done Reading
          </button>
        </footer>

        {toast && (
          <div className="article-toast" role="status">
            <Check size={14} /> <span>{toast}</span>
          </div>
        )}
      </div>
    </div>
  );
}
