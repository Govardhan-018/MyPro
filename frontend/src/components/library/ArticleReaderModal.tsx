import { useState, useEffect, useRef } from "react";
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
  // `|| 18` meant opening an unread article immediately saved it as 18% read.
  const [progress, setProgress] = useState<number>(article.progress || 0);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [fontSize, setFontSize] = useState<number>(17);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (isOpen) {
      onUpdateProgress(article.title, progress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, isOpen]);

  const toastTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  if (!isOpen) return null;

  const triggerToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2000);
  };

  /** The saved text of this article, if there is any. */
  const paragraphs = (article.articleContent ?? "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceUrl = article.pdfUrl;

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

            {/* This was a fixed essay titled "Designing Calm Systems", shown
                for whichever article you opened. It is the item's own now. */}
            <h1>{article.title}</h1>
            {article.creator && <p className="article-subheading">{article.creator}</p>}

            {article.image && (
              <div className="article-hero-image">
                <img src={article.image} alt="" />
              </div>
            )}

            {paragraphs.length > 0 ? (
              paragraphs.map((text, index) => <p key={index}>{text}</p>)
            ) : (
              <div className="article-empty-state">
                <FileText size={20} />
                <strong>No saved text for this article yet</strong>
                <span>
                  MyPro keeps the article&rsquo;s own text once it has it. Until then you can
                  read it at the source and track how far you got here.
                </span>
                {sourceUrl && (
                  <a
                    className="primary-button"
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open the original
                  </a>
                )}
              </div>
            )}
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
