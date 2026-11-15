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

  // While dragging the sheet tracks the finger; otherwise CSS animates it.
  const style =
    drag === null
      ? undefined
      : { transform: `translateY(${open ? -drag : Math.max(0, OPEN_THRESHOLD * 2 - drag)}px)` };

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
