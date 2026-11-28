import { useState, useRef } from "react";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  FileText,
  HardDrive,
  Minus,
  Plus,
  Upload,
  X,
} from "lucide-react";
import type { LibraryItem } from "../../types/library";
import { storePdfLocally, formatBytes } from "../../utils/pdfStorage";
import { BookCover } from "./BookCover";
import { readPageCount } from "../../lib/pdfEngine";
import { OfflineDownloadCard } from "./OfflineDownloadCard";

interface BookOptionsModalProps {
  book: LibraryItem;
  isOpen: boolean;
  onClose: () => void;
  onUpdateProgress: (title: string, newPage: number, totalPages: number) => void;
  onOpenReader: (item: LibraryItem) => void;
  onImportPdf: (
    title: string,
    fileName: string,
    storageChoice: "device" | "sync",
    detectedPages: number,
    syncStatus: "local" | "synced",
    fileSizeBytes?: number,
  ) => void;
  colorMode?: boolean;
}

export function BookOptionsModal({
  book,
  isOpen,
  onClose,
  onUpdateProgress,
  onOpenReader,
  onImportPdf,
  colorMode = false,
}: BookOptionsModalProps) {
  const [activeTab, setActiveTab] = useState<"track" | "pdf">(
    book.pdfFileName ? "pdf" : "track",
  );

  // Track Physical Book state
  const [currentPage, setCurrentPage] = useState<number>(book.currentPage || 1);
  const [totalPages, setTotalPages] = useState<number>(book.totalPages || 320);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // PDF Import state
  const [selectedFileName, setSelectedFileName] = useState<string>(
    book.pdfFileName || "",
  );
  const [selectedFileObj, setSelectedFileObj] = useState<File | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(
    book.fileSizeBytes || 5033164,
  );
  const [detectedPages, setDetectedPages] = useState<number>(
    book.totalPages || 320,
  );
  const [storageOption, setStorageOption] = useState<"device" | "sync">(
    book.pdfStorageOption || "device",
  );

  const [currentSyncStatus, setCurrentSyncStatus] = useState<"local" | "synced" | "pending">(
    book.syncStatus === "synced" ? "synced" : book.pdfFileName ? "local" : "pending",
  );
  const [actionNotice, setActionNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Auto calculate percentage
  const validTotal = Math.max(1, totalPages);
  const validCurrent = Math.min(validTotal, Math.max(0, currentPage));
  const progressPercent = Math.round((validCurrent / validTotal) * 100);

  /** The device vault is keyed by item id; the title is the legacy fallback. */
  const vaultKey = book.id ?? book.title;

  const handleSavePage = () => {
    onUpdateProgress(book.title, validCurrent, validTotal);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2400);
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFileObj(file);
      setSelectedFileName(file.name);
      setFileSizeBytes(file.size);

      // Ask the PDF how many pages it has; fall back to a size estimate only
      // if it cannot be read here.
      let pages = 0;
      try {
        pages = await readPageCount(await file.arrayBuffer());
      } catch {
        pages = 0;
      }
      const detected =
        pages || Math.max(42, Math.min(650, Math.round(file.size / (1024 * 35)) || 320));
      setDetectedPages(detected);

      // IMPORTANT USER CONTROL: Do NOT upload automatically.
      // Default to local storage upon selection until explicitly chosen to sync.
      if (storageOption === "device") {
        await storePdfLocally(vaultKey, file, file.name);
        setCurrentSyncStatus("local");
        onImportPdf(book.title, file.name, "device", detected, "local", file.size);
        setActionNotice("Stored locally in IndexedDB (Offline ready)");
        setTimeout(() => setActionNotice(""), 3500);
      } else {
        // Pending user explicit click to upload to Supabase
        setCurrentSyncStatus("pending");
      }
    }
  };

  const handleLaunchReader = () => {
    onClose();
    onOpenReader({
      ...book,
      currentPage: validCurrent,
      totalPages: validTotal,
      pdfFileName:
        selectedFileName ||
        book.pdfFileName ||
        `${book.title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
      pdfStorageOption: storageOption,
      syncStatus: currentSyncStatus === "synced" ? "synced" : "local",
      fileSizeBytes,
      fileSizeFormatted: formatBytes(fileSizeBytes),
    });
  };

  const pagesLeft = Math.max(0, validTotal - validCurrent);
  const finished = validCurrent >= validTotal;
  const dirty = validCurrent !== (book.currentPage || 0) || validTotal !== (book.totalPages || validTotal);
  /** A rough finish estimate: about a minute and a half a page. */
  const timeLeft = (() => {
    const minutes = Math.round(pagesLeft * 1.5);
    if (!minutes) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
  })();
  const setPage = (page: number) => setCurrentPage(Math.min(validTotal, Math.max(0, Math.round(page))));
  const hasPdf = Boolean(selectedFileName);

  return (
    <div className="modal-backdrop bo-backdrop" onMouseDown={onClose}>
      <div
        className={`book-sheet glass-card ${colorMode ? "color-mode" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-options-title"
      >
        <div className="bo-grabber" aria-hidden="true" />

        {/* ---- Who this book is ---- */}
        <header className="bo-head">
          <div className="bo-cover">
            {book.image ? (
              <img src={book.image} alt="" />
            ) : (
              <BookCover title={book.title} author={book.creator} seed={book.id ?? book.title} size="small" />
            )}
          </div>
          <div className="bo-identity">
            <span className="section-kicker">{hasPdf ? "DIGITAL BOOK" : "BOOK"}</span>
            <h2 id="book-options-title">{book.title}</h2>
            {book.creator && <p className="bo-author">{book.creator}</p>}
            <div className="bo-chips">
              <span className="bo-chip">
                <FileText size={12} /> {validTotal} pages
              </span>
              <span className={`bo-chip ${hasPdf ? "is-accent" : ""}`}>
                {hasPdf ? <HardDrive size={12} /> : <BookOpen size={12} />}
                {hasPdf ? "PDF on this device" : "Print or elsewhere"}
              </span>
            </div>
          </div>
          <button type="button" className="icon-button bo-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="bo-tabs" role="tablist" aria-label="How you read this book">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "track"}
            className={activeTab === "track" ? "active" : ""}
            onClick={() => setActiveTab("track")}
          >
            <Bookmark size={15} /> Track progress
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pdf"}
            className={activeTab === "pdf" ? "active" : ""}
            onClick={() => setActiveTab("pdf")}
          >
            <BookOpen size={15} /> Read PDF
          </button>
        </div>

        <div className="bo-body">
          {activeTab === "track" ? (
            <>
              {/* ---- Where you are ---- */}
              <section className="bo-progress" aria-label="Progress">
                <div className="bo-progress-top">
                  <div>
                    <span className="section-kicker">PROGRESS</span>
                    <strong className="bo-percent">
                      {progressPercent}
                      <small>%</small>
                    </strong>
                  </div>
                  <div className="bo-progress-side">
                    <span className="bo-pages">
                      <b>{validCurrent}</b> / {validTotal}
                    </span>
                    <span className="bo-left">
                      {finished ? (
                        <>
                          <CheckCircle2 size={13} /> Finished
                        </>
                      ) : (
                        <>
                          {pagesLeft} pages left{timeLeft ? ` · ≈ ${timeLeft}` : ""}
                        </>
                      )}
                    </span>
                  </div>
                </div>
                <div className="bo-bar" aria-hidden="true">
                  <i style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="bo-updated">
                  <Clock size={12} /> {book.accessed ? `Last opened ${book.accessed.charAt(0).toLowerCase()}${book.accessed.slice(1)}` : "Not opened yet"}
                </span>
              </section>

              {/* ---- Set the page ---- */}
              <section className="bo-pager" aria-label="Current page">
                <span className="bo-label">I’M ON PAGE</span>
                <div className="bo-stepper">
                  <button type="button" aria-label="Previous page" onClick={() => setPage(validCurrent - 1)} disabled={validCurrent <= 0}>
                    <Minus size={18} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={validTotal}
                    value={currentPage}
                    aria-label="Current page"
                    onChange={(e) => setCurrentPage(parseInt(e.target.value) || 0)}
                    onBlur={() => setPage(currentPage)}
                  />
                  <button type="button" aria-label="Next page" onClick={() => setPage(validCurrent + 1)} disabled={finished}>
                    <Plus size={18} />
                  </button>
                </div>
                <input
                  className="bo-slider"
                  type="range"
                  min={0}
                  max={validTotal}
                  value={validCurrent}
                  aria-label="Scrub to page"
                  style={{ ["--fill" as string]: `${progressPercent}%` }}
                  onChange={(e) => setPage(Number(e.target.value))}
                />
                <div className="bo-quick">
                  <button type="button" onClick={() => setPage(validCurrent - 10)}>−10</button>
                  <button type="button" onClick={() => setPage(validCurrent + 10)}>+10</button>
                  <button type="button" onClick={() => setPage(validCurrent + 25)}>+25</button>
                  <button type="button" className={finished ? "active" : ""} onClick={() => setPage(validTotal)}>
                    <Check size={13} /> Finished
                  </button>
                </div>
                <label className="bo-length">
                  <span>Book length</span>
                  <span className="bo-length-field">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={totalPages}
                      aria-label="Total pages"
                      onChange={(e) => setTotalPages(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    pages
                  </span>
                </label>
              </section>
            </>
          ) : (
            <>
              {/* ---- The file ---- */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className={`bo-file ${hasPdf ? "has-file" : ""}`}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="bo-file-icon">{hasPdf ? <FileText size={22} /> : <Upload size={22} />}</span>
                <span className="bo-file-text">
                  <strong>{hasPdf ? selectedFileName : "Choose a PDF"}</strong>
                  <small>
                    {hasPdf
                      ? `${detectedPages} pages · ${formatBytes(fileSizeBytes)}`
                      : "From this phone or computer — it stays on this device"}
                  </small>
                </span>
                <span className="bo-file-action">{hasPdf ? "Replace" : "Browse"}</span>
              </button>

              {/* ---- Where it lives ---- */}
              <section className="bo-storage" aria-label="Storage">
                <span className="bo-label">WHERE IT’S KEPT</span>
                <div className="bo-store-option is-selected">
                  <HardDrive size={18} />
                  <span>
                    <strong>On this device</strong>
                    <small>Private, and readable offline. Nothing is uploaded.</small>
                  </span>
                  <Check size={16} className="bo-store-check" />
                </div>
                <div className="bo-store-option is-disabled" aria-disabled="true">
                  <Cloud size={18} />
                  <span>
                    <strong>Sync across devices</strong>
                    <small>Cloud storage for PDFs isn’t available yet.</small>
                  </span>
                  <span className="bo-soon">Soon</span>
                </div>
              </section>

              {/* Only a book with a PDF has anything to take offline. */}
              {hasPdf && <OfflineDownloadCard book={book} />}

              {actionNotice && (
                <p className="bo-notice" role="status">
                  <Check size={14} /> {actionNotice}
                </p>
              )}
            </>
          )}
        </div>

        {/* ---- Actions ---- */}
        <footer className="bo-actions">
          {activeTab === "track" ? (
            <>
              <button type="button" className="bo-btn bo-btn-quiet" onClick={handleSavePage} disabled={!dirty && !savedSuccess}>
                {savedSuccess ? (
                  <>
                    <Check size={16} /> Saved
                  </>
                ) : (
                  "Save progress"
                )}
              </button>
              <button type="button" className="bo-btn bo-btn-primary" onClick={handleLaunchReader}>
                <BookOpen size={16} /> Open reader <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="bo-btn bo-btn-quiet" onClick={onClose}>
                Close
              </button>
              <button type="button" className="bo-btn bo-btn-primary" onClick={handleLaunchReader} disabled={!hasPdf}>
                <BookOpen size={16} /> Read now <ArrowRight size={15} />
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
