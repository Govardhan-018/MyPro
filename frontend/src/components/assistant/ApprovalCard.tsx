/**
 * One request waiting for your approval — for an email, the actual email:
 * who it goes to, the subject and the full text, editable before it is sent.
 *
 * Nothing is sent until you press Send. If sending fails for certain (the
 * mailbox needs reconnecting, Gmail refused it), the request stays here with
 * the reason so you can fix it and press Send again; if it may have gone out
 * (a timeout), the card says to check your Sent folder rather than resend.
 */
import { useState } from "react";
import { Check, Mail, Pencil, Send, X } from "lucide-react";
import type { PendingActionRow } from "@mypro/shared";
import { Loading } from "../ui";

export type ApprovalOutcome = { ok: boolean; executed: boolean; reason?: string; retry?: boolean };

interface Props {
  item: PendingActionRow;
  onApprove: (
    id: string,
    edits?: { to?: string; subject?: string; body?: string },
  ) => Promise<ApprovalOutcome>;
  onReject: (id: string) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function ApprovalCard({ item, onApprove, onReject }: Props) {
  const isEmail = item.skill === "send_email";
  const original = { to: str(item.args.to), subject: str(item.args.subject), body: str(item.args.body) };
  const [draft, setDraft] = useState(original);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "failed" | "discarding">("idle");
  const [message, setMessage] = useState<string | null>(item.result ?? null);

  const invalid = isEmail
    ? !EMAIL_RE.test(draft.to.trim())
      ? "Enter a valid email address."
      : !draft.subject.trim()
        ? "The subject is empty."
        : !draft.body.trim()
          ? "The email has no text."
          : null
    : null;
  const changed =
    draft.to !== original.to || draft.subject !== original.subject || draft.body !== original.body;

  const approve = async () => {
    if (invalid || phase === "sending") return;
    setPhase("sending");
    setMessage(null);
    try {
      const outcome = await onApprove(
        item.id,
        isEmail && changed
          ? { to: draft.to.trim(), subject: draft.subject.trim(), body: draft.body.trim() }
          : undefined,
      );
      if (outcome.ok) {
        setPhase("sent");
        setMessage(outcome.reason ?? (isEmail ? "Sent." : "Approved."));
      } else {
        setPhase("failed");
        setMessage(outcome.reason ?? "It was not sent.");
      }
    } catch (error) {
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "It was not sent.");
    }
  };

  const discard = async () => {
    setPhase("discarding");
    await onReject(item.id).catch(() => undefined);
  };

  const busy = phase === "sending" || phase === "discarding";
  const done = phase === "sent";

  return (
    <article className={`approval-card ${done ? "done" : ""} ${phase === "failed" ? "failed" : ""}`}>
      <header className="approval-card-head">
        <span className="approval-card-kind">
          {isEmail ? <Mail size={14} /> : <Check size={14} />}
          {isEmail ? "Email waiting for approval" : "Waiting for approval"}
        </span>
        {isEmail && !done && !editing && (
          <button type="button" className="approval-link" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </header>

      {isEmail ? (
        editing ? (
          <div className="approval-edit">
            <label>
              <span>To</span>
              <input
                type="email"
                inputMode="email"
                autoCapitalize="off"
                spellCheck={false}
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </label>
            <label>
              <span>Subject</span>
              <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
            </label>
            <label>
              <span>Text</span>
              <textarea
                rows={8}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              />
            </label>
            <div className="approval-edit-actions">
              <button
                type="button"
                className="approval-link"
                onClick={() => {
                  setDraft(original);
                  setEditing(false);
                }}
              >
                Undo changes
              </button>
              <button type="button" className="approval-link" onClick={() => setEditing(false)} disabled={!!invalid}>
                Done editing
              </button>
            </div>
          </div>
        ) : (
          <dl className="approval-email">
            <div>
              <dt>To</dt>
              <dd>{draft.to || "—"}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{draft.subject || "—"}</dd>
            </div>
            <div className="approval-email-body">
              <dt>Text</dt>
              <dd className={expanded ? "" : "clamped"}>{draft.body || "—"}</dd>
              {draft.body.length > 280 && (
                <button type="button" className="approval-link" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show less" : "Show full email"}
                </button>
              )}
            </div>
          </dl>
        )
      ) : (
        <p className="approval-summary">{item.summary || item.skill}</p>
      )}

      {invalid && editing && <p className="approval-message error">{invalid}</p>}
      {message && (
        <p className={`approval-message ${done ? "ok" : phase === "failed" || item.result ? "error" : ""}`} role="status">
          {message}
        </p>
      )}

      {!done && (
        <div className="approval-actions">
          <button type="button" className="approval-reject" onClick={() => void discard()} disabled={busy}>
            <X size={15} /> {phase === "discarding" ? "Discarding…" : "Discard"}
          </button>
          <button
            type="button"
            className="approval-approve"
            onClick={() => void approve()}
            disabled={busy || !!invalid || editing}
          >
            {phase === "sending" ? <Loading variant="inline" size={15} /> : isEmail ? <Send size={15} /> : <Check size={15} />}
            {phase === "sending"
              ? "Sending…"
              : isEmail
                ? phase === "failed" || item.result
                  ? "Try again"
                  : "Send"
                : "Approve"}
          </button>
        </div>
      )}
    </article>
  );
}
