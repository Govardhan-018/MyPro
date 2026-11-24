/**
 * One quiet line about reading sync — shown only when there is something to
 * say: offline (changes are safe on this device), changes waiting, syncing,
 * or a change the server refused. Silent when everything is up to date.
 */
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { outbox, type OutboxStatus } from "../../lib/outbox";

export function SyncStatus({ showingSaved }: { showingSaved?: boolean }) {
  const [status, setStatus] = useState<OutboxStatus>(() => outbox.status());
  useEffect(() => outbox.subscribe(setStatus), []);

  const changes = `${status.pending} ${status.pending === 1 ? "change" : "changes"}`;
  if (!status.online || showingSaved) {
    return (
      <div className="data-banner sync-status offline" role="status">
        <CloudOff size={15} />
        <span>
          You’re offline{showingSaved ? " — showing your library as saved on this device" : ""}.
          Downloaded books open normally
          {status.pending ? `; ${changes} will sync when you’re back` : "; progress syncs when you’re back"}.
        </span>
      </div>
    );
  }
  if (status.rejected > 0) {
    return (
      <div className="data-banner data-banner-error sync-status" role="alert">
        <TriangleAlert size={15} />
        <span>
          {status.rejected === 1 ? "A change" : `${status.rejected} changes`} couldn’t be saved — the server
          refused {status.rejected === 1 ? "it" : "them"}.
        </span>
      </div>
    );
  }
  if (status.syncing || status.pending) {
    return (
      <div className="data-banner sync-status" role="status">
        <RefreshCw size={15} className={status.syncing ? "spin" : ""} />
        <span>
          {status.syncing ? `Syncing ${changes}…` : `${changes} waiting to sync`}
          {status.lastError && !status.syncing ? " — will retry automatically." : ""}
        </span>
        {!status.syncing && (
          <button type="button" className="sched-link" onClick={() => void outbox.flush()}>
            Sync now
          </button>
        )}
      </div>
    );
  }
  return null;
}
