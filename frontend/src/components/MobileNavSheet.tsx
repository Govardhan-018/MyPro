/**
 * The phone's navigation.
 *
 * Collapsed it is the familiar five-tab bar. Dragged (or tapped) upward it
 * becomes a sheet holding *every* section plus the global controls, so
 * nothing is unreachable on a phone just because the bar only fits five.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ChevronUp, LogOut, Palette, Settings, Sparkles } from "lucide-react";

export interface MobileNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

/** The bar has room for a word, not a title. */
const SHORT_LABELS: Record<string, string> = {
  today: "Today",
  calendar: "Calendar",
  library: "Library",
  knowledge: "Knowledge",
  health: "Health",
  schedules: "Schedules",
  assistant: "Assistant",
  settings: "Settings",
};

/** Past this much upward travel, releasing opens the sheet. */
const OPEN_THRESHOLD = 46;

export function MobileNavSheet({
  items,
  tabIds,
  view,
  onNavigate,
  colorMode,
  onToggleColor,
  unreadCount,
  onOpenNotifications,
  onSignOut,
}: {
  items: MobileNavItem[];
  /** The ids that stay on the collapsed bar, in order. */
  tabIds: string[];
  view: string;
  onNavigate: (id: string) => void;
  colorMode: boolean;
  onToggleColor: () => void;
  unreadCount: number;
  onOpenNotifications: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Live finger offset while dragging; null when the sheet is resting.
  const [drag, setDrag] = useState<number | null>(null);
  const startY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // The sheet is a layer over the page: Escape and route changes dismiss it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  /**
   * Publish the collapsed bar's height as `--mobile-nav-height`.
   *
   * Everything that has to sit clear of this bar — the podcast mini-player,
   * the scroll padding under a page — used to carry its own hard-coded copy
   * of that number, so growing the drag handle by eight pixels silently put
   * the mini-player on top of the nav. Measured once and shared instead.
   * Only the collapsed height is published; the expanded sheet is a layer
   * over the page, not something to reserve room for.
   */
  useEffect(() => {
    const node = sheetRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      if (open) return;
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty("--mobile-nav-height", `${height}px`);
      }
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    setDrag(0);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    const delta = startY.current - e.clientY; // up is positive
    setDrag(open ? Math.min(0, delta) : Math.max(0, delta));
  };

  const onPointerUp = () => {
    if (drag === null) return;
    if (!open && drag > OPEN_THRESHOLD) setOpen(true);
    else if (open && drag < -OPEN_THRESHOLD) setOpen(false);
    setDrag(null);
  };

  const go = (id: string) => {
    onNavigate(id);
    close();
  };

  /**
   * While dragging the sheet tracks the finger; otherwise CSS animates it.
   *
   * The closed branch used to start at `OPEN_THRESHOLD * 2 - drag`, so the
   * instant a finger landed on the grabber the whole bar jumped 92px *down*
   * off the bottom of the screen, and the first 92px of an upward drag only
   * undid that. Up is up in both states now; closed it lifts a little, which
   * is the hint that there is more above.
   */
  const style =
    drag === null
      ? undefined
      : {
          transform: `translateY(${
            open ? -drag : -Math.min(drag, OPEN_THRESHOLD) * 0.5
          }px)`,
        };

  return (
    <>
      {open && <div className="mobile-nav-backdrop" onClick={close} aria-hidden="true" />}
      <nav
        className={`bottom-nav ${open ? "expanded" : ""} ${drag !== null ? "dragging" : ""}`}
        ref={sheetRef}
        style={style}
      >
        <button
          type="button"
          className="mobile-nav-grabber"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close navigation" : "More sections"}
        >
          <i aria-hidden="true" />
          <ChevronUp size={13} className={open ? "flipped" : ""} />
        </button>

        <div className="mobile-nav-tabs">
          {tabIds.map((id) => {
            const item = items.find((navItem) => navItem.id === id);
            if (!item) return null;
            const Icon = item.icon;
            return id === "assistant" ? (
              <button
                key={id}
                className={`assistant-tab ${view === id ? "active" : ""}`}
                onClick={() => go(id)}
                aria-label="AI Assistant"
              >
                <span>
                  <Sparkles size={20} />
                </span>
              </button>
            ) : (
              <button
                key={id}
                className={view === id ? "active" : ""}
                onClick={() => go(id)}
                aria-current={view === id ? "page" : undefined}
              >
                <Icon size={20} />
                <span>{SHORT_LABELS[id] ?? item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mobile-nav-drawer">
          <div className="mobile-nav-drawer-scroll">
            <span className="mobile-nav-kicker">GO TO</span>
            <div className="mobile-nav-grid">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`mobile-nav-card ${view === item.id ? "active" : ""}`}
                    onClick={() => go(item.id)}
                    aria-current={view === item.id ? "page" : undefined}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <span className="mobile-nav-kicker">QUICK</span>
            <div className="mobile-nav-actions">
              <button
                onClick={() => {
                  onOpenNotifications();
                  close();
                }}
              >
                <Bell size={16} />
                <span>Notifications</span>
                {unreadCount > 0 && <kbd>{unreadCount}</kbd>}
              </button>
              <button onClick={() => go("settings")}>
                <Settings size={16} />
                <span>Settings</span>
              </button>
              <button onClick={onToggleColor} aria-pressed={colorMode}>
                <Palette size={16} />
                <span>Color Mode</span>
                <i className={colorMode ? "on" : ""} />
              </button>
              <button
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
