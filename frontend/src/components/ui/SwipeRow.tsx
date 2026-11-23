import { useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, type PanInfo } from "framer-motion";

export type SwipeAction = {
  icon: ReactNode;
  label: string;
  /** Background colour of the revealed action. Defaults to a neutral surface. */
  color?: string;
  onPress: () => void;
};

/**
 * SwipeRow (UI upgrade §3.10). Swipe left reveals secondary actions (Delete,
 * Edit); swipe right triggers one primary quick action. Rubber-bands past the
 * threshold with a haptic. On desktop the left actions reveal on hover/focus.
 */
export function SwipeRow({
  children,
  leftActions = [],
  rightAction,
  actionWidth = 72,
}: {
  children: ReactNode;
  /** Revealed by swiping the row left. */
  leftActions?: SwipeAction[];
  /** Fired by swiping the row right past threshold. */
  rightAction?: SwipeAction;
  actionWidth?: number;
}) {
  const x = useMotionValue(0);
  const buzzed = useRef(false);
  const leftWidth = leftActions.length * actionWidth;
  const rightWidth = rightAction ? actionWidth : 0;

  const settle = (to: number) =>
    animate(x, to, { type: "spring", stiffness: 400, damping: 36 });

  const onDrag = (_: unknown, info: PanInfo) => {
    const past = Math.abs(info.offset.x) > actionWidth * 0.8;
    if (past && !buzzed.current) {
      navigator.vibrate?.(8);
      buzzed.current = true;
    } else if (!past) {
      buzzed.current = false;
    }
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    buzzed.current = false;
    const ox = info.offset.x;
    if (ox > actionWidth * 0.8 && rightAction) {
      rightAction.onPress();
      settle(0);
    } else if (ox < -actionWidth * 0.5 && leftWidth) {
      settle(-leftWidth);
    } else {
      settle(0);
    }
  };

  return (
    <div
      style={{ position: "relative", overflow: "hidden", borderRadius: "var(--r-md)" }}
      onMouseEnter={() => leftWidth && settle(-leftWidth)}
      onMouseLeave={() => settle(0)}
    >
      {/* Right-swipe primary action, behind the left edge. */}
      {rightAction ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            right: "auto",
            width: actionWidth,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: rightAction.color ?? "var(--accent-soft)",
            color: "var(--accent)",
          }}
          aria-hidden
        >
          {rightAction.icon}
        </div>
      ) : null}

      {/* Left-swipe secondary actions, behind the right edge. */}
      <div style={{ position: "absolute", inset: 0, left: "auto", display: "flex" }}>
        {leftActions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              a.onPress();
              settle(0);
            }}
            aria-label={a.label}
            style={{
              width: actionWidth,
              minHeight: 44,
              border: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              background: a.color ?? "var(--surface-3)",
              color: a.color ? "#fff" : "var(--text-1)",
              cursor: "pointer",
            }}
          >
            {a.icon}
            <span className="ds-caption">{a.label}</span>
          </button>
        ))}
      </div>

      <motion.div
        drag="x"
        style={{ x, position: "relative", background: "var(--surface-1)", touchAction: "pan-y" }}
        dragConstraints={{ left: -leftWidth, right: rightWidth }}
        dragElastic={0.12}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
      >
        {children}
      </motion.div>
    </div>
  );
}
