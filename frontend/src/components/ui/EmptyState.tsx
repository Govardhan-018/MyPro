import type { ReactNode } from "react";
import { Pressable } from "./Pressable";

/**
 * EmptyState (UI upgrade §3.8) — never a dead end. Tinted icon + one line +
 * exactly one action (Fogg: every empty state carries a prompt with one
 * action).
 */
export function EmptyState({
  icon,
  tint = "var(--text-2)",
  message,
  actionLabel,
  onAction,
}: {
  icon?: ReactNode;
  tint?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "32px 20px",
        textAlign: "center",
      }}
    >
      {icon ? <div style={{ color: tint, display: "flex" }}>{icon}</div> : null}
      <p className="ds-body" style={{ color: "var(--text-2)", margin: 0, maxWidth: 280 }}>
        {message}
      </p>
      {actionLabel && onAction ? (
        <Pressable
          haptic
          onClick={onAction}
          className="ds-callout"
          style={{
            minHeight: 44,
            padding: "0 18px",
            borderRadius: "var(--r-full)",
            background: "var(--accent)",
            color: "var(--bg)",
            fontWeight: 600,
          }}
        >
          {actionLabel}
        </Pressable>
      ) : null}
    </div>
  );
}
