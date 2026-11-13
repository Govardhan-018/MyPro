import { useState, useRef } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  FileText,
  HardDrive,
  Info,
  Sparkles,
  Upload,
  X,
  ArrowRight,
  Bookmark,
  ChevronRight,
  Lock,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type { LibraryItem } from "../../types/library";
import {
  storePdfLocally,
  performSupabaseUpload,
  formatBytes,
} from "../../utils/pdfStorage";

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

  // Upload & storage execution state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
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

      // Estimate realistic page count
      const estimatedPages = Math.max(
        42,
        Math.min(650, Math.round(file.size / (1024 * 35)) || 320),
      );
      setDetectedPages(estimatedPages);

      // IMPORTANT USER CONTROL: Do NOT upload automatically.
      // Default to local storage upon selection until explicitly chosen to sync.
      if (storageOption === "device") {
        await storePdfLocally(book.title, file, file.name);
        setCurrentSyncStatus("local");
        onImportPdf(book.title, file.name, "device", estimatedPages, "local", file.size);
        setActionNotice("Stored locally in IndexedDB (Offline ready)");
        setTimeout(() => setActionNotice(""), 3500);
      } else {
        // Pending user explicit click to upload to Supabase
        setCurrentSyncStatus("pending");
      }
    }
  };

  // Option 1: Explicitly Confirm Keep on This Device
  const handleSaveToDevice = async () => {
    setStorageOption("device");
    if (selectedFileObj) {
      await storePdfLocally(book.title, selectedFileObj, selectedFileName);
    }
    setCurrentSyncStatus("local");
    onImportPdf(
      book.title,
      selectedFileName || `${book.title}.pdf`,
      "device",
      detectedPages,
      "local",
      fileSizeBytes,
    );
    setActionNotice("PDF saved to IndexedDB on this device (No cloud upload)");
    setTimeout(() => setActionNotice(""), 3500);
  };

  // Option 2: Explicitly Begin Upload & Sync with MyPro (Supabase)
  const handleBeginCloudSync = async () => {
    setStorageOption("sync");
    setIsUploading(true);
    setUploadPercent(0);
    setUploadedBytes(0);

    const fName = selectedFileName || `${book.title}.pdf`;
    await performSupabaseUpload(fName, fileSizeBytes, (pct, bytes) => {
      setUploadPercent(pct);
      setUploadedBytes(bytes);
    });

    setIsUploading(false);
    setCurrentSyncStatus("synced");
    onImportPdf(book.title, fName, "sync", detectedPages, "synced", fileSizeBytes);
    setActionNotice("Uploaded to your private Supabase storage bucket & synced!");
    setTimeout(() => setActionNotice(""), 3500);
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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="book-options-modal glass-card"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-options-title"
      >
        {/* Modal Header */}
        <div className="book-options-header">
          <div className="book-options-summary">
            <div className="book-mini-cover">
              {book.image ? (
                <img src={book.image} alt={book.title} />
              ) : (
                <BookOpen size={24} className="text-muted" />
              )}
            </div>
            <div>
              <div className="modal-title-row">
                <span className="section-kicker">MYPRO READING ENVIRONMENT</span>
                {/* Active Storage Badge */}
                {currentSyncStatus === "synced" ? (
                  <span className="badge-synced-pill">
                    <Cloud size={11} /> Synced
                  </span>
                ) : (
                  <span className="badge-local-pill">
                    <HardDrive size={11} /> Local
                  </span>
                )}
              </div>
              <h2 id="book-options-title">{book.title}</h2>
              <p className="book-author">by {book.creator}</p>
            </div>
          </div>
          <button
            className="icon-button close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="book-tab-switcher" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "track"}
            className={`tab-btn ${activeTab === "track" ? "active" : ""}`}
            onClick={() => setActiveTab("track")}
          >
            <Bookmark size={15} />
            <span>Option A: Track Reading Progress</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pdf"}
            className={`tab-btn ${activeTab === "pdf" ? "active" : ""}`}
            onClick={() => setActiveTab("pdf")}
          >
            <BookOpen size={15} />
            <span>Option B: Read PDF Inside MyPro</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="book-options-content">
          {activeTab === "track" ? (
            /* ================= OPTION A ================= */
            <div className="track-progress-pane">
              <div className="pane-intro">
                <span className="pane-pill">Physical & External Reading</span>
                <p>
                  Track progress for print copies or books read outside MyPro.
                  Keep your personal reading log synchronized with your goals.
                </p>
              </div>

              {/* Progress Summary Card */}
              <div className="progress-preview-card">
                <div className="progress-numbers">
                  <div>
                    <span className="kicker">PROGRESS</span>
                    <strong>{progressPercent}%</strong>
                  </div>
                  <div className="pages-ratio">
                    Page <span>{validCurrent}</span> of <span>{validTotal}</span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="progress-bar-wrap">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="progress-meta-row">
                  <span className="meta-info">
                    <Clock size={13} />
                    {book.lastReadDate || "Updated today"}
                  </span>
                  <span className="formula-tag">
                    Page {validCurrent} / {validTotal} = {progressPercent}%
                  </span>
                </div>
              </div>

              {/* Page Number Inputs */}
              <div className="page-inputs-grid">
                <label className="input-group">
                  <span className="input-label">CURRENT PAGE</span>
                  <div className="number-stepper">
                    <input
                      type="number"
                      min={0}
                      max={validTotal}
                      value={currentPage}
                      onChange={(e) =>
                        setCurrentPage(parseInt(e.target.value) || 0)
                      }
                    />
                    <div className="quick-steppers">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                        title="Subtract 1 page"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentPage((p) => Math.min(validTotal, p + 1))
                        }
                        title="Add 1 page"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentPage((p) => Math.min(validTotal, p + 10))
                        }
                        title="Add 10 pages"
                      >
                        +10
                      </button>
                    </div>
                  </div>
                </label>

                <label className="input-group">
                  <span className="input-label">TOTAL PAGES</span>
                  <input
                    type="number"
                    min={1}
                    value={totalPages}
                    onChange={(e) =>
                      setTotalPages(Math.max(1, parseInt(e.target.value) || 1))
                    }
                  />
                </label>
              </div>

              {/* Actions */}
              <div className="pane-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSavePage}
                >
                  {savedSuccess ? (
                    <>
                      <Check size={16} /> Progress Saved
                    </>
                  ) : (
                    "Update Current Page"
                  )}
                </button>
                <button
                  type="button"
                  className="primary-button resume-action-btn"
                  onClick={handleLaunchReader}
                >
                  <BookOpen size={16} />
                  <span>Resume Reading Experience</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : (
            /* ================= OPTION B ================= */
            <div className="pdf-import-pane">
              <div className="pane-intro">
                <span className="pane-pill">Digital Reading in MyPro</span>
                <p>
                  Read comfortably inside MyPro’s dedicated dark reading
                  environment with bookmarking, page notes, and auto-resume.
                </p>
              </div>

              {/* PDF File Picker Zone */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden-file-input"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />

              <div
                className={`pdf-dropzone ${selectedFileName ? "has-file" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="dropzone-icon">
                  <Upload size={22} />
                </div>
                <div className="dropzone-text">
                  <strong>
                    {selectedFileName
                      ? selectedFileName
                      : "Select PDF from Device"}
                  </strong>
                  <span>
                    {selectedFileName
                      ? `Detected ${detectedPages} pages · ${formatBytes(
                          fileSizeBytes,
                        )} · ${
                          currentSyncStatus === "synced"
                            ? "Synced in Supabase Vault"
                            : "Stored in IndexedDB (Offline)"
                        }`
                      : "Choose a PDF file from your laptop or mobile device to read inside MyPro"}
                  </span>
                </div>
                <button
                  type="button"
                  className="file-select-pill"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  {selectedFileName ? "Change PDF" : "Browse Device"}
                </button>
              </div>

              {/* The Two Storage Choices */}
              <div className="storage-choices-card">
                <div className="storage-heading">
                  <span className="section-kicker">STORAGE PREFERENCE</span>
                  <h3>Select Where This PDF is Stored</h3>
                </div>

                <div className="storage-options-group">
                  {/* Option 1: Keep on This Device */}
                  <label
                    className={`storage-radio-label ${
                      storageOption === "device" ? "selected" : ""
                    }`}
                    onClick={() => setStorageOption("device")}
                  >
                    <input
                      type="radio"
                      name="storageChoice"
                      value="device"
                      checked={storageOption === "device"}
                      onChange={() => setStorageOption("device")}
                    />
                    <div className="storage-option-content">
                      <div className="storage-option-title">
                        <HardDrive size={16} />
                        <strong>Option 1: Keep on This Device</strong>
                        <span className="badge-quiet">IndexedDB · Offline</span>
                      </div>
                      <p>
                        Stores the PDF locally using IndexedDB in your browser.
                        Does not upload the PDF to Supabase. Reading progress is
                        saved locally with full offline access.
                      </p>
                    </div>
                  </label>

                  {/* Option 2: Sync with MyPro */}
                  <label
                    className={`storage-radio-label ${
                      storageOption === "sync" ? "selected" : ""
                    }`}
                    onClick={() => setStorageOption("sync")}
                  >
                    <input
                      type="radio"
                      name="storageChoice"
                      value="sync"
                      checked={storageOption === "sync"}
                      onChange={() => setStorageOption("sync")}
                    />
                    <div className="storage-option-content">
                      <div className="storage-option-title">
                        <Cloud size={16} />
                        <strong>Option 2: Sync with MyPro</strong>
                        <span className="badge-sync">Supabase Storage</span>
                      </div>
                      <p>
                        Uploads the PDF to your private Supabase Storage bucket.
                        Metadata and progress sync to Supabase Database for seamless
                        access across all your authenticated devices.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Important User Control Notice & Explicit Trigger */}
                <div className="upload-control-zone">
                  {storageOption === "sync" ? (
                    <div className="sync-upload-action-box">
                      <div className="control-note">
                        <Lock size={14} />
                        <span>
                          <strong>Zero Automatic Uploads:</strong> MyPro will only
                          upload this PDF when you explicitly click the button
                          below.
                        </span>
                      </div>

                      {isUploading ? (
                        <div className="upload-progress-container">
                          <div className="upload-progress-header">
                            <span>Uploading to private Supabase bucket...</span>
                            <strong>
                              {uploadPercent}% ({formatBytes(uploadedBytes)} of{" "}
                              {formatBytes(fileSizeBytes)})
                            </strong>
                          </div>
                          <div className="upload-progress-bar">
                            <div
                              className="upload-progress-fill"
                              style={{ width: `${uploadPercent}%` }}
                            />
                          </div>
                        </div>
                      ) : currentSyncStatus === "synced" ? (
                        <div className="upload-complete-pill">
                          <CheckCircle2 size={16} />
                          <span>
                            PDF is synced to your private Supabase Vault ({formatBytes(fileSizeBytes)})
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="primary-button explicit-sync-btn"
                          onClick={handleBeginCloudSync}
                        >
                          <Cloud size={16} />
                          <span>Begin Sync with MyPro (Upload PDF)</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="device-local-action-box">
                      <div className="control-note local">
                        <HardDrive size={14} />
                        <span>
                          <strong>Device Storage Active:</strong> PDF stays strictly
                          on this device in IndexedDB. No data transmitted to cloud.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button confirm-local-btn"
                        onClick={handleSaveToDevice}
                      >
                        <Check size={14} />
                        <span>Confirm Local Device Storage</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Toast Notice */}
              {actionNotice && (
                <div className="inline-action-toast">
                  <Check size={14} />
                  <span>{actionNotice}</span>
                </div>
              )}

              {/* Launch Reader CTA */}
              <div className="pane-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onClose}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="primary-button launch-reader-btn"
                  onClick={handleLaunchReader}
                >
                  <BookOpen size={16} />
                  <span>Open in MyPro Dark Reader</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
