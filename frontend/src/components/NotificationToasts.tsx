/**
 * Live notification toasts (Roadmap Phase 6.1).
 *
 * These appear the moment a notification row is written by any node — the
 * scheduler on Render, or your laptop agent — over Supabase Realtime. Tapping
 * one marks it read, which the socket echoes to your other devices.
 */
import { Bell, X } from "lucide-react";
import type { NotificationRow } from "@mypro/shared";

export function NotificationToasts({
  toasts,
  onRead,
  onDismiss,
}: {
  toasts: NotificationRow[];
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (!toasts.length) return null;

  return (
    <div className="notification-toasts" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <article className="notification-toast" key={toast.id} role="status">
          <span className="notification-toast-icon">
            <Bell size={15} />
          </span>
          <button
            type="button"
            className="notification-toast-body"
            onClick={() => onRead(toast.id)}
            title="Mark as read"
          >
            <strong>{toast.title}</strong>
            {toast.body && <small>{toast.body}</small>}
          </button>
          <button
            type="button"
            className="notification-toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}
