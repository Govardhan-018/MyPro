import { Check, Clock3, Minus, X } from "lucide-react";
import type { AgentTurnSummary } from "@mypro/shared";

/**
 * What the agent set out to do this turn, and what the receipts say happened.
 *
 * This is the visible half of verification. The agent reconciles every planned
 * step against `skill_invocations` before it writes its reply; without this
 * card you only have its word for the result. With it, "I added them to your
 * calendar" has a checkmark next to it that came from the database, and a step
 * it quietly failed to do is visible instead of absent.
 *
 * It renders nothing for a turn with no plan — most turns do not need one.
 */

type Step = AgentTurnSummary["plan"] extends { steps: (infer S)[] } | null ? S : never;

function tone(status: Step["status"]): "ok" | "bad" | "wait" | "idle" {
  switch (status) {
    case "verified":
      return "ok";
    case "failed":
      return "bad";
    case "queued":
      return "wait";
    default:
      return "idle";
  }
}

function glyph(status: Step["status"]) {
  switch (status) {
    case "verified":
      return <Check size={12} />;
    case "failed":
      return <X size={12} />;
    case "queued":
      return <Clock3 size={12} />;
    default:
      return <Minus size={12} />;
  }
}

function label(status: Step["status"]): string {
  switch (status) {
    case "verified":
      return "done";
    case "failed":
      return "failed";
    case "queued":
      return "waiting on you";
    case "not_attempted":
      return "not done";
    default:
      return "pending";
  }
}

export function AgentPlanCard({ agent }: { agent?: AgentTurnSummary }) {
  const plan = agent?.plan;
  if (!plan || !plan.steps.length) return null;

  const done = plan.steps.filter((s) => s.status === "verified").length;
  const incomplete = plan.steps.some(
    (s) => s.status === "failed" || s.status === "not_attempted",
  );

  return (
    <details className={`agent-plan${incomplete ? " is-incomplete" : ""}`} open={incomplete}>
      <summary className="agent-plan-summary">
        <span className="agent-plan-count">
          {done}/{plan.steps.length}
        </span>
        <span className="agent-plan-intent">{plan.intent}</span>
        {agent?.mode && agent.mode !== "default" && (
          <span className="agent-plan-mode">{agent.mode}</span>
        )}
      </summary>
      <ol className="agent-plan-steps">
        {plan.steps.map((step) => (
          <li key={step.id} className={`agent-step agent-step-${tone(step.status)}`}>
            <span className="agent-step-icon">{glyph(step.status)}</span>
            <span className="agent-step-goal">{step.goal}</span>
            <span className="agent-step-status">{label(step.status)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
