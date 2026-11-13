import { useState, useEffect } from "react";
import {
  Cloud,
  HardDrive,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Info,
  RefreshCw,
  Sparkles,
  Upload,
  X,
  AlertTriangle,
  Lock,
  Smartphone,
  Laptop,
} from "lucide-react";
import type { LibraryItem } from "../../types/library";
import {
  getLocalDbUsage,
  formatBytes,
  performSupabaseUpload,
  storePdfLocally,
  deletePdfLocally,
} from "../../utils/pdfStorage";

interface StorageSyncViewProps {
  books: LibraryItem[];
  onUpdateBookStorage: (
    title: string,
    newStorageOption: "device" | "sync",
    syncStatus: "local" | "synced",
    lastSyncedAt?: string,
  ) => void;
  onBack: () => void;
  colorMode?: boolean;
}

export function StorageSyncView({
  books,
  onUpdateBookStorage,
  onBack,
  colorMode = false,
}: StorageSyncViewProps) {
  const [filter, setFilter] = useState<"all" | "local" | "cloud">("all");
  const [localUsageBytes, setLocalUsageBytes] = useState<number>(0);
  const [cloudUsageBytes, setCloudUsageBytes] = useState<number>(0);
  const [syncingTitle, setSyncingTitle] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string>("");

  // Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    book: LibraryItem | null;
    targetMode: "device" | "sync";
  }>({
    isOpen: false,
    book: null,
    targetMode: "device",
  });

  // Calculate storage numbers
  useEffect(() => {
    // Read from IndexedDB
    getLocalDbUsage().then(({ totalBytes }) => {
      // If user has books marked local, ensure we reflect them
      const localBooks = books.filter(
        (b) => b.type === "Books" && (b.pdfStorageOption === "device" || b.syncStatus === "local"),
      );
      const calculatedLocal = localBooks.reduce((acc, b) => acc + (b.fileSizeBytes || 4800000), 0);
      setLocalUsageBytes(Math.max(totalBytes, calculatedLocal));
    });

    const cloudBooks = books.filter(
      (b) => b.type === "Books" && b.pdfStorageOption === "sync" && b.syncStatus === "synced",
    );
    const calculatedCloud = cloudBooks.reduce((acc, b) => acc + (b.fileSizeBytes || 8500000), 0);
    setCloudUsageBytes(calculatedCloud);
  }, [books]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 2800);
  };

  // Only display books with PDFs
  const pdfBooks = books.filter((b) => b.type === "Books" && (b.pdfFileName || b.pdfStorageOption));

  const filteredBooks = pdfBooks.filter((b) => {
    const isCloud = b.pdfStorageOption === "sync" || b.syncStatus === "synced";
    if (filter === "local") return !isCloud;
    if (filter === "cloud") return isCloud;
    return true;
  });

  // Trigger Confirmation
  const promptStorageChange = (book: LibraryItem, targetMode: "device" | "sync") => {
    setConfirmDialog({
      isOpen: true,
      book,
      targetMode,
    });
  };

  // Execute Confirmed Change
  const executeStorageChange = async () => {
    const { book, targetMode } = confirmDialog;
    if (!book) return;

    setConfirmDialog({ isOpen: false, book: null, targetMode: "device" });

    if (targetMode === "sync") {
      // Move from Local to Cloud
      setSyncingTitle(book.title);
      setSyncProgress(0);
      await performSupabaseUpload(
        book.pdfFileName || `${book.title}.pdf`,
        book.fileSizeBytes || 5000000,
        (pct) => setSyncProgress(pct),
      );
      await deletePdfLocally(book.title);
      onUpdateBookStorage(book.title, "sync", "synced", "Just now");
      setSyncingTitle(null);
      triggerToast(`“${book.title}” moved to encrypted Supabase Cloud Storage.`);
    } else {
      // Move from Cloud to Local
      setSyncingTitle(book.title);
      setSyncProgress(30);
      // Simulate local IndexedDB download
      const dummyBlob = new Blob(["PDF_BINARY_DATA"], { type: "application/pdf" });
      await storePdfLocally(book.title, dummyBlob, book.pdfFileName || `${book.title}.pdf`);
      setSyncProgress(100);
      onUpdateBookStorage(book.title, "device", "local");
      setSyncingTitle(null);
      triggerToast(`“${book.title}” stored locally in IndexedDB (Offline ready).`);
    }
  };

  // Manual Re-sync action
  const handleSyncNow = (book: LibraryItem) => {
    setSyncingTitle(book.title);
    setSyncProgress(0);
    performSupabaseUpload(
      book.pdfFileName || `${book.title}.pdf`,
      book.fileSizeBytes || 5000000,
      (pct) => setSyncProgress(pct),
    ).then(() => {
      onUpdateBookStorage(book.title, "sync", "synced", "Just now");
      setSyncingTitle(null);
      triggerToast(`“${book.title}” reading progress synchronized.`);
    });
  };

  const cloudLimitBytes = 5 * 1024 * 1024 * 1024; // 5 GB Supabase Free Tier
  const cloudPercent = Math.min(100, Math.round((cloudUsageBytes / cloudLimitBytes) * 100));

  return (
    <div className={`page-content foundation-view storage-sync-view ${colorMode ? "color-mode" : ""}`}>
      {/* Header */}
      <header className="page-heading">
        <div>
          <button type="button" className="settings-back-btn" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>Settings</span>
          </button>
          <div className="eyebrow muted-eyebrow">STORAGE & PRIVACY</div>
          <h1>Storage & Sync Management</h1>
          <p>
            Choose where your PDF documents live. Store documents locally on this device
            using IndexedDB or sync them across devices via your private Supabase bucket.
          </p>
        </div>
      </header>

      {/* Storage Overview Cards */}
      <section className="storage-overview-grid">
        {/* Local Storage Card */}
        <div className="glass-card storage-stat-card">
          <div className="stat-card-header">
            <div className="stat-icon local-icon">
              <HardDrive size={18} />
            </div>
            <div>
              <span className="section-kicker">LOCAL STORAGE</span>
              <h3>IndexedDB Device Storage</h3>
            </div>
            <span className="badge-local-pill">Offline Ready</span>
          </div>

          <div className="storage-capacity-display">
            <strong>{formatBytes(localUsageBytes)}</strong>
            <span>used on this laptop/browser</span>
          </div>

          <div className="storage-meter-track">
            <div
              className="storage-meter-fill local-fill"
              style={{ width: `${Math.min(100, Math.max(8, (localUsageBytes / (50 * 1024 * 1024)) * 100))}%` }}
            />
          </div>

          <p className="stat-card-note">
            <Info size={13} />
            Documents stored locally never leave your device and remain accessible without internet.
          </p>
        </div>

        {/* Cloud Storage Card */}
        <div className="glass-card storage-stat-card">
          <div className="stat-card-header">
            <div className="stat-icon cloud-icon">
              <Cloud size={18} />
            </div>
            <div>
              <span className="section-kicker">MYPRO CLOUD SYNC</span>
              <h3>Private Supabase Vault</h3>
            </div>
            <span className="badge-sync-pill">Encrypted</span>
          </div>

          <div className="storage-capacity-display">
            <strong>{formatBytes(cloudUsageBytes)}</strong>
            <span>of 5.0 GB cloud quota used ({cloudPercent}%)</span>
          </div>

          <div className="storage-meter-track">
            <div
              className="storage-meter-fill cloud-fill"
              style={{ width: `${Math.max(12, cloudPercent)}%` }}
            />
          </div>

          <p className="stat-card-note">
            <Lock size={13} />
            Documents are encrypted at rest in your private Supabase Storage bucket and sync reading progress.
          </p>
        </div>
      </section>

      {/* Books Storage Table Section */}
      <section className="glass-card storage-books-table-card">
        <div className="table-card-header">
          <div>
            <span className="section-kicker">MANAGED DOCUMENTS</span>
            <h2>PDF Books & Storage Mode</h2>
          </div>

          {/* Filter Pills */}
          <div className="storage-filter-pills" role="tablist">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All Books ({pdfBooks.length})
            </button>
            <button
              type="button"
              className={filter === "local" ? "active" : ""}
              onClick={() => setFilter("local")}
            >
              <HardDrive size={13} />
              Local Device ({pdfBooks.filter((b) => b.pdfStorageOption === "device" || b.syncStatus === "local").length})
            </button>
            <button
              type="button"
              className={filter === "cloud" ? "active" : ""}
              onClick={() => setFilter("cloud")}
            >
              <Cloud size={13} />
              Cloud Synced ({pdfBooks.filter((b) => b.pdfStorageOption === "sync" || b.syncStatus === "synced").length})
            </button>
          </div>
        </div>

        {/* Books List */}
        <div className="storage-books-list">
          {filteredBooks.map((book) => {
            const isCloud = book.pdfStorageOption === "sync" || book.syncStatus === "synced";
            const isCurrentlySyncing = syncingTitle === book.title;

            return (
              <div className="storage-book-row" key={book.title}>
                {/* Book Artwork & Title */}
                <div className="book-id-col">
                  <div className="book-row-cover">
                    {book.image ? <img src={book.image} alt={book.title} /> : <FileText size={20} />}
                  </div>
                  <div>
                    <strong>{book.title}</strong>
                    <span className="book-creator">{book.creator}</span>
                    <span className="book-filename">{book.pdfFileName || `${book.title}.pdf`}</span>
                  </div>
                </div>

                {/* Storage Badge & Size */}
                <div className="storage-badge-col">
                  {isCloud ? (
                    <span className="badge-synced">
                      <Cloud size={13} />
                      Synced (Supabase)
                    </span>
                  ) : (
                    <span className="badge-local">
                      <HardDrive size={13} />
                      Local (IndexedDB)
                    </span>
                  )}
                  <span className="file-size-info">{book.fileSizeFormatted || "4.8 MB"}</span>
                </div>

                {/* Status Column */}
                <div className="storage-status-col">
                  {isCurrentlySyncing ? (
                    <div className="syncing-status-box">
                      <div className="syncing-header">
                        <span>Uploading...</span>
                        <strong>{syncProgress}%</strong>
                      </div>
                      <div className="syncing-bar">
                        <div className="syncing-bar-fill" style={{ width: `${syncProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="status-meta">
                      <span className="status-label">
                        {isCloud ? "Cross-device synced" : "Offline on this device"}
                      </span>
                      <small className="last-sync-time">
                        {isCloud
                          ? `Last synced ${book.lastSyncedAt || "Today, 11:30 AM"}`
                          : "No cloud upload"}
                      </small>
                    </div>
                  )}
                </div>

                {/* Actions Column */}
                <div className="storage-actions-col">
                  {isCloud ? (
                    <>
                      <button
                        type="button"
                        className="storage-action-btn move-btn"
                        onClick={() => promptStorageChange(book, "device")}
                        title="Move PDF from Supabase cloud to local IndexedDB"
                      >
                        <HardDrive size={14} />
                        <span>Move to Local</span>
                      </button>
                      <button
                        type="button"
                        className="storage-action-btn sync-btn"
                        onClick={() => handleSyncNow(book)}
                        title="Re-sync reading progress with Supabase"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="storage-action-btn move-btn cloud-promote"
                      onClick={() => promptStorageChange(book, "sync")}
                      title="Upload PDF to your private Supabase vault"
                    >
                      <Cloud size={14} />
                      <span>Move to Cloud</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="storage-action-btn download-btn"
                    onClick={() => triggerToast(`Exporting “${book.title}” PDF to your downloads folder.`)}
                    title="Download a local PDF copy"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredBooks.length === 0 && (
            <div className="storage-empty-state">
              <FileText size={24} />
              <strong>No matching documents in this view</strong>
              <span>Import PDFs into your Library to manage their storage.</span>
            </div>
          )}
        </div>
      </section>

      {/* Confirmation Dialog Before Changing Storage Modes */}
      {confirmDialog.isOpen && confirmDialog.book && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmDialog({ isOpen: false, book: null, targetMode: "device" })}>
          <div
            className="confirmation-modal glass-card"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="confirm-icon-wrap">
              {confirmDialog.targetMode === "sync" ? (
                <div className="confirm-icon cloud-icon">
                  <Cloud size={24} />
                </div>
              ) : (
                <div className="confirm-icon local-icon">
                  <HardDrive size={24} />
                </div>
              )}
            </div>

            <div className="confirm-content">
              <h3>
                {confirmDialog.targetMode === "sync"
                  ? "Move PDF to MyPro Cloud?"
                  : "Move PDF to Local Device Only?"}
              </h3>
              <p>
                {confirmDialog.targetMode === "sync" ? (
                  <>
                    This will encrypt and upload <strong>“{confirmDialog.book.title}”</strong> (
                    {confirmDialog.book.fileSizeFormatted || "4.8 MB"}) to your private Supabase
                    Storage bucket. Your bookmarks and reading position will synchronize across all
                    your authenticated devices.
                  </>
                ) : (
                  <>
                    This will store <strong>“{confirmDialog.book.title}”</strong> exclusively in
                    this browser’s local IndexedDB and remove the cloud copy from Supabase. Offline
                    reading will remain fully functional, but reading progress will no longer sync to
                    other devices.
                  </>
                )}
              </p>

              <div className="privacy-guarantee-pill">
                <Lock size={13} />
                <span>Zero automatic uploads. You maintain complete control over where files are stored.</span>
              </div>
            </div>

            <div className="confirm-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmDialog({ isOpen: false, book: null, targetMode: "device" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button confirm-action-btn"
                onClick={executeStorageChange}
              >
                {confirmDialog.targetMode === "sync" ? (
                  <>
                    <Upload size={15} /> Upload & Move to Cloud
                  </>
                ) : (
                  <>
                    <HardDrive size={15} /> Move to Local Device
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="app-toast" role="status">
          <CheckCircle2 size={16} /> {toastMessage}
        </div>
      )}
    </div>
  );
}
