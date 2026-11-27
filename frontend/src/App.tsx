import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LottieHandle } from "lottie-react";
import {
  AlarmClock,
  Archive,
  ArrowLeft,
  Bell,
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  HelpCircle,
  Highlighter,
  Quote,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardList,
  Ellipsis,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  GripVertical,
  Headphones,
  HeartPulse,
  Home,
  Library,
  LogOut,
  Mail,
  Palette,
  Pencil,
  Pill,
  Play,
  Plus,
  Search,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  StickyNote,
  Stethoscope,
  Thermometer,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import type {
  LibraryItem,
  BookmarkItem,
  NoteItem,
  HighlightItem,
  Annotation,
} from "./types/library";
import { MyProDarkReader } from "./components/library/MyProDarkReader";
import { MyProPodcastPlayer } from "./components/library/MyProPodcastPlayer";
import { ArticleReaderModal } from "./components/library/ArticleReaderModal";
import { BookOptionsModal } from "./components/library/BookOptionsModal";
import { StorageSyncView } from "./components/settings/StorageSyncView";
import { SchedulesView } from "./components/schedules/SchedulesView";
import { CommitmentsView } from "./components/commitments/CommitmentsView";
import { NotificationToasts } from "./components/NotificationToasts";
import { characterInitial } from "./components/assistant/CharacterPanel";
import { Markdown } from "./components/assistant/Markdown";
import { ApprovalCard, type ApprovalOutcome } from "./components/assistant/ApprovalCard";
import { AgentPlanCard } from "./components/assistant/AgentPlanCard";
import { CapabilityReadout } from "./components/assistant/CapabilityReadout";
import { WatchingPanel } from "./components/assistant/WatchingPanel";
import { ResultBlocks } from "./components/assistant/ResultBlocks";
import { MobileNavSheet } from "./components/MobileNavSheet";
import { useCollections } from "./lib/useCollections";
import { isApiConfigured } from "./lib/env";
import { storePdfLocally } from "./utils/pdfStorage";
import { extractVideoId, fetchYouTubeMeta } from "./lib/youtube";
import { readPageCount } from "./lib/pdfEngine";
import {
  AgentOfflineError,
  api,
  forgetAgentBase,
  gmailScopesGrantSend,
  NOTIFICATION_VIEW_NAMES,
  type AgentTurnSummary,
  type DisplayBlock,
  type AssistantSettingsRow,
  type EffortMode,
  type GmailAccessLevel,
  type PendingActionRow,
  type ReceiptRow,
} from "./lib/api";
import { signInWithPassword, signOut, signUpWithPassword } from "./lib/supabase";
import { useSession } from "./lib/useSession";
import { useActivityHeartbeat } from "./lib/useActivityHeartbeat";
import { useLibrary } from "./lib/useLibrary";
import { useNotifications, type NotificationsState } from "./lib/useNotifications";
import { releasePushOnSignOut, usePush, type PushStatus } from "./lib/usePush";
import { useShellNotifications } from "./lib/useShellNotifications";
import { inShell } from "./lib/shell";
import { Loading } from "./components/ui";
import { isGmailReturn, useGmail } from "./lib/useGmail";
import { browserTimezone, useProfile, type ProfileState } from "./lib/useProfile";
import { annotationRowToUi, bookmarkRowToUi, useReaderSync } from "./lib/readerSync";
import { readReaderCache, writeReaderCache } from "./lib/readerCache";
import { outbox } from "./lib/outbox";
import { useOfflineBooks } from "./lib/offlineBooks";
import { SyncStatus } from "./components/library/SyncStatus";
import {
  entrySource,
  useKnowledge,
  type KnowledgeEntry,
  type KnowledgeKind,
} from "./lib/useKnowledge";
import {
  UNSORTED_KEY,
  groupKnowledge,
  searchGroups,
  sortGroups,
  type GroupSort,
  type KnowledgeGroup,
  type SourceType,
} from "./lib/knowledgeGroups";
import {
  useHealth,
  type IllnessDocument,
  type IllnessMedication,
  type IllnessRecord,
} from "./lib/useHealth";
import {
  useCalendar,
  groupByDate,
  isoDate,
  startOfWeek,
  weekdayLabel,
  positionOf,
  eventMeta,
  timeLabel,
  durationLabel,
  nowOffset,
  dateKeyOf,
  timeInputValue,
  eventActionState,
  eventPhaseOf,
  describeEventTime,
  HOUR_LABELS,
  GRID_HEIGHT,
  DEFAULT_SCROLL_TOP,
  type CalEvent,
  type NewEventInput,
} from "./lib/useCalendar";

type View =
  | "today"
  | "calendar"
  | "library"
  | "knowledge"
  | "health"
  | "commitments"
  | "schedules"
  | "assistant"
  | "settings";

const VIEWS: View[] = [
  "today",
  "calendar",
  "library",
  "knowledge",
  "health",
  "commitments",
  "schedules",
  "assistant",
];

/**
 * The section to open on load, taken from the address bar.
 *
 * Without this a refresh always landed back on Today, which is its own small
 * betrayal halfway through reading a record. The hash is the whole store:
 * nothing to keep in sync, and the address is shareable.
 *
 * Settings is deliberately not restorable — it is a place you visit, not a
 * place you live, and coming back to it after a reload is never what was
 * wanted.
 */
function viewFromHash(): View {
  if (typeof window === "undefined") return "today";
  // The hash may carry a focus query (e.g. `#calendar?event=…`), so match only
  // the part before `?`.
  const raw = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (VIEWS as string[]).includes(raw) ? (raw as View) : "today";
}

/**
 * A deep link's focus — the specific thing a notification tap wants open, not
 * just the section. Today only Calendar uses it (open this event, on its day),
 * but the shape is general. `token` changes on every parse so the same event
 * tapped twice still re-triggers the effect that opens it.
 */
export interface DeepLinkFocus {
  event?: string;
  at?: string;
  token: number;
}

function focusFromHash(token: number): DeepLinkFocus {
  if (typeof window === "undefined") return { token };
  const query = window.location.hash.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  return {
    event: params.get("event") ?? undefined,
    at: params.get("at") ?? undefined,
    token,
  };
}

/**
 * Deeplinks a notification is allowed to open. Narrow on purpose: the string
 * arrives from a push payload, and a bare whitelist is the whole validation.
 * The list lives in `@mypro/shared` so the web and the native shell validate
 * against exactly the same set.
 */
const NOTIFICATION_VIEWS = NOTIFICATION_VIEW_NAMES as readonly View[];

// Lottie is large; load it in its own chunk so the first screen renders immediately.
const LottieSvg = lazy(() =>
  import("lottie-react").then((module) => ({ default: module.LottieSvg })),
);

/** Resolves public assets against Vite's base URL so sub-path deployments work. */
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

/**
 * The identity of a library item, for React keys and for `updateItem`.
 * Saved rows have an id; prototype/local ones only have a title.
 */
const itemKey = (item: LibraryItem): string => item.id ?? item.title;

const PROTOTYPE_LATENCY_MS = 900;

/**
 * Stand-in for a backend call. Pending timers are cleared on unmount so no
 * state updates run after a view closes. Replace with real requests later.
 */
function useSimulatedRequest() {
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return useCallback(
    (duration = PROTOTYPE_LATENCY_MS) =>
      new Promise<void>((resolve) => {
        timers.current.push(window.setTimeout(resolve, duration));
      }),
    [],
  );
}

function Spinner() {
  return <Loading variant="inline" size={16} />;
}

/** Colour Mode is the default experience; this remembers a per-device opt-out. */
const COLOR_PREF_KEY = "mypro.colorMode";
function readColorPref(): boolean {
  try {
    const stored = localStorage.getItem(COLOR_PREF_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "library", label: "My Library", icon: Library },
  { id: "knowledge", label: "My Knowledge", icon: Brain },
  { id: "health", label: "Health Records", icon: HeartPulse },
  { id: "commitments", label: "Commitments", icon: ClipboardList },
  { id: "schedules", label: "Schedules", icon: AlarmClock },
  { id: "assistant", label: "AI Assistant", icon: Sparkles },
];

function Brand({ compact = false, colorMode = false }: { compact?: boolean; colorMode?: boolean }) {
  return (
    <div
      className={`brand ${compact ? "brand-compact" : ""} ${colorMode ? "brand-color-active" : ""}`}
    >
      <img className="brand-logo-mono" src={asset("mypro-logo-light.png")} alt="MyPro" />
      <img
        className="brand-logo-color"
        src={asset("mypro-logo-color.png")}
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}

function IconButton({
  children,
  label,
  className = "",
  onClick,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Welcome({
  onEnter,
  colorMode,
  onToggleColor,
  notice,
}: {
  onEnter: () => void;
  colorMode: boolean;
  onToggleColor: () => void;
  /** Why the user is here, e.g. their session expired. Shown until they act. */
  notice?: string;
}) {
  const [accountMode, setAccountMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [feedback, setFeedback] = useState(notice ?? "");
  // A notice that arrives while the page is already open (another tab's
  // session expiring) replaces whatever idle text was there.
  useEffect(() => {
    if (notice) setFeedback(notice);
  }, [notice]);
  const request = useSimulatedRequest();

  // Entrance plays once: the logo settles on first paint, and the copy and card
  // follow the cubes once their animation is built (or after a short fallback),
  // so the heavy Lottie setup never freezes elements mid-motion.
  const mainRef = useRef<HTMLElement>(null);
  const [contentPending, setContentPending] = useState(() => !prefersReducedMotion());
  const [ambient, setAmbient] = useState(false);
  const revealContent = useCallback(() => setContentPending(false), []);
  useLayoutEffect(() => {
    if (!mainRef.current) return;
    const animations = runLoginEntrance(mainRef.current, "top");
    return () => animations.forEach((animation) => animation.cancel());
  }, []);
  useEffect(() => {
    const fallback = window.setTimeout(revealContent, 1200);
    return () => window.clearTimeout(fallback);
  }, [revealContent]);
  const contentStarted = useRef(false);
  useLayoutEffect(() => {
    if (contentPending || contentStarted.current || !mainRef.current) return;
    contentStarted.current = true;
    const animations = runLoginEntrance(mainRef.current, "content");
    const settle = prefersReducedMotion()
      ? undefined
      : window.setTimeout(() => setAmbient(true), 2200);
    return () => {
      window.clearTimeout(settle);
      animations.forEach((animation) => animation.cancel());
    };
  }, [contentPending]);

  // Real auth (via Render) when the backend is configured; otherwise the
  // original local-only prototype flow, so the design stays demoable.
  const configured = isApiConfigured;
  const minPassword = configured ? 6 : 4;

  const runPrototype = async (provider: string) => {
    setFeedback(`Connecting with ${provider}…`);
    setAuthState("loading");
    await request();
    setAuthState("success");
    setFeedback("Welcome back. Opening your MyPro space…");
    await request(700);
    onEnter();
  };

  const submitEmail = async () => {
    // Enter in the password field bypasses the button's disabled state; one
    // sign-in at a time, or two sessions race to be the stored one.
    if (authState === "loading") return;
    if (!email.includes("@") || password.length < minPassword) {
      setAuthState("error");
      setFeedback(`Enter a valid email and a password with at least ${minPassword} characters.`);
      return;
    }
    if (!configured) {
      return runPrototype(accountMode === "signup" ? "your new account" : "email");
    }
    setAuthState("loading");
    setFeedback(accountMode === "signup" ? "Creating your account…" : "Signing you in…");
    try {
      if (accountMode === "signup") {
        const session = await signUpWithPassword(email, password);
        if (!session) {
          // Email confirmation is on: no session yet.
          setAuthState("success");
          setFeedback("Check your email to confirm your account, then sign in.");
          return;
        }
      } else {
        await signInWithPassword(email, password);
      }
      setAuthState("success");
      setFeedback("Welcome. Opening your MyPro space…");
      // The auth listener in App swaps in the shell once the session lands.
    } catch (error) {
      setAuthState("error");
      setFeedback(error instanceof Error ? error.message : "Authentication failed.");
    }
  };

  const openAccountMode = (mode: "signin" | "signup") => {
    setAccountMode(mode);
    setAuthState("idle");
    setFeedback("");
  };

  return (
    <main
      ref={mainRef}
      className={`welcome login-welcome ${colorMode ? "color-mode" : ""} ${
        contentPending ? "intro-pending" : ""
      }`}
    >
      <header className="login-topbar">
        <Brand colorMode={colorMode} />
        <button
          className={`welcome-color-toggle ${colorMode ? "active" : ""}`}
          onClick={onToggleColor}
          aria-pressed={colorMode}
        >
          <Palette size={16} />
          <span>Color Mode</span>
          <i />
        </button>
      </header>

      <section className="login-layout">
        <div className="login-introduction">
          <div className={`login-animation ${ambient ? "ambient" : ""}`} aria-hidden="true">
            <RollingCubes intro onReady={revealContent} />
          </div>
          <div className="eyebrow">ONE INTELLIGENT SPACE</div>
          <h1>Welcome to MyPro</h1>
          <p>One intelligent space for your time, knowledge, and health.</p>
          <div className="login-pillars">
            {[
              [CalendarDays, "Calendar", "Organize your time."],
              [Library, "Library", "Keep your knowledge."],
              [HeartPulse, "Health", "Remember your history."],
            ].map(([Icon, title, subtitle], index) => (
              <div key={String(title)}>
                <span className={`pillar-icon pillar-icon-${index + 1}`}>
                  <Icon size={16} />
                </span>
                <p>
                  <strong>{String(title)}</strong>
                  <small>{String(subtitle)}</small>
                </p>
              </div>
            ))}
          </div>
        </div>

        <aside className="login-panel">
          <div className="login-panel-heading">
            <span className="section-kicker">MYPRO ACCOUNT</span>
            <h2>{accountMode === "signup" ? "Create your account." : "Welcome back."}</h2>
            <p>
              {accountMode === "signup"
                ? configured
                  ? "Create your account to enter MyPro."
                  : "Create a prototype account to enter MyPro."
                : "Sign in to continue with MyPro."}
            </p>
          </div>

          <div className={`auth-feedback auth-feedback-${authState}`} aria-live="polite">
            {authState === "loading" && <Loading variant="inline" size={16} />}
            {authState === "success" && <CheckCircle2 size={15} />}
            {authState === "error" && <span>!</span>}
            {feedback && <p>{feedback}</p>}
          </div>

          <div className={`email-auth-form ${authState === "error" ? "login-shake" : ""}`}>
              <label>
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
              <label>
                <span>Password</span>
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitEmail();
                    }}
                    placeholder="Enter your password"
                    autoComplete={accountMode === "signup" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              {accountMode === "signin" && (
                <button
                  className="forgot-password"
                  onClick={() => {
                    setAuthState("idle");
                    setFeedback(
                      email
                        ? `Prototype reset instructions prepared for ${email}.`
                        : "Enter your email first, then choose Forgot password.",
                    );
                  }}
                >
                  Forgot password?
                </button>
              )}
              <button
                className="email-signin-button"
                onClick={submitEmail}
                disabled={authState === "loading"}
              >
                {authState === "loading"
                  ? "Please wait…"
                  : accountMode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </div>

          <div className="account-switch">
            {accountMode === "signup" ? (
              <>
                Already have an account?{" "}
                <button onClick={() => openAccountMode("signin")}>Sign in</button>
              </>
            ) : (
              <>
                New to MyPro?{" "}
                <button onClick={() => openAccountMode("signup")}>Create an account</button>
              </>
            )}
          </div>
          <p className="legal">
            By continuing, you agree to the <a href="#terms">Terms of Service</a> and{" "}
            <a href="#privacy">Privacy Policy</a>.
          </p>
          {!configured && (
            <p className="prototype-note">
              Authentication interactions are shown as a design prototype.
            </p>
          )}
        </aside>
      </section>
      <footer className="login-footer">
        <span>MyPro</span>
        <p>Time · Knowledge · Health</p>
      </footer>
    </main>
  );
}

function TodayView({
  navigate,
  items,
  onOpenMedia,
}: {
  navigate: (v: View) => void;
  items: LibraryItem[];
  onOpenMedia: (item: LibraryItem) => void;
}) {
  const now = new Date();
  const { events: calEvents } = useCalendar(now);
  const todaysEvents = (groupByDate(calEvents).get(isoDate(now)) ?? []).filter((e) => !e.allDay);
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  const inProgress =
    items.find((i) => i.progress > 0 && i.progress < 100) ??
    items.find((i) => i.status === "In Progress");
  return (
    <div className="page-content dashboard-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">
            {now
              .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
              .toUpperCase()}
          </div>
          <h1>{greeting}</h1>
        </div>
      </header>

      <section className="day-grid">
        <div className="glass-card agenda-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">TODAY’S FLOW</span>
              <h2>Your day at a glance</h2>
            </div>
            <button className="text-button" onClick={() => navigate("calendar")}>
              Open calendar <ChevronRight size={15} />
            </button>
          </div>
          <div className="agenda-list">
            {todaysEvents.length === 0 ? (
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px", padding: "8px 2px" }}>
                Nothing scheduled today. Enjoy the open day.
              </p>
            ) : (
              todaysEvents.map((event) => (
                <div className="agenda-row" key={event.id}>
                  <div className="agenda-time">
                    <strong>{timeLabel(event.startsAt)}</strong>
                    <span>{durationLabel(event)}</span>
                  </div>
                  <div className={`agenda-event event-${event.tone}`}>
                    <div>
                      <strong>{event.title}</strong>
                      <span>{event.location || "Event"}</span>
                    </div>
                    <Ellipsis size={18} />
                  </div>
                </div>
              ))
            )}
          </div>
          {todaysEvents.length > 0 && (
            <div className="free-time">
              <Clock3 size={15} /> {todaysEvents.length}{" "}
              {todaysEvents.length === 1 ? "event" : "events"} scheduled today
            </div>
          )}
        </div>

        <div className="glass-card focus-card">
          <div className="orb orb-small">
            <div className="orb-core">
              <Sparkles size={18} />
            </div>
          </div>
          <span className="section-kicker">MYPRO INSIGHT</span>
          <h2>Plan your day with me.</h2>
          <p>Schedule, reading and reminders.</p>
          <button onClick={() => navigate("assistant")}>
            Plan it with me <ArrowRight size={15} />
          </button>
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="glass-card library-peek">
          <div className="card-heading compact">
            <div>
              <span className="section-kicker">LIBRARY</span>
              <h2>Continue learning</h2>
            </div>
            <button className="text-button" onClick={() => navigate("library")}>
              View all
            </button>
          </div>
          {inProgress ? (
            <div
              className="book-row"
              onClick={() => onOpenMedia(inProgress)}
              style={{ cursor: "pointer" }}
            >
              <div className="book-cover">
                {inProgress.image ? (
                  <img
                    src={inProgress.image}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                  />
                ) : (
                  <strong>{inProgress.title.slice(0, 14)}</strong>
                )}
              </div>
              <div className="book-info">
                <span className="soft-label">{inProgress.type.toUpperCase()}</span>
                <h3>{inProgress.title}</h3>
                <p>{inProgress.creator || "In your library"}</p>
                <div className="progress">
                  <i style={{ width: `${inProgress.progress}%` }} />
                </div>
                <small>{inProgress.progress}% completed</small>
              </div>
            </div>
          ) : (
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px", padding: "6px 2px" }}>
              Nothing in progress yet.{" "}
              <button className="text-button" onClick={() => navigate("library")}>
                Add to your library
              </button>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function CalendarView({ focus }: { focus?: DeepLinkFocus }) {
  const [mode, setMode] = useState<"Day" | "Week" | "Month">("Week");
  const [refDate, setRefDate] = useState(() => new Date());
  // The hook reloads whenever you page into another month.
  const { events, loading, error, createEvent, updateEvent, deleteEvent, completeEvent, uncompleteEvent } =
    useCalendar(refDate);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<NewEventInput>({
    title: "",
    date: isoDate(new Date()),
    startTime: "",
    endTime: "",
    allDay: false,
    location: "",
  });

  const today = new Date();
  const todayIso = isoDate(today);
  const eventsByDate = useMemo(() => groupByDate(events), [events]);

  const weekStart = startOfWeek(refDate);
  // Saturday and Sunday used to be missing entirely, so weekend events were
  // invisible in this view even though the data was loaded.
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return { date, iso: isoDate(date), num: date.getDate() };
  });

  const shift = (dir: 1 | -1) =>
    setRefDate((d) => {
      const next = new Date(d);
      if (mode === "Month") next.setMonth(next.getMonth() + dir);
      else if (mode === "Week") next.setDate(next.getDate() + 7 * dir);
      else next.setDate(next.getDate() + dir);
      return next;
    });

  const title =
    mode === "Day"
      ? refDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
      : mode === "Week"
        ? `${weekDays[0].date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].date.toLocaleDateString(undefined, { day: "numeric" })}`
        : refDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const setField = <K extends keyof NewEventInput>(key: K, value: NewEventInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const openQuickAdd = () => {
    setEditingId(null);
    setForm({ title: "", date: isoDate(refDate), startTime: "", endTime: "", allDay: false, location: "" });
    setFormError(null);
    setShowModal(true);
  };
  /** Clicking an event opens the same sheet, filled in, with a delete. */
  const openEdit = (ev: CalEvent) => {
    setEditingId(ev.id);
    setForm({
      title: ev.title,
      date: dateKeyOf(ev),
      startTime: ev.allDay ? "" : timeInputValue(ev.startsAt),
      endTime: ev.allDay ? "" : timeInputValue(ev.endsAt),
      allDay: ev.allDay,
      location: ev.location ?? "",
    });
    setFormError(null);
    setShowModal(true);
  };
  const closeModal = () => {
    if (saving || deleting) return;
    setShowModal(false);
    setEditingId(null);
  };
  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) await updateEvent(editingId, form);
      else await createEvent(form);
      setShowModal(false);
      setEditingId(null);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not save the event.");
    } finally {
      setSaving(false);
    }
  };
  const removeEvent = async () => {
    if (!editingId) return;
    setDeleting(true);
    setFormError(null);
    try {
      await deleteEvent(editingId);
      setShowModal(false);
      setEditingId(null);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not delete the event.");
    } finally {
      setDeleting(false);
    }
  };

  // --- Deep link: open the event a notification was tapped on -----------------
  // A calendar reminder's tap arrives as a focus ({ event, at }). Jump to that
  // event's day (so useCalendar loads the month around it), then open its sheet
  // once the data has settled — the "go to the proper place" behaviour.
  const focusHandledToken = useRef(-1);
  const [pendingFocusEvent, setPendingFocusEvent] = useState<string | null>(null);
  useEffect(() => {
    if (!focus?.event || focus.token === focusHandledToken.current) return;
    focusHandledToken.current = focus.token;
    const when = focus.at ? new Date(focus.at) : null;
    if (when && !Number.isNaN(when.getTime())) {
      setRefDate(when);
      setMode("Day");
    }
    setPendingFocusEvent(focus.event);
  }, [focus]);
  useEffect(() => {
    if (!pendingFocusEvent || loading) return;
    const match = events.find((e) => e.id === pendingFocusEvent);
    if (match) openEdit(match);
    // Found or not, stop after the first settled load so a deleted event does
    // not keep the sheet trying to open forever.
    setPendingFocusEvent(null);
  }, [events, loading, pendingFocusEvent]);

  // --- Completion ("Done") and the time-based lock on editing ----------------
  // The event being edited, and what may be done to it right now. An event is
  // editable only before it starts; it may be marked done once it has started,
  // for a 12-hour window. The backend enforces both — this just shapes the UI.
  const [completing, setCompleting] = useState(false);
  // The modal's notion of "now" ticks while it is open, so an event that starts
  // while you are looking at it switches to its started state on its own.
  const [modalNow, setModalNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showModal) return;
    setModalNow(Date.now());
    const timer = window.setInterval(() => setModalNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [showModal]);
  const editingEvent = editingId ? events.find((e) => e.id === editingId) ?? null : null;
  const actionState = editingEvent ? eventActionState(editingEvent, modalNow) : null;
  /**
   * Read-only whenever the server would refuse an edit: the event has started
   * or is done. It used to render the full form with greyed-out inputs next to
   * "can no longer be edited", which read as a broken editor.
   */
  const lockedForEdit =
    Boolean(editingId) && actionState !== null && (!actionState.editable || actionState.completed);
  const eventPhase = editingEvent ? eventPhaseOf(editingEvent, modalNow) : null;

  const markDone = async () => {
    if (!editingId) return;
    setCompleting(true);
    setFormError(null);
    try {
      await completeEvent(editingId);
      setShowModal(false);
      setEditingId(null);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not mark this done.");
    } finally {
      setCompleting(false);
    }
  };

  const unmarkDone = async () => {
    if (!editingId) return;
    setCompleting(true);
    setFormError(null);
    try {
      await uncompleteEvent(editingId);
      setShowModal(false);
      setEditingId(null);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not update this event.");
    } finally {
      setCompleting(false);
    }
  };

  // --- Event form validation (no past dates/times; end after start) ---------
  // ISO yyyy-mm-dd and HH:MM strings compare correctly with `<`, so no Date math
  // is needed. Past restrictions apply to new events only — an existing event
  // may legitimately sit in the past and still be edited.
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const nowTimeStr = `${pad2(today.getHours())}:${pad2(today.getMinutes())}`;
  const isTodaySelected = form.date === todayIso;
  const isPastDate = !editingId && !!form.date && form.date < todayIso;
  const startInPast =
    !editingId && !form.allDay && isTodaySelected && !!form.startTime && form.startTime < nowTimeStr;
  const endNotAfterStart =
    !form.allDay && !!form.startTime && !!form.endTime && form.endTime <= form.startTime;
  const timesIncomplete = !form.allDay && (!form.startTime || !form.endTime);
  const validationMessage = isPastDate
    ? "Pick today or a future date."
    : startInPast
      ? "That start time has already passed today."
      : endNotAfterStart
        ? "End time must be after the start time."
        : null;
  const formInvalid =
    !form.title.trim() || isPastDate || startInPast || endNotAfterStart || timesIncomplete;
  // Native-picker guards (belt-and-braces with the disabled Save button).
  const dateMin = editingId ? undefined : todayIso;
  const startMin = isTodaySelected && !editingId ? nowTimeStr : undefined;

  const monthFirst = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const monthOffset = (monthFirst.getDay() + 6) % 7;
  const daysInMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
  const tzHours = -new Date().getTimezoneOffset() / 60;
  const tzLabel = `GMT${tzHours >= 0 ? "+" : ""}${tzHours}`;

  return (
    <div className="page-content calendar-view">
      <header className="page-heading calendar-heading">
        <div>
          <div className="eyebrow muted-eyebrow">CALENDAR</div>
          <h1>{title}</h1>
        </div>
        <div className="calendar-actions">
          <div className="segmented">
            {(["Day", "Week", "Month"] as const).map((item) => (
              <button
                className={mode === item ? "selected" : ""}
                onClick={() => setMode(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="secondary-button" onClick={() => setRefDate(new Date())}>
            Today
          </button>
          <IconButton label={`Previous ${mode.toLowerCase()}`} onClick={() => shift(-1)}>
            <ArrowLeft size={18} />
          </IconButton>
          <IconButton label={`Next ${mode.toLowerCase()}`} onClick={() => shift(1)}>
            <ArrowRight size={18} />
          </IconButton>
          <button className="primary-button" onClick={openQuickAdd}>
            <Plus size={17} /> New
          </button>
        </div>
      </header>
      {error && (
        <div className="data-banner data-banner-error" role="alert">
          {error}
        </div>
      )}
      {loading && !error && (
        <div className="data-banner" aria-live="polite">
          <Loading variant="inline" size={18} text="Loading your calendar…" />
        </div>
      )}
      <div className={`calendar-layout calendar-layout-${mode.toLowerCase()}`}>
        {mode !== "Month" && (
          <aside className="calendar-context glass-card">
            <div className="mini-month-title">
              <strong>
                {refDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </strong>
              <div>
                <ChevronDown size={15} />
              </div>
            </div>
            <div className="mini-weekdays">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mini-month">
              {Array.from({ length: 42 }, (_, i) => {
                const dayNum = i - monthOffset + 1;
                const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                const cellIso = inMonth
                  ? isoDate(new Date(refDate.getFullYear(), refDate.getMonth(), dayNum))
                  : "";
                return (
                  <span
                    key={i}
                    className={!inMonth ? "faded" : cellIso === todayIso ? "active" : ""}
                  >
                    {inMonth ? dayNum : ""}
                  </span>
                );
              })}
            </div>
          </aside>
        )}
        {mode === "Week" && (
          <MobileWeekAgenda
            weekDays={weekDays}
            eventsByDate={eventsByDate}
            todayIso={todayIso}
            onOpenEvent={openEdit}
          />
        )}
        {mode === "Week" && (
          <div className="week-calendar glass-card">
            <div className="week-header">
              <div className="timezone">{tzLabel}</div>
              {weekDays.map((d) => (
                <div className={d.iso === todayIso ? "today-column" : ""} key={d.iso}>
                  <span>{weekdayLabel(d.date)}</span>
                  <strong>{d.num}</strong>
                </div>
              ))}
            </div>
            {weekDays.some((d) => (eventsByDate.get(d.iso) ?? []).some((ev) => ev.allDay)) && (
              <div className="week-all-day">
                <span className="week-all-day-label">ALL DAY</span>
                {weekDays.map((d) => (
                  <div key={d.iso}>
                    {(eventsByDate.get(d.iso) ?? [])
                      .filter((ev) => ev.allDay)
                      .map((ev) => (
                        <button
                          type="button"
                          className={`week-all-day-chip calendar-${ev.tone}${ev.completedAt ? " is-done" : ""}`}
                          key={ev.id}
                          onClick={() => openEdit(ev)}
                          title={ev.title}
                        >
                          {ev.completedAt ? <Check size={11} className="event-done-tick" /> : null}
                          {ev.title}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
            <DayGrid className="week-grid">
              <div className="time-rail">
                {HOUR_LABELS.map((time) => (
                  <span key={time}>{time}</span>
                ))}
              </div>
              {weekDays.map((d) => (
                <div className="day-column" key={d.iso}>
                  {(eventsByDate.get(d.iso) ?? [])
                    .filter((ev) => !ev.allDay)
                    .map((ev) => {
                      const { top, height } = positionOf(ev);
                      return (
                        <CalendarEvent
                          key={ev.id}
                          top={top}
                          height={height}
                          title={ev.title}
                          meta={eventMeta(ev)}
                          color={ev.tone}
                          completed={Boolean(ev.completedAt)}
                          onClick={() => openEdit(ev)}
                        />
                      );
                    })}
                  {d.iso === todayIso && nowOffset() >= 0 && nowOffset() <= GRID_HEIGHT && (
                    <div className="current-time" style={{ top: nowOffset() }}>
                      <i />
                      <span>{today.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  )}
                </div>
              ))}
            </DayGrid>
          </div>
        )}
        {mode === "Day" && (
          <DayCalendar
            date={refDate}
            events={eventsByDate.get(isoDate(refDate)) ?? []}
            isToday={isoDate(refDate) === todayIso}
            onOpenEvent={openEdit}
          />
        )}
        {mode === "Month" && (
          <MonthCalendar
            refDate={refDate}
            eventsByDate={eventsByDate}
            todayIso={todayIso}
            onOpenEvent={openEdit}
          />
        )}
      </div>
      {showModal && (
        <div className="modal-backdrop" onMouseDown={closeModal}>
          <div className="event-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="section-kicker">
                  {!editingId
                    ? "QUICK ADD"
                    : actionState?.completed
                      ? "COMPLETED"
                      : eventPhase === "live"
                        ? "HAPPENING NOW"
                        : eventPhase === "ended"
                          ? "ENDED"
                          : "EDIT EVENT"}
                </span>
                <h2>
                  {!editingId ? "Create an event" : lockedForEdit ? editingEvent?.title || "Event" : "Change this event"}
                </h2>
              </div>
              <IconButton label="Close" onClick={closeModal}>
                <X size={18} />
              </IconButton>
            </div>
            {lockedForEdit && editingEvent && actionState ? (
              /* Read-only: what the event is and what can still be done. */
              <div className="event-details">
                <dl>
                  <div>
                    <dt>When</dt>
                    <dd>{describeEventTime(editingEvent)}</dd>
                  </div>
                  {editingEvent.location && (
                    <div>
                      <dt>Where</dt>
                      <dd>{editingEvent.location}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`event-status-pill ${
                          actionState.completed ? "done" : eventPhase === "live" ? "live" : "past"
                        }`}
                      >
                        {actionState.completed ? <Check size={13} /> : null}
                        {actionState.completed
                          ? `Done${editingEvent.completedAt ? ` · ${new Date(editingEvent.completedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}`
                          : eventPhase === "live"
                            ? "In progress"
                            : "Ended"}
                      </span>
                    </dd>
                  </div>
                </dl>
                <p className="event-state-note">
                  {actionState.completed
                    ? "Marked done. Unmark it if that was a mistake."
                    : actionState.canComplete
                      ? "This event has started, so its details are locked. Mark it done when you’ve finished, or delete it."
                      : actionState.completionMissed
                        ? "The window to mark this done has passed. You can still delete it."
                        : "This event has started, so its details are locked. You can delete it."}
                </p>
              </div>
            ) : (
              <>
            <label className="field-label">
              TITLE
              <input
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="Event title"
                disabled={lockedForEdit}
              />
            </label>
            <div className="field-grid">
              <label className="field-label">
                DATE
                <input
                  type="date"
                  value={form.date}
                  min={dateMin}
                  onChange={(e) => setField("date", e.target.value)}
                  disabled={lockedForEdit}
                />
              </label>
              <label className="field-label">
                LOCATION
                <input
                  value={form.location}
                  onChange={(e) => setField("location", e.target.value)}
                  placeholder="Optional"
                  disabled={lockedForEdit}
                />
              </label>
            </div>
            <label
              className="field-label"
              style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}
            >
              {/* The inline 16px box beat every stylesheet, so this one
                  checkbox stayed a 16px target on a phone. */}
              <input
                type="checkbox"
                className="field-checkbox"
                checked={form.allDay}
                onChange={(e) => setField("allDay", e.target.checked)}
                disabled={lockedForEdit}
              />
              All day
            </label>
            {!form.allDay && (
              <div className="field-grid">
                <label className="field-label">
                  START
                  <input
                    type="time"
                    value={form.startTime}
                    min={startMin}
                    onChange={(e) => setField("startTime", e.target.value)}
                    disabled={lockedForEdit}
                  />
                </label>
                <label className="field-label">
                  END
                  <input
                    type="time"
                    value={form.endTime}
                    min={form.startTime || undefined}
                    onChange={(e) => setField("endTime", e.target.value)}
                    disabled={lockedForEdit}
                  />
                </label>
              </div>
            )}
              </>
            )}
            {validationMessage && !lockedForEdit && (
              <p className="composer-error" role="alert">
                {validationMessage}
              </p>
            )}
            {formError && <p className="composer-error">{formError}</p>}
            <div className={`modal-footer ${lockedForEdit ? "event-footer-readonly" : ""}`}>
              {editingId && (
                <button
                  className="secondary-button event-delete-button"
                  onClick={removeEvent}
                  disabled={saving || deleting || completing}
                  aria-busy={deleting}
                >
                  {deleting ? <Spinner /> : <Trash2 size={15} />}
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
              <button
                className="secondary-button"
                onClick={closeModal}
                disabled={saving || deleting || completing}
              >
                {lockedForEdit ? "Close" : "Cancel"}
              </button>
              {/* Mark done / undo — only inside the 12-hour window, or to undo. */}
              {editingId && actionState?.completed ? (
                <button
                  className="secondary-button event-done-button"
                  onClick={unmarkDone}
                  disabled={completing || deleting}
                  aria-busy={completing}
                >
                  {completing ? <Spinner /> : null} Mark not done
                </button>
              ) : editingId && actionState?.canComplete ? (
                <button
                  className="primary-button event-done-button"
                  onClick={markDone}
                  disabled={completing || deleting}
                  aria-busy={completing}
                >
                  {completing ? <Spinner /> : <Check size={15} />} Mark done
                </button>
              ) : null}
              {/* Save only when the event may still be edited (always for a new one). */}
              {!lockedForEdit && (
                <button
                  className="primary-button"
                  onClick={save}
                  disabled={saving || deleting || completing || formInvalid}
                  aria-busy={saving}
                >
                  {saving ? (
                    <>
                      <Spinner /> Saving…
                    </>
                  ) : editingId ? (
                    "Save changes"
                  ) : (
                    "Add to calendar"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Phone-only week view: a day strip with a vertical agenda instead of a 5-column grid. */
function MobileWeekAgenda({
  weekDays,
  eventsByDate,
  todayIso,
  onOpenEvent,
}: {
  weekDays: { date: Date; iso: string; num: number }[];
  eventsByDate: Map<string, CalEvent[]>;
  todayIso: string;
  onOpenEvent: (ev: CalEvent) => void;
}) {
  // Open on today when today is in the week on screen, not always on Monday.
  const [selected, setSelected] = useState(() => {
    const index = weekDays.findIndex((day) => day.iso === todayIso);
    return index === -1 ? 0 : index;
  });
  const selectedDay = weekDays[selected];
  // All-day events belong in the agenda too — they used to be filtered out
  // here and in the grid, so they were invisible everywhere but Month.
  const items = eventsByDate.get(selectedDay?.iso ?? "") ?? [];
  return (
    <div className="mobile-week-agenda">
      <div className="mobile-day-strip" role="tablist" aria-label="Days this week">
        {weekDays.map((d, index) => {
          const dayEvents = eventsByDate.get(d.iso) ?? [];
          return (
            <button
              key={d.iso}
              role="tab"
              aria-selected={selected === index}
              className={`${selected === index ? "selected" : ""} ${d.iso === todayIso ? "today" : ""}`}
              onClick={() => setSelected(index)}
            >
              <span>{weekdayLabel(d.date)}</span>
              <strong>{d.num}</strong>
              <i>
                {dayEvents.slice(0, 3).map((item) => (
                  <b key={item.id} className={`tone-${item.tone}`} />
                ))}
              </i>
            </button>
          );
        })}
      </div>
      <div className="mobile-agenda-summary">
        <strong>
          {selectedDay && selectedDay.iso === todayIso
            ? "Today"
            : selectedDay
              ? selectedDay.date.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })
              : ""}
        </strong>
        <span>
          {items.length} {items.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="mobile-agenda-list">
        {items.length === 0 && <p className="mobile-month-empty">Nothing scheduled.</p>}
        {items.map((item) => (
          <article
            className={`mobile-agenda-event tone-${item.tone}`}
            key={item.id}
            onClick={() => onOpenEvent(item)}
          >
            <time>
              {item.allDay ? (
                <strong>All day</strong>
              ) : (
                <>
                  <strong>{timeLabel(item.startsAt).replace(/ ?[AP]M/, "")}</strong>
                  <span>{timeLabel(item.startsAt).slice(-2)}</span>
                </>
              )}
            </time>
            <div>
              <strong>{item.title}</strong>
              <span>{durationLabel(item)}</span>
            </div>
            <ChevronRight size={16} />
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * The scrolling day surface. The grid is a full 24 hours tall so nothing is
 * clipped, and it opens parked on the working day rather than at midnight.
 */
function DayGrid({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = Math.min(DEFAULT_SCROLL_TOP, Math.max(0, el.scrollHeight - el.clientHeight));
  }, []);
  return (
    <div className={className} ref={ref}>
      <div className="day-grid-inner" style={{ height: GRID_HEIGHT }}>
        {children}
      </div>
    </div>
  );
}

function CalendarEvent({
  top,
  height,
  title,
  meta,
  color,
  completed,
  onClick,
}: {
  top: number;
  height: number;
  title: string;
  meta: string;
  color: string;
  completed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`calendar-event calendar-${color}${completed ? " is-done" : ""}`}
      style={{ top, height }}
      onClick={onClick}
      title={`${title} — ${meta}${completed ? " (done)" : ""}`}
    >
      <strong>
        {completed ? <Check size={11} className="event-done-tick" /> : null}
        {title}
      </strong>
      <span>{meta}</span>
    </button>
  );
}

function DayCalendar({
  date,
  events,
  isToday,
  onOpenEvent,
}: {
  date: Date;
  events: CalEvent[];
  isToday: boolean;
  onOpenEvent: (ev: CalEvent) => void;
}) {
  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);
  const totalMin = timed.reduce((sum, ev) => {
    const s = new Date(ev.startsAt).getTime();
    const e = ev.endsAt ? new Date(ev.endsAt).getTime() : s + 3600000;
    return sum + Math.max(0, (e - s) / 60000);
  }, 0);
  const hrs = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  const scheduled =
    totalMin > 0 ? `${hrs ? `${hrs}h ` : ""}${mins ? `${mins}m ` : ""}scheduled`.trim() : "Open day";

  return (
    <div className="day-calendar glass-card">
      <div className="day-calendar-header">
        <div>
          <span className="section-kicker">
            {date.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase()}
          </span>
          <h2>{date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}</h2>
        </div>
        <div className="day-summary">
          <strong>
            {timed.length} {timed.length === 1 ? "event" : "events"}
          </strong>
          <span>{scheduled}</span>
        </div>
      </div>
      {allDay.length > 0 && (
        <div className="all-day-row">
          <span>ALL DAY</span>
          <div>
            {allDay.map((e) => (
              <button
                type="button"
                className={`week-all-day-chip calendar-${e.tone}${e.completedAt ? " is-done" : ""}`}
                key={e.id}
                onClick={() => onOpenEvent(e)}
              >
                {e.completedAt ? <Check size={11} className="event-done-tick" /> : null}
                {e.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <DayGrid className="day-timeline">
        <div className="time-rail">
          {HOUR_LABELS.map((time) => (
            <span key={time}>{time}</span>
          ))}
        </div>
        <div className="day-column day-column-expanded">
          {timed.map((ev) => {
            const { top, height } = positionOf(ev);
            return (
              <CalendarEvent
                key={ev.id}
                top={top}
                height={height}
                title={ev.title}
                meta={`${eventMeta(ev)}${ev.location ? ` · ${ev.location}` : ""}`}
                color={ev.tone}
                completed={Boolean(ev.completedAt)}
                onClick={() => onOpenEvent(ev)}
              />
            );
          })}
          {isToday && nowOffset() >= 0 && nowOffset() <= GRID_HEIGHT && (
            <div className="current-time" style={{ top: nowOffset() }}>
              <i />
              <span>{new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </div>
          )}
        </div>
      </DayGrid>
    </div>
  );
}

function MonthCalendar({
  refDate,
  eventsByDate,
  todayIso,
  onOpenEvent,
}: {
  refDate: Date;
  eventsByDate: Map<string, CalEvent[]>;
  todayIso: string;
  onOpenEvent: (ev: CalEvent) => void;
}) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const [selectedIso, setSelectedIso] = useState(todayIso);
  // Paging to another month left the selection on today's date, so the phone's
  // month agenda kept showing "Today" and no cell appeared selected. Follow
  // the month: this one's 1st, or today when today is in it.
  const monthKey = `${year}-${month}`;
  const lastMonthKey = useRef(monthKey);
  if (lastMonthKey.current !== monthKey) {
    lastMonthKey.current = monthKey;
    const firstIso = isoDate(new Date(year, month, 1));
    if (!selectedIso.startsWith(firstIso.slice(0, 7))) {
      setSelectedIso(todayIso.startsWith(firstIso.slice(0, 7)) ? todayIso : firstIso);
    }
  }
  const selectedEvents = eventsByDate.get(selectedIso) ?? [];

  return (
    <div className="month-calendar glass-card">
      <div className="month-weekdays">
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {Array.from({ length: 42 }, (_, index) => {
          const dayNum = index - offset + 1;
          const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
          const cellIso = inMonth ? isoDate(new Date(year, month, dayNum)) : "";
          const dayEvents = cellIso ? eventsByDate.get(cellIso) ?? [] : [];
          return (
            <div
              key={index}
              className={`month-day ${!inMonth ? "outside-month" : ""} ${
                cellIso && cellIso === todayIso ? "today" : ""
              } ${cellIso && cellIso === selectedIso ? "selected" : ""}`}
              onClick={() => {
                if (cellIso) setSelectedIso(cellIso);
              }}
            >
              <span className="month-day-number">{inMonth ? dayNum : ""}</span>
              <div className="month-day-events">
                {dayEvents.slice(0, 2).map((event) => (
                  <div
                    className={`month-event month-event-${event.tone}${event.completedAt ? " is-done" : ""}`}
                    key={event.id}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onOpenEvent(event);
                    }}
                  >
                    <i />
                    <span>{event.title}</span>
                  </div>
                ))}
                {dayEvents.length > 2 && (
                  <span className="month-day-more">+{dayEvents.length - 2} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mobile-month-agenda">
        <div className="mobile-agenda-summary">
          <strong>
            {selectedIso === todayIso
              ? "Today"
              : new Date(`${selectedIso}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
          </strong>
          <span>
            {selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="mobile-agenda-list">
          {selectedEvents.map((event) => (
            <article
              className={`mobile-agenda-event mobile-month-event tone-${event.tone}${event.completedAt ? " is-done" : ""}`}
              key={event.id}
              onClick={() => onOpenEvent(event)}
            >
              <div>
                <strong>
                  {event.completedAt ? <Check size={12} className="event-done-tick" /> : null}
                  {event.title}
                </strong>
                <span>{eventMeta(event)}</span>
              </div>
              <ChevronRight size={16} />
            </article>
          ))}
          {selectedEvents.length === 0 && (
            <p className="mobile-month-empty">Nothing scheduled. Enjoy the open day.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A reply that just arrived types itself in — quickly, and as Markdown, so
 * formatting appears as it reveals rather than as raw asterisks. History
 * renders instantly: it used to re-animate every old message (one timer each)
 * whenever the chat mounted.
 */
function RevealReply({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(() => (animate ? 0 : text.length));
  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    // ~1.2s whatever the length: long answers must not take a minute to read.
    const step = Math.max(4, Math.ceil(text.length / 48));
    const timer = window.setInterval(() => {
      setShown((current) => {
        const next = Math.min(text.length, current + step);
        if (next >= text.length) window.clearInterval(timer);
        return next;
      });
    }, 25);
    return () => window.clearInterval(timer);
  }, [text, animate]);
  return <Markdown text={shown >= text.length ? text : text.slice(0, shown)} />;
}

// Stable reference so the Lottie players are not re-initialized on every render.
const lottieRendererSettings = {
  preserveAspectRatio: "xMidYMid meet",
  progressiveLoad: true,
};

/* ---------- Login intro: cubes drop onto the grid ----------
 * Built from the original Rolling Cubes data. For the first INTRO_FRAMES the
 * grid is revealed from its centre and copies of the three cubes (frozen at
 * the loop's first pose) fall, rotate, and settle while their own contact
 * shadows fade in. The original timeline is shifted to start exactly where the
 * intro ends, so the hand-off into the existing loop is seamless.
 */
type LottieJson = Record<string, any>;
type LottieLayer = Record<string, any>;

const INTRO_FRAMES = 110; // 1.83s at 60fps
const CUBE_STARTS = [12, 21, 30]; // 200ms, then 150ms stagger
const CUBE_FALL_FRAMES = 56;
const CUBE_DROPS = [900, 1080, 1260]; // composition units (~200–280px on screen)
const CUBE_ROTATIONS = [-18, 14, -22];
const CUBE_BOUNCE = 27; // ~6px on screen

const easeIn = { o: { x: [0.55], y: [0.085] }, i: { x: [0.68], y: [0.53] } };
const easeOut = { o: { x: [0.25], y: [0.46] }, i: { x: [0.45], y: [0.94] } };
const easeInOut = { o: { x: [0.45], y: [0] }, i: { x: [0.55], y: [1] } };
const softOut = { o: { x: [0.22], y: [1] }, i: { x: [0.36], y: [1] } };

const keyframes = (...frames: [number, number, typeof easeIn?][]) => ({
  a: 1,
  k: frames.map(([t, value, ease]) => ({ t, s: [value], ...(ease ?? {}) })),
});

const staticValue = (property: LottieJson | undefined, fallback: number[]): number[] =>
  property && property.a === 0
    ? Array.isArray(property.k)
      ? (property.k as number[])
      : [property.k as number]
    : fallback;

function valueAt(property: LottieJson | undefined, time: number, fallback: number[]): number[] {
  if (!property) return fallback;
  if (property.a !== 1) return property.k as number[];
  let value = property.k[0].s as number[];
  for (const frame of property.k) if (frame.t <= time && frame.s) value = frame.s;
  return value;
}

// Layer keyframe times are absolute composition frames, so shifting a layer
// later means moving its keyframes too (its `st` only offsets precomp content).
function shiftKeyframes(node: unknown, frames: number) {
  if (Array.isArray(node)) {
    node.forEach((item) => {
      if (
        item &&
        typeof item === "object" &&
        typeof item.t === "number" &&
        ("s" in item || "h" in item)
      ) {
        item.t += frames;
      }
      shiftKeyframes(item, frames);
    });
  } else if (node && typeof node === "object") {
    Object.values(node).forEach((value) => shiftKeyframes(value, frames));
  }
}

function ellipsePath(cx: number, cy: number, r: number) {
  const k = r * 0.5523;
  return {
    c: true,
    v: [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ],
    i: [
      [-k, 0],
      [0, -k],
      [k, 0],
      [0, k],
    ],
    o: [
      [k, 0],
      [0, k],
      [-k, 0],
      [0, -k],
    ],
  };
}

function buildCubeIntro(source: LottieJson): LottieJson {
  const data: LottieJson = structuredClone(source);
  const N = INTRO_FRAMES;
  const assets = new Map<string, LottieJson>(
    data.assets.map((item: LottieJson) => [item.id, item]),
  );
  let nextInd = Math.max(...data.layers.map((layer: LottieLayer) => layer.ind ?? 0)) + 1;
  const openingCubes = data.layers.filter(
    (layer: LottieLayer) => layer.ty === 0 && layer.ip <= 0 && layer.op > 0,
  );

  for (const layer of data.layers as LottieLayer[]) {
    if (layer.ty === 3) {
      layer.op += N; // parent null spans the intro too
    } else if (layer.nm === "Floor Grid") {
      // Grid: faint start, reveal outward from its centre, settle at original opacity.
      const target = staticValue(layer.ks.o, [50])[0];
      layer.op += N;
      layer.ks.o = keyframes([6, 6, softOut], [60, target]);
      layer.hasMask = true;
      layer.masksProperties = [
        {
          nm: "Intro reveal",
          mode: "a",
          inv: false,
          o: { a: 0, k: 100 },
          x: { a: 0, k: 0 },
          pt: {
            a: 1,
            k: [
              { t: 24, s: [ellipsePath(0, -35, 20)], o: { x: 0.22, y: 1 }, i: { x: 0.36, y: 1 } },
              { t: 62, s: [ellipsePath(0, -35, 640)] },
            ],
          },
        },
      ];
    } else {
      shiftKeyframes(layer, N);
      layer.ip += N;
      layer.op += N;
      layer.st += N;
      if (typeof layer.nm === "string" && layer.nm.startsWith("Trail")) {
        // Trails hold their first-frame shape before the loop; fade them in so
        // the hand-off into the loop has no pop.
        const target = staticValue(layer.ks.o, [100])[0];
        layer.ip = N - 30;
        layer.ks.o = keyframes([N - 30, 0, easeInOut], [N, target]);
      }
    }
  }
  data.op += N;

  const cubeCopies: LottieLayer[] = [];
  const shadowCopies: LottieLayer[] = [];
  openingCubes.forEach((layer: LottieLayer, index: number) => {
    const asset = assets.get(layer.refId);
    const cube = asset?.layers.find((item: LottieLayer) => item.nm === "Cube");
    if (!asset || !cube) return;
    const cubeAssetId = `${asset.id}-intro-cube`;
    const shadowAssetId = `${asset.id}-intro-shadow`;
    data.assets.push(
      {
        ...asset,
        id: cubeAssetId,
        layers: asset.layers.filter((l: LottieLayer) => l.nm === "Cube"),
      },
      {
        ...asset,
        id: shadowAssetId,
        layers: asset.layers.filter((l: LottieLayer) => l.nm === "Shadow"),
      },
    );

    const start = CUBE_STARTS[index] ?? CUBE_STARTS[CUBE_STARTS.length - 1] + 9 * index;
    const land = start + CUBE_FALL_FRAMES;
    const anchor = staticValue(layer.ks.a, [540, 540]);
    const position = staticValue(layer.ks.p, [0, 0]);
    const scale = staticValue(layer.ks.s, [100, 100]);
    // Rotate around the cube itself rather than the 1080×1080 precomp centre.
    const pivot = valueAt(cube.ks.p, 0, [540, 540]);
    const px = position[0] + (scale[0] / 100) * (pivot[0] - anchor[0]);
    const py = position[1] + (scale[1] / 100) * (pivot[1] - anchor[1]);
    const drop = CUBE_DROPS[index] ?? CUBE_DROPS[CUBE_DROPS.length - 1];
    const frozen = { tm: { a: 0, k: 0 }, ip: 0, op: N, st: 0, parent: layer.parent };

    cubeCopies.push({
      ...layer,
      ...frozen,
      nm: `${layer.nm} intro`,
      ind: nextInd++,
      refId: cubeAssetId,
      ks: {
        ...layer.ks,
        a: { a: 0, k: [pivot[0], pivot[1], 0] },
        p: {
          s: true,
          x: { a: 0, k: px },
          y: keyframes(
            [start, py - drop, easeIn],
            [land, py, easeOut],
            [land + 7, py - CUBE_BOUNCE, easeInOut],
            [land + 18, py],
          ),
        },
        r: keyframes([start, CUBE_ROTATIONS[index] ?? 16, softOut], [land, 0]),
        o: keyframes([start, 0, softOut], [start + 14, 100]),
      },
    });
    // Contact shadow strengthens as the cube approaches and lands.
    shadowCopies.push({
      ...layer,
      ...frozen,
      nm: `${layer.nm} intro shadow`,
      ind: nextInd++,
      refId: shadowAssetId,
      ks: { ...layer.ks, o: keyframes([land - 22, 0, softOut], [land + 6, 100]) },
    });
  });

  // Cubes above their shadows, both above the grid and the shifted original layers.
  data.layers.splice(1, 0, ...cubeCopies, ...shadowCopies);
  return data;
}

const introAnimationCache = new Map<string, Promise<LottieJson>>();
function loadIntroAnimation(file: string) {
  let pending = introAnimationCache.get(file);
  if (!pending) {
    pending = fetch(asset(file))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${file}`);
        return response.json() as Promise<LottieJson>;
      })
      .then(buildCubeIntro);
    pending.catch(() => introAnimationCache.delete(file));
    introAnimationCache.set(file, pending);
  }
  return pending;
}

function RollingCubes({
  thinking = false,
  intro = false,
  onReady,
}: {
  thinking?: boolean;
  /** Play the one-time drop-in before the original loop (login page only). */
  intro?: boolean;
  /** Called once the cubes are built and about to fall (or if they fail to load). */
  onReady?: () => void;
}) {
  const [useIntro] = useState(() => intro && !prefersReducedMotion());
  const [introData, setIntroData] = useState<{ mono: LottieJson; color: LottieJson } | null>(null);
  const [introFailed, setIntroFailed] = useState(false);
  const monoRef = useRef<LottieHandle>(null);
  const colorRef = useRef<LottieHandle>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!useIntro) return;
    let active = true;
    Promise.all([
      loadIntroAnimation("rolling-cubes-mono.lottie-data"),
      loadIntroAnimation("rolling-cubes-color.lottie-data"),
    ])
      .then(([mono, color]) => active && setIntroData({ mono, color }))
      .catch(() => {
        if (!active) return;
        setIntroFailed(true);
        onReadyRef.current?.();
      });
    return () => {
      active = false;
    };
  }, [useIntro]);

  // After the intro and one full pass, loop only the original section.
  const totalFrames = introData?.mono.op ?? 0;
  const monoSubscriptions = useMemo(
    () => ({
      ready: () => onReadyRef.current?.(),
      complete: () => {
        monoRef.current?.setLoop(true);
        monoRef.current?.playSegments([INTRO_FRAMES, totalFrames]);
      },
    }),
    [totalFrames],
  );
  const colorSubscriptions = useMemo(
    () => ({
      complete: () => {
        colorRef.current?.setLoop(true);
        colorRef.current?.playSegments([INTRO_FRAMES, totalFrames]);
      },
    }),
    [totalFrames],
  );

  const playIntro = useIntro && !introFailed;
  const placeholder = <span className="rolling-cubes-placeholder" aria-hidden="true" />;

  return (
    <div
      className={`rolling-cubes ${thinking ? "thinking" : ""}`}
      role="img"
      aria-label="MyPro rolling cubes animation"
    >
      <Suspense fallback={playIntro ? null : placeholder}>
        {playIntro ? (
          introData && (
            <>
              <LottieSvg
                className="rolling-cubes-layer rolling-cubes-mono"
                src={introData.mono}
                autoplay
                loop={false}
                lottieRef={monoRef}
                subscriptions={monoSubscriptions}
                rendererSettings={lottieRendererSettings}
              />
              <LottieSvg
                className="rolling-cubes-layer rolling-cubes-color"
                src={introData.color}
                autoplay
                loop={false}
                lottieRef={colorRef}
                subscriptions={colorSubscriptions}
                rendererSettings={lottieRendererSettings}
                aria-hidden="true"
              />
            </>
          )
        ) : (
          <>
            <LottieSvg
              className="rolling-cubes-layer rolling-cubes-mono"
              src={asset("rolling-cubes-mono.lottie-data")}
              autoplay
              loop
              rendererSettings={lottieRendererSettings}
            />
            <LottieSvg
              className="rolling-cubes-layer rolling-cubes-color"
              src={asset("rolling-cubes-color.lottie-data")}
              autoplay
              loop
              rendererSettings={lottieRendererSettings}
              aria-hidden="true"
            />
          </>
        )}
      </Suspense>
    </div>
  );
}

type ChatMessage = {
  id: string;
  from: "user" | "ai";
  text: string;
  time: string;
  receipts?: ReceiptRow[];
  /** What the agent planned and what verification made of it (Phase 19). */
  agent?: AgentTurnSummary;
  /** Cards built from the turn's tool results, rendered under the reply. */
  blocks?: DisplayBlock[] | null;
  /** Arrived in this session (animate it); history renders at once. */
  fresh?: boolean;
};

/** "AK" from "ak@…" or a display name — the user's own initials, not a constant. */
function userInitials(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0].replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!local) return "You";
  const parts = local.split(" ");
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase();
}

/**
 * One message. Memoised: typing in the composer re-renders the view, and a
 * long conversation must not re-render (or re-parse) every message per key.
 */
const ChatMessageRow = memo(function ChatMessageRow({
  message: m,
  avatar,
}: {
  message: ChatMessage;
  avatar: string;
}) {
  return (
    <div className={`message ${m.from}`}>
      <div className="message-avatar" aria-hidden="true">
        {avatar}
      </div>
      <div className="message-bubble">
        {m.from === "ai" ? (
          <RevealReply text={m.text} animate={Boolean(m.fresh)} />
        ) : (
          <p className="message-user-text">{m.text}</p>
        )}
        <ResultBlocks blocks={m.blocks} />
        <AgentPlanCard agent={m.agent} />
        {m.receipts && m.receipts.length > 0 && (
          <div className="receipt-cards">
            {m.receipts.map((r) => (
              <ReceiptCard key={r.id} receipt={r} />
            ))}
          </div>
        )}
        <time>{m.time}</time>
      </div>
    </div>
  );
});

function receiptTone(status: ReceiptRow["status"]): "ok" | "bad" | "wait" {
  if (status === "success") return "ok";
  if (status === "failed" || status === "denied") return "bad";
  return "wait";
}

/** A thing the companion did, rendered inline under its reply. */
function ReceiptCard({ receipt }: { receipt: ReceiptRow }) {
  const tone = receiptTone(receipt.status);
  return (
    <div className={`receipt-card receipt-${tone}`}>
      <span className="receipt-icon">
        {tone === "ok" ? <Check size={13} /> : tone === "bad" ? <X size={13} /> : <Clock3 size={13} />}
      </span>
      <div className="receipt-body">
        <span className="receipt-summary">{receipt.summary || receipt.skill}</span>
        {receipt.error && <span className="receipt-error">{receipt.error}</span>}
      </div>
      <span className="receipt-skill">{receipt.skill}</span>
    </div>
  );
}

function fmtTime(iso?: string | null): string {
  if (!iso) return "Just now";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Just now"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function AssistantView({ userEmail }: { userEmail?: string | null }) {
  // Real agent chat when the backend is configured; otherwise the original
  // local prototype flow so the design stays demoable without a laptop.
  const configured = isApiConfigured;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  /**
   * Effort for the NEXT message only. Null means "whatever my character
   * settings say", which is the normal case — this is for the one question
   * that deserves more thought than usual, or less.
   */
  const [turnMode, setTurnMode] = useState<EffortMode | null>(null);
  /** The character's name, so the chat calls it what the user named it. */
  const [characterName, setCharacterName] = useState("MyPro");
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const request = useSimulatedRequest();

  /**
   * Stick to the bottom only while the reader is at the bottom. It used to
   * yank the view down on every change — including a background reload while
   * you were reading an older answer.
   */
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const scrollToBottom = useCallback((smooth = true) => {
    const el = conversationRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setShowJump(false);
  }, []);
  const onConversationScroll = useCallback(() => {
    const el = conversationRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = near;
    if (near) setShowJump(false);
  }, []);
  const lastMessage = messages[messages.length - 1];
  useLayoutEffect(() => {
    if (!lastMessage && !isThinking) return;
    if (atBottom.current || lastMessage?.from === "user") scrollToBottom(Boolean(lastMessage?.fresh));
    else setShowJump(true);
  }, [lastMessage, isThinking, scrollToBottom]);
  // A fresh reply grows while it reveals; keep its end in view.
  useEffect(() => {
    const el = conversationRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const content = el.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [messages.length > 0]);

  // The composer grows with what you type, up to a limit, then scrolls.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [message]);

  // Load history, then poll agent presence and the approval queue.
  useEffect(() => {
    if (!configured) return;
    let active = true;

    const loadHistory = () =>
      api.assistant
        .messages(50)
        .then((history) => {
          if (!active) return;
          setMessages(
            history
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({
                id: m.id,
                from: m.role === "assistant" ? "ai" : "user",
                text: m.content ?? "",
                time: fmtTime(m.created_at),
                blocks: m.blocks,
              })),
          );
        })
        .catch(() => {});
    void loadHistory();
    // A scheduled AI task (or the brief) writes into this conversation from
    // the server. Its "done" notification arrives over Realtime; reload then,
    // so the reply appears in an open chat without leaving and coming back.
    const onServerMessage = () => void loadHistory();
    window.addEventListener("mypro:assistant-updated", onServerMessage);

    // Who it is. Cosmetic, so a failure just leaves the default name.
    api.assistant
      .persona()
      .then((loaded) => {
        const name = (loaded as { name?: string } | null)?.name?.trim();
        if (active && name) setCharacterName(name);
      })
      .catch(() => {});

    const poll = async () => {
      try {
        const status = await api.nodes.status();
        if (active) setAgentOnline(Boolean(status.agent?.online));
      } catch {
        if (active) setAgentOnline(null);
      }
      try {
        const queue = await api.skills.pending();
        if (active) setPending(queue);
      } catch {
        /* agent asleep — keep the queue as-is */
      }
    };
    poll();
    // Skip polling while the app is in the background: a hidden WebView or
    // tab polling every 30s is battery and data spent on nothing.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("mypro:assistant-updated", onServerMessage);
    };
  }, [configured]);

  const send = async (text = message) => {
    const clean = text.trim();
    if (!clean || isThinking) return;
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, from: "user", text: clean, time: "Just now" },
    ]);
    setMessage("");
    setError(null);
    setIsThinking(true);

    if (!configured) {
      await request(1450);
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          from: "ai",
          text: "I’ve reviewed your request alongside your calendar, library, and private records. I can organize the next step and keep everything aligned for you.",
          time: "Just now",
        },
      ]);
      setIsThinking(false);
      return;
    }

    try {
      // `turnMode` is a one-message override; null means "use my setting".
      const result = await api.assistant.send(clean, turnMode ?? undefined);
      setAgentOnline(true);
      setMessages((current) => [
        ...current,
        {
          id: result.message.id,
          from: "ai",
          text: result.message.content ?? "",
          time: fmtTime(result.message.created_at),
          receipts: result.receipts,
          agent: result.agent,
          blocks: result.agent?.blocks,
          fresh: true,
        },
      ]);
      // A turn may have queued an outward action for approval.
      api.skills.pending().then(setPending).catch(() => {});
    } catch (caught) {
      if (caught instanceof AgentOfflineError) {
        setAgentOnline(false);
        forgetAgentBase();
        setError("Your laptop agent is asleep, so the assistant can’t reply right now.");
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    } finally {
      setIsThinking(false);
    }
  };

  /** Approve (and, for an email, send) — optionally with the card's edits. */
  const approvePending = async (
    id: string,
    edits?: { to?: string; subject?: string; body?: string },
  ): Promise<ApprovalOutcome> => {
    try {
      const outcome = await api.skills.approve(id, edits);
      // Sent: drop it after the card has shown "Sent". Failed for certain:
      // the server put it back in the queue with the reason — reload it.
      window.setTimeout(
        () => api.skills.pending().then(setPending).catch(() => {}),
        outcome.ok ? 2500 : 0,
      );
      return outcome;
    } catch (caught) {
      api.skills.pending().then(setPending).catch(() => {});
      throw caught;
    }
  };

  const rejectPending = async (id: string) => {
    setPending((queue) => queue.filter((item) => item.id !== id));
    try {
      await api.skills.reject(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the request.");
      api.skills.pending().then(setPending).catch(() => {});
    }
  };

  const clearConversation = async () => {
    if (configured) {
      try {
        await api.assistant.clear("wipe");
      } catch {
        /* best effort */
      }
    }
    setMessages([]);
    setError(null);
  };

  const offline = configured && agentOnline === false;

  return (
    <div className="assistant-view">
      <main className="assistant-main">
        <div className="assistant-top">
          <div className="assistant-identity">
            <span className="assistant-identity-mark">
              <Sparkles size={15} />
            </span>
            <span className="assistant-identity-name">{characterName}</span>
            {configured && (
              <span
                className={`agent-dot ${agentOnline === null ? "unknown" : agentOnline ? "online" : "offline"}`}
                title={
                  agentOnline === null
                    ? "Connecting to your agent"
                    : agentOnline
                      ? "Agent online"
                      : "Agent asleep — wake your laptop"
                }
                aria-label={
                  agentOnline === null
                    ? "Connecting"
                    : agentOnline
                      ? "Agent online"
                      : "Agent asleep"
                }
              />
            )}
          </div>
          <div className="assistant-top-right">
            {configured && (
              <div className="effort-picker" role="group" aria-label="Effort for the next message">
                {(["light", "default", "deep"] as EffortMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`effort-chip${(turnMode ?? "default") === mode ? " is-active" : ""}`}
                    aria-pressed={(turnMode ?? "default") === mode}
                    title={
                      mode === "light"
                        ? "One quick pass — cheapest"
                        : mode === "default"
                          ? "Plans and checks its work"
                          : "More steps, more memory, more sources"
                    }
                    onClick={() => setTurnMode(mode)}
                  >
                    {mode === "default" ? "Normal" : mode === "light" ? "Light" : "Deep"}
                  </button>
                ))}
              </div>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                className="chat-new"
                onClick={clearConversation}
                aria-label="New conversation"
                title="New conversation"
              >
                <Plus size={18} />
              </button>
            )}
          </div>
        </div>
        <div className={`assistant-center ${messages.length > 0 ? "chatting" : ""}`}>
          {messages.length === 0 ? (
            <div className="assistant-intro">
              <RollingCubes thinking={isThinking} />
              <span className="section-kicker">YOUR COMPANION</span>
              <h1>How can I help?</h1>
              <p>Your time, knowledge and health — in one place.</p>
            </div>
          ) : (
            <div
              className="conversation"
              ref={conversationRef}
              onScroll={onConversationScroll}
              role="log"
              aria-live="polite"
              aria-label="Conversation"
            >
              <div className="conversation-inner">
                {messages.map((m) => (
                  <ChatMessageRow
                    key={m.id}
                    message={m}
                    avatar={m.from === "ai" ? characterInitial(characterName) : userInitials(userEmail)}
                  />
                ))}
                {isThinking && (
                  <div className="message ai loading-message">
                    <div className="message-avatar">{characterInitial(characterName)}</div>
                    <div className="message-bubble thinking-bubble" role="status">
                      <span>{characterName} is thinking</span>
                      <span className="typing-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {showJump && (
            <button type="button" className="chat-jump" onClick={() => scrollToBottom()}>
              <ChevronDown size={15} /> Latest
            </button>
          )}
        </div>
        {pending.length > 0 && (
          <div className="approval-queue" aria-label="Waiting for your approval">
            {pending.map((item) => (
              <ApprovalCard key={item.id} item={item} onApprove={approvePending} onReject={rejectPending} />
            ))}
          </div>
        )}
        <div className="composer">
          <div className={`composer-field ${offline ? "disabled" : ""}`}>
            <textarea
              ref={composerRef}
              rows={1}
              aria-label="Message"
              enterKeyHint="send"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={offline ? "Your laptop agent is asleep…" : "Ask MyPro anything..."}
              disabled={offline}
            />
            {/* The attach and microphone buttons that used to sit here had no
                handler and nothing to send to — `/assistant/messages` carries
                text only. They are gone rather than left looking live. */}
            <div className="composer-tools">
              <button
                className={`send-button ${isThinking ? "sending" : ""}`}
                onClick={() => send()}
                disabled={isThinking || offline || !message.trim()}
                aria-label={isThinking ? "Sending" : "Send"}
              >
                {isThinking ? <Loading variant="inline" size={17} /> : <Send size={17} />}
              </button>
            </div>
          </div>
          {error ? (
            <p className="composer-error">{error}</p>
          ) : offline ? (
            <p>Wake your laptop to chat. Everything else keeps working.</p>
          ) : (
            <p>Private, and under your control.</p>
          )}
        </div>
      </main>
    </div>
  );
}

const initialLibraryItems: LibraryItem[] = [
  {
    title: "The Creative Act",
    creator: "Rick Rubin",
    type: "Books",
    status: "In Progress",
    progress: 64,
    accessed: "Today",
    tone: "lavender",
    image: "https://covers.openlibrary.org/b/isbn/9780593652886-M.jpg",
    totalPages: 320,
    currentPage: 205,
    pdfFileName: "the-creative-act.pdf",
    pdfStorageOption: "device",
    syncStatus: "local",
    fileSizeBytes: 5033164,
    bookmarks: [
      { id: "bm-1", page: 14, title: "How to Notice", createdAt: "May 18" },
      { id: "bm-2", page: 128, title: "Attention as a Practice", createdAt: "Today" },
    ],
    notes: [
      {
        id: "n-1",
        page: 128,
        text: "The quality of attention changes the quality of the work itself.",
        createdAt: "Today, 8:44 AM",
      },
    ],
    highlights: [
      {
        id: "h-1",
        page: 36,
        text: "We are receivers of energy, filters of the world around us.",
        color: "lavender",
      },
      {
        id: "h-2",
        page: 128,
        text: "To approach the canvas without preconception is true innocence.",
        color: "mint",
      },
    ],
  },
  {
    title: "Design Better",
    creator: "Aarron Walter · InVision",
    type: "Podcasts",
    status: "In Progress",
    progress: 42,
    accessed: "Yesterday",
    tone: "blue",
    image:
      "https://images.unsplash.com/photo-1449247709967-d4461a6a6103?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=300&h=300",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    podcastName: "Design Better",
    episodeTitle: "Designing for trust and calm",
    durationSeconds: 3852,
    currentTimeSeconds: 1620,
    playbackSpeed: 1,
  },
  {
    title: "Designing Calm Systems",
    creator: "Field Notes Journal",
    type: "Articles",
    status: "Want to Read",
    progress: 18,
    accessed: "May 23",
    tone: "peach",
    image:
      "https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=360&h=240",
    readTimeMinutes: 9,
  },
  {
    title: "Attention as a Practice",
    creator: "Personal note",
    type: "Notes",
    status: "Favorites",
    progress: 100,
    accessed: "May 21",
    tone: "mint",
    image: "",
  },
];

type AddKind = "Digital Book" | "Physical Book" | "Podcast" | "Article";

const emptyAddForm = {
  title: "",
  author: "",
  description: "",
  category: "Personal Growth",
  totalPages: "",
  currentPage: "",
  url: "",
  channel: "",
  duration: "",
  timestamp: "",
  fileName: "",
  coverUrl: "",
};

function LibraryView({
  items: libraryItems,
  onOpenMedia,
  onCreateItem,
  onRemoveItem,
  loading,
  error,
  showingSaved = false,
}: {
  items: LibraryItem[];
  onOpenMedia: (item: LibraryItem) => void;
  onCreateItem: (item: LibraryItem) => Promise<LibraryItem>;
  onRemoveItem: (item: LibraryItem) => Promise<void>;
  loading: boolean;
  error: string | null;
  /** The server was unreachable; this is the copy saved on the device. */
  showingSaved?: boolean;
}) {
  const offlineBooks = useOfflineBooks();
  const categories = ["All", "Books", "Podcasts", "Articles", "Notes"] as const;
  const filters = ["All", "In Progress", "Completed", "Want to Read", "Favorites"] as const;
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<AddKind>("Digital Book");
  /** The PDF picked in the add form, kept until the item exists to key it by. */
  const pendingPdfRef = useRef<File | null>(null);
  /** Set while a pasted YouTube link is being looked up. */
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const lookupToken = useRef(0);
  const [form, setForm] = useState(emptyAddForm);
  const [addingItem, setAddingItem] = useState(false);
  const [toast, setToast] = useState("");
  const request = useSimulatedRequest();
  const setField = (key: keyof typeof emptyAddForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const closeAdd = () => {
    if (addingItem) return;
    setShowAdd(false);
    setForm(emptyAddForm);
  };

  const parseTimestamp = (value: string) => {
    const parts = value.split(":").map((part) => parseInt(part, 10));
    if (parts.some(Number.isNaN) || parts.length === 0) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  };

  /**
   * Fill the episode in from the link. YouTube's oEmbed endpoint gives the
   * title, the channel and the artwork without an API key; the length is not
   * in oEmbed, so the player writes it back the first time you play.
   * Category and description stay yours.
   */
  const lookUpYouTube = useCallback(
    async (url: string) => {
      if (!extractVideoId(url)) return;
      const token = ++lookupToken.current;
      setLookingUp(true);
      setLookupNote(null);
      const meta = await fetchYouTubeMeta(url);
      if (token !== lookupToken.current) return; // a newer paste won
      setLookingUp(false);
      if (!meta) {
        setLookupNote("Couldn't read that link — fill the details in yourself.");
        return;
      }
      setForm((current) => ({
        ...current,
        title: current.title.trim() || meta.title,
        channel: current.channel.trim() || meta.channel,
        coverUrl: meta.thumbnail,
      }));
      setLookupNote(`Found “${meta.title}”. Length fills in when you first play it.`);
    },
    [],
  );

  const addLibraryItem = async () => {
    const tone =
      addType === "Podcast" ? "blue" : addType === "Article" ? "peach" : "lavender";
    const title = form.title.trim() || `Untitled ${addType.toLowerCase()}`;
    const total = parseInt(form.totalPages, 10) || 320;
    const current = parseInt(form.currentPage, 10) || 0;
    const base: LibraryItem = {
      title,
      creator: form.author.trim() || form.channel.trim() || "Added by you",
      type:
        addType === "Podcast" ? "Podcasts" : addType === "Article" ? "Articles" : "Books",
      status: "Want to Read",
      progress: 0,
      accessed: "Just now",
      tone,
      image: "",
      description: form.description.trim() || undefined,
    };
    const pdfFile = addType === "Digital Book" ? pendingPdfRef.current : null;
    let pdfBytes: ArrayBuffer | null = null;
    if (addType === "Digital Book") {
      base.currentPage = 1;
      base.pdfFileName = pdfFile?.name || form.fileName || "document.pdf";
      base.pdfStorageOption = "device";
      base.syncStatus = "local";
      base.fileSizeBytes = pdfFile?.size;
      // The PDF itself knows how long it is — ask it rather than guessing.
      if (pdfFile) {
        try {
          pdfBytes = await pdfFile.arrayBuffer();
          const detected = await readPageCount(pdfBytes);
          base.totalPages = detected || total;
        } catch {
          base.totalPages = total;
        }
      } else {
        base.totalPages = total;
      }
    } else if (addType === "Physical Book") {
      base.totalPages = total;
      base.currentPage = current;
      base.progress = total ? Math.round((current / total) * 100) : 0;
      if (base.progress > 0) base.status = "In Progress";
    } else if (addType === "Podcast") {
      base.youtubeUrl = form.url.trim();
      if (form.coverUrl) base.image = form.coverUrl;
      base.podcastName = form.channel.trim() || "Podcast";
      base.episodeTitle = title;
      base.durationSeconds = parseTimestamp(form.duration) || 3600;
      base.currentTimeSeconds = parseTimestamp(form.timestamp);
      base.playbackSpeed = 1;
    } else {
      base.readTimeMinutes = 8;
    }
    setAddingItem(true);
    try {
      const stored = await onCreateItem(base);
      // Park the bytes in the device vault, keyed by the item id when we have
      // one (the title is the legacy key, kept as a fallback on read).
      if (pdfFile && pdfBytes) {
        await storePdfLocally(stored.id ?? stored.title, pdfFile, pdfFile.name);
      }
    } catch (caught) {
      setAddingItem(false);
      setToast(caught instanceof Error ? caught.message : "Could not add item.");
      await request(2600);
      setToast("");
      return;
    }
    setAddingItem(false);
    setShowAdd(false);
    pendingPdfRef.current = null;
    setForm(emptyAddForm);
    setCategory("All");
    setFilter("All");
    setQuery("");
    setToast(`“${title}” added to your library`);
    await request(2600);
    setToast("");
  };
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [draggedCollection, setDraggedCollection] = useState<number | null>(null);
  const [collectionDraft, setCollectionDraft] = useState("");
  // Real rows. `/collections` has existed since the library landed; this view
  // used to hold five names in local state, so every rename and reorder was
  // lost on reload.
  const collectionsState = useCollections(true);
  const collections = collectionsState.collections;

  const visibleItems = libraryItems.filter((item) => {
    const matchesCategory = category === "All" || item.type === category;
    const matchesFilter =
      filter === "All" ||
      item.status === filter ||
      (filter === "Completed" && item.progress === 100) ||
      (filter === "Favorites" && item.status === "Favorites");
    const searchText = `${item.title} ${item.creator} ${item.type}`.toLowerCase();
    return matchesCategory && matchesFilter && searchText.includes(query.toLowerCase());
  });

  const addCollection = async () => {
    const id = await collectionsState.create("Untitled Collection");
    if (!id) return;
    setCollectionDraft("Untitled Collection");
    setEditingCollection(id);
  };

  // The toolbar advertised ⌘K; nothing listened for it until now.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** A count beats a sentence in the page header. */
  const inProgressCount = libraryItems.filter(
    (item) => item.progress > 0 && item.progress < 100,
  ).length;

  /** The per-item overflow menu — open for one item at a time. */
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<LibraryItem | null>(null);

  return (
    <div className="page-content foundation-view library-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">LIBRARY</div>
          <h1>Your ideas, all in one place.</h1>
          <p className="page-meta">
            {libraryItems.length} {libraryItems.length === 1 ? "item" : "items"}
            {inProgressCount > 0 ? ` · ${inProgressCount} in progress` : ""}
          </p>
        </div>
        <button className="primary-button" onClick={() => setShowAdd(true)}>
          <Plus size={17} /> Add to library
        </button>
      </header>

      {error && (
        <div className="data-banner data-banner-error" role="alert">
          {error}
        </div>
      )}
      {loading && !error && (
        <div className="data-banner" aria-live="polite">
          <Loading variant="inline" size={18} text="Loading your library…" />
        </div>
      )}
      <SyncStatus showingSaved={showingSaved} />

      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your library"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="library-categories" role="tablist" aria-label="Library categories">
          {categories.map((item) => (
            <button
              className={category === item ? "active" : ""}
              onClick={() => setCategory(item)}
              role="tab"
              aria-selected={category === item}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="library-filters">
          <SlidersHorizontal size={14} />
          {filters.map((item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item === "Favorites" && <Star size={11} />}
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="library-groups">
        {[
          { key: "Podcasts", label: "Podcasts", match: (i: LibraryItem) => i.type === "Podcasts" },
          {
            key: "Books",
            label: "Books",
            match: (i: LibraryItem) => i.type === "Books" && Boolean(i.pdfFileName || i.pdfUrl),
          },
          {
            key: "Physical",
            label: "Physical Books",
            match: (i: LibraryItem) => i.type === "Books" && !(i.pdfFileName || i.pdfUrl),
          },
          { key: "Articles", label: "Articles", match: (i: LibraryItem) => i.type === "Articles" },
          { key: "Notes", label: "Notes", match: (i: LibraryItem) => i.type === "Notes" },
        ].map((group) => {
          const groupItems = visibleItems.filter(group.match);
          if (!groupItems.length) return null;
          return (
            <section className="glass-card continue-learning-card" key={group.key}>
              <div className="card-heading">
                <div>
                  <span className="section-kicker">{group.label.toUpperCase()}</span>
                  <h2>{group.label}</h2>
                </div>
                <span className="library-result-count">{groupItems.length} items</span>
              </div>
              <div className="learning-list">
                {groupItems.map((item) => (
              <article className="learning-row" key={item.id ?? item.title}>
                <button
                  className={`learning-thumbnail ${item.type.toLowerCase()} ${item.tone}`}
                  onClick={() => onOpenMedia(item)}
                  aria-label={`Open ${item.title}`}
                >
                  {item.image ? <img src={item.image} alt="" /> : <StickyNote size={22} />}
                </button>
                <div className="learning-copy">
                  <div className="learning-title-line">
                    <div>
                      <span className={`content-type type-${item.tone}`}>{item.type}</span>
                      <OfflineRowBadge item={item} />
                      <h3>{item.title}</h3>
                    </div>
                    {/* This button did nothing at all before. */}
                    <div className="learning-row-menu">
                      <button
                        aria-label={`More options for ${item.title}`}
                        aria-expanded={rowMenu === (item.id ?? item.title)}
                        onClick={(event) => {
                          const key = item.id ?? item.title;
                          setRowMenu((open) => (open === key ? null : key));
                          // On a phone the row is often near the bottom of the
                          // screen; bring it up so the menu has room under it.
                          const row = event.currentTarget.closest("article");
                          if (row) {
                            requestAnimationFrame(() =>
                              row.scrollIntoView({ block: "center", behavior: "smooth" }),
                            );
                          }
                        }}
                      >
                        <Ellipsis size={17} />
                      </button>
                      {rowMenu === (item.id ?? item.title) && (
                        <>
                          <div
                            className="learning-row-menu-backdrop"
                            onClick={() => setRowMenu(null)}
                            aria-hidden="true"
                          />
                          <div className="learning-row-menu-pop">
                            <button
                              onClick={() => {
                                setRowMenu(null);
                                onOpenMedia(item);
                              }}
                            >
                              <Play size={13} /> Open
                            </button>
                            {item.type === "Books" && (item.pdfFileName || item.pdfUrl || item.id) && (
                              offlineBooks.get(item) ? (
                                <button
                                  onClick={() => {
                                    setRowMenu(null);
                                    void offlineBooks.remove(item);
                                  }}
                                >
                                  <WifiOff size={13} /> Remove download
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setRowMenu(null);
                                    void offlineBooks.download(item).catch(() => undefined);
                                  }}
                                >
                                  <Download size={13} /> Download for offline
                                </button>
                              )
                            )}
                            <button
                              className="danger"
                              onClick={() => {
                                setRowMenu(null);
                                setConfirmRemove(item);
                              }}
                            >
                              <Trash2 size={13} /> Remove
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <p>{item.creator}</p>
                  <div className="learning-progress-line">
                    <div className="progress">
                      <i style={{ width: `${item.progress}%` }} />
                    </div>
                    <strong>{item.progress}%</strong>
                  </div>
                  <div className="learning-footer">
                    <span>Last opened {item.accessed}</span>
                    <button onClick={() => onOpenMedia(item)}>
                      <Play size={12} fill="currentColor" />
                      Continue
                    </button>
                  </div>
                </div>
              </article>
                ))}
              </div>
            </section>
          );
        })}
        {visibleItems.length === 0 && (
          <div className="library-empty">
            <Search size={20} />
            <strong>No matching items</strong>
            <span>Try another category, filter, or search.</span>
          </div>
        )}
      </div>

      <div className="library-secondary-grid">
        <section className="glass-card collections-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">MY COLLECTIONS</span>
              <h2>Organize what matters</h2>
            </div>
            <button className="text-button" onClick={() => void addCollection()}>
              <Plus size={14} /> New collection
            </button>
          </div>
          <div className="collections-list">
            {collections.map((collection, index) => (
              <div
                className="collection-row"
                draggable
                onDragStart={() => setDraggedCollection(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedCollection === null || draggedCollection === index) return;
                  const reordered = [...collections];
                  const [moved] = reordered.splice(draggedCollection, 1);
                  reordered.splice(index, 0, moved);
                  // Persisted as `sort_order`, so the order survives a reload.
                  void collectionsState.reorder(reordered);
                  setDraggedCollection(null);
                }}
                onDragEnd={() => setDraggedCollection(null)}
                key={collection.id}
              >
                <GripVertical className="collection-grip" size={13} />
                <span className={`collection-icon collection-tone-${(index % 5) + 1}`}>
                  <Folder size={16} />
                </span>
                {editingCollection === collection.id ? (
                  <input
                    autoFocus
                    value={collectionDraft}
                    onChange={(event) => setCollectionDraft(event.target.value)}
                    onBlur={() => {
                      void collectionsState.rename(collection.id, collectionDraft);
                      setEditingCollection(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setEditingCollection(null);
                    }}
                  />
                ) : (
                  <button className="collection-name">
                    <strong>{collection.name}</strong>
                    <span>
                      {collection.count} saved item{collection.count === 1 ? "" : "s"}
                    </span>
                  </button>
                )}
                <button
                  className="collection-edit"
                  onClick={() => {
                    setCollectionDraft(collection.name);
                    setEditingCollection(collection.id);
                  }}
                  aria-label={`Rename ${collection.name}`}
                >
                  <Pencil size={13} />
                </button>
              </div>
            ))}
            {!collections.length && !collectionsState.loading && (
              <p className="settings-hint">No collections yet.</p>
            )}
          </div>
        </section>
      </div>

      <section className="library-stats">
        {(() => {
          const books = libraryItems.filter((item) => item.type === "Books");
          const podcasts = libraryItems.filter((item) => item.type === "Podcasts");
          const inProgress = libraryItems.filter((item) => item.status === "In Progress").length;
          const completed = libraryItems.filter(
            (item) => item.progress === 100 || item.status === "Completed",
          ).length;
          const pagesRead = books.reduce((total, item) => total + (item.currentPage || 0), 0);
          const minutesListened = Math.round(
            podcasts.reduce((total, item) => total + (item.currentTimeSeconds || 0), 0) / 60,
          );
          const stats: [typeof BookOpen, string, string][] = [
            [BookOpen, String(inProgress), "In progress"],
            [CheckCircle2, String(completed), "Completed"],
            [FileText, pagesRead.toLocaleString(), "Pages read"],
            [Headphones, `${minutesListened}m`, "Listened"],
          ];
          return stats.map(([Icon, value, label]) => (
            <div className="glass-card library-stat" key={label}>
              <span className="library-stat-icon">
                <Icon size={16} />
              </span>
              <strong>{value}</strong>
              <small>{label}</small>
            </div>
          ));
        })()}
      </section>

      {showAdd && (
        <div className="modal-backdrop" onMouseDown={closeAdd}>
          <div
            className="event-modal library-add-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="section-kicker">ADD TO LIBRARY</span>
                <h2>Add something worth keeping</h2>
              </div>
              <IconButton label="Close" onClick={closeAdd}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="add-type-grid add-type-grid-4">
              {(
                [
                  [BookOpen, "Digital Book"],
                  [Library, "Physical Book"],
                  [Headphones, "Podcast"],
                  [FileText, "Article"],
                ] as [typeof BookOpen, AddKind][]
              ).map(([Icon, type]) => (
                <button
                  className={addType === type ? "active" : ""}
                  onClick={() => setAddType(type)}
                  key={type}
                >
                  <Icon size={18} />
                  <span>{type}</span>
                </button>
              ))}
            </div>

            {addType === "Digital Book" && (
              <label className="field-label">
                PDF FILE
                <div className="link-input">
                  <Upload size={15} />
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => {
                      // Hold on to the file itself: the name alone cannot be
                      // read, and the reader extracts its text on this device.
                      const file = event.target.files?.[0] ?? null;
                      pendingPdfRef.current = file;
                      setField("fileName", file?.name ?? "");
                    }}
                  />
                </div>
              </label>
            )}
            {(addType === "Podcast" || addType === "Article") && (
              <label className="field-label">
                {addType === "Podcast" ? "YOUTUBE URL" : "ARTICLE URL"}
                <div className="link-input">
                  <ExternalLink size={15} />
                  <input
                    value={form.url}
                    onChange={(event) => {
                      const value = event.target.value;
                      setField("url", value);
                      if (addType === "Podcast") void lookUpYouTube(value);
                    }}
                    placeholder={
                      addType === "Podcast"
                        ? "Paste a YouTube link"
                        : "Paste the article URL"
                    }
                  />
                </div>
                {addType === "Podcast" && (lookingUp || lookupNote) && (
                  <span className="lookup-note">
                    {lookingUp ? "Reading the link…" : lookupNote}
                  </span>
                )}
                </label>
            )}

            <label className="field-label">
              TITLE
              <input
                value={form.title}
                onChange={(event) => setField("title", event.target.value)}
                placeholder={`${addType} title`}
              />
            </label>

            <div className="field-grid">
              <label className="field-label">
                {addType === "Podcast" ? "CHANNEL" : "AUTHOR / SOURCE"}
                <input
                  value={addType === "Podcast" ? form.channel : form.author}
                  onChange={(event) =>
                    setField(addType === "Podcast" ? "channel" : "author", event.target.value)
                  }
                  placeholder={addType === "Podcast" ? "Channel name" : "Author or source"}
                />
              </label>
              <label className="field-label">
                CATEGORY
                <select
                  value={form.category}
                  onChange={(event) => setField("category", event.target.value)}
                >
                  <option>Personal Growth</option>
                  <option>Technology</option>
                  <option>Business</option>
                  <option>Philosophy</option>
                  <option>Health &amp; Fitness</option>
                </select>
              </label>
            </div>

            {addType === "Physical Book" && (
              <div className="field-grid">
                <label className="field-label">
                  CURRENT PAGE
                  <input
                    type="number"
                    value={form.currentPage}
                    onChange={(event) => setField("currentPage", event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="field-label">
                  TOTAL PAGES
                  <input
                    type="number"
                    value={form.totalPages}
                    onChange={(event) => setField("totalPages", event.target.value)}
                    placeholder="320"
                  />
                </label>
              </div>
            )}
            {addType === "Podcast" && (
              <div className="field-grid">
                <label className="field-label">
                  DURATION
                  <input
                    value={form.duration}
                    onChange={(event) => setField("duration", event.target.value)}
                    placeholder="1:04:12"
                  />
                </label>
                <label className="field-label">
                  START AT
                  <input
                    value={form.timestamp}
                    onChange={(event) => setField("timestamp", event.target.value)}
                    placeholder="0:00"
                  />
                </label>
              </div>
            )}

            <label className="field-label">
              DESCRIPTION
              <textarea
                value={form.description}
                onChange={(event) => setField("description", event.target.value)}
                placeholder="Add a short description or context..."
              />
            </label>
            {addType === "Podcast" && (
              <p className="prototype-note">
                Video metadata retrieval is shown as a prototype interaction.
              </p>
            )}
            <div className="modal-footer">
              <button className="secondary-button" onClick={closeAdd} disabled={addingItem}>
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={addLibraryItem}
                disabled={addingItem}
                aria-busy={addingItem}
              >
                {addingItem ? (
                  <>
                    <Spinner /> Adding…
                  </>
                ) : (
                  `Add ${addType}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmRemove && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmRemove(null)}>
          <div className="event-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="section-kicker">REMOVE FROM LIBRARY</span>
                <h2>Remove “{confirmRemove.title}”?</h2>
              </div>
              <IconButton label="Close" onClick={() => setConfirmRemove(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <p className="settings-hint">
              The item and its reading progress are removed. This cannot be undone.
            </p>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
              <button
                className="secondary-button event-delete-button"
                onClick={async () => {
                  const item = confirmRemove;
                  setConfirmRemove(null);
                  await onRemoveItem(item);
                  setToast(`“${item.title}” removed`);
                  await request(2600);
                  setToast("");
                }}
              >
                <Trash2 size={15} /> Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="app-toast" role="status">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

const seededKnowledge: KnowledgeEntry[] = [
  {
    id: "q-seed-1",
    kind: "Quote",
    text: "A work is never truly finished; it is simply released.",
    bookTitle: "The Creative Act",
    page: 210,
    date: "May 24",
    tone: "peach",
    tags: ["craft", "process"],
  },
  {
    id: "s-seed-1",
    kind: "Summary",
    heading: "Part III — Crafting",
    text: "Craft is the patient translation of attention into form; the work improves as the quality of looking improves.",
    bookTitle: "The Creative Act",
    page: 128,
    date: "May 22",
    tone: "lavender",
    tags: ["summary"],
  },
  {
    id: "qu-seed-1",
    kind: "Question",
    text: "How do I keep beginner's mind without losing the discipline that experience brings?",
    bookTitle: "The Creative Act",
    page: 102,
    date: "May 21",
    tone: "cyan",
    tags: ["open-question"],
  },
];

/**
 * Entry dates arrive two ways: an ISO timestamp from `/knowledge`, or a
 * human string ("Today", "May 21") from the locally-derived fallback. The ISO
 * one was printed raw, so real data read `2026-11-17T08:12:33.941Z`.
 */
function knowledgeDate(value: string): string {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The UI's library types, in the vocabulary a knowledge entry records. */
const KNOWLEDGE_SOURCE: Record<LibraryItem["type"], KnowledgeEntry["sourceType"]> = {
  Books: "book",
  Podcasts: "podcast",
  Articles: "article",
  Notes: "note",
};

/**
 * Where an entry came from inside its source. A podcast note's `page` is the
 * position in seconds, so "Page 214" was simply wrong for every note taken
 * while listening.
 */
function sourceLocation(entry: KnowledgeEntry): string {
  if (entry.sourceType !== "podcast") return `Page ${entry.page}`;
  const total = Math.max(0, Math.round(entry.page));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const knowledgeTabs: { id: "All" | KnowledgeKind; label: string; icon: typeof BookOpen }[] = [
  { id: "All", label: "All", icon: ClipboardList },
  { id: "Note", label: "Notes", icon: StickyNote },
  { id: "Highlight", label: "Highlights", icon: Highlighter },
  { id: "Quote", label: "Quotes", icon: Quote },
  { id: "Summary", label: "Summaries", icon: FileText },
  { id: "Question", label: "Questions", icon: HelpCircle },
  { id: "Bookmark", label: "Bookmarks", icon: Bookmark },
];

function KnowledgeView({
  items,
  onJumpToSource,
}: {
  items: LibraryItem[];
  onJumpToSource: (title: string, page: number) => void;
}) {
  const [tab, setTab] = useState<"All" | KnowledgeKind>("All");
  const [query, setQuery] = useState("");
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // Reads /knowledge (all annotations + bookmarks) when configured; otherwise
  // falls back to the locally-derived entries so the prototype still works.
  const knowledge = useKnowledge();

  const removeEntry = (entryId: string) => {
    setDeleted((current) => new Set(current).add(entryId));
    const source = knowledge.configured ? entrySource(entryId) : null;
    if (!source) return;
    if (source.kind === "annotation") api.reader.deleteAnnotation(source.id).catch(() => {});
    else api.reader.deleteBookmark(source.id).catch(() => {});
  };

  /**
   * Commit an edit. The pencil used to write to local state only, so a
   * rewritten note read as saved and was the original again on reload.
   * Bookmarks have no editable body, so only annotations are sent.
   */
  const commitEdit = (entry: KnowledgeEntry) => {
    setEditingId(null);
    const next = edits[entry.id];
    if (next === undefined || next === entry.text) return;
    const source = knowledge.configured ? entrySource(entry.id) : null;
    if (source?.kind !== "annotation") return;
    api.reader.updateAnnotation(source.id, { body: next }).catch(() => {
      setEditError("That edit could not be saved. It will be back as it was on reload.");
    });
  };

  const localEntries = useMemo(() => {
    const colorToTone: Record<string, string> = {
      lavender: "lavender",
      cyan: "cyan",
      mint: "mint",
      coral: "peach",
      yellow: "lavender",
      peach: "peach",
      monochrome: "lavender",
    };
    const capitalize = (value: string) =>
      (value.charAt(0).toUpperCase() + value.slice(1)) as KnowledgeKind;
    const derived: KnowledgeEntry[] = [];
    for (const item of items) {
      const tone = item.tone || "lavender";
      if (item.annotations?.length) {
        // The reader is the source of truth once a book has annotations.
        item.annotations.forEach((annotation) =>
          derived.push({
            id: `an-${item.title}-${annotation.id}`,
            kind: capitalize(annotation.kind),
            text: annotation.body || annotation.anchorText,
            heading: annotation.title,
            bookTitle: item.title,
            page: annotation.page,
            sourceType: KNOWLEDGE_SOURCE[item.type],
            sourceId: item.id,
            creator: item.creator,
            cover: item.image || undefined,
            date: annotation.createdAt,
            tone: colorToTone[annotation.color || ""] || tone,
            tags: annotation.tags?.length ? annotation.tags : [annotation.kind],
          }),
        );
      } else {
        item.highlights?.forEach((highlight) =>
          derived.push({
            id: `hl-${item.title}-${highlight.id}`,
            kind: "Highlight",
            text: highlight.text,
            bookTitle: item.title,
            page: highlight.page,
            sourceType: KNOWLEDGE_SOURCE[item.type],
            sourceId: item.id,
            creator: item.creator,
            cover: item.image || undefined,
            date: item.accessed,
            tone: colorToTone[highlight.color] || tone,
            tags: [item.type.toLowerCase()],
          }),
        );
        item.notes?.forEach((note) =>
          derived.push({
            id: `nt-${item.title}-${note.id}`,
            kind: "Note",
            text: note.text,
            bookTitle: item.title,
            page: note.page,
            sourceType: KNOWLEDGE_SOURCE[item.type],
            sourceId: item.id,
            creator: item.creator,
            cover: item.image || undefined,
            date: note.createdAt,
            tone,
            tags: ["note"],
          }),
        );
      }
      item.bookmarks?.forEach((bookmark) =>
        derived.push({
          id: `bm-${item.title}-${bookmark.id}`,
          kind: "Bookmark",
          text: bookmark.title,
          bookTitle: item.title,
          page: bookmark.page,
          sourceType: KNOWLEDGE_SOURCE[item.type],
          sourceId: item.id,
          creator: item.creator,
          cover: item.image || undefined,
          date: bookmark.createdAt,
          tone,
          tags: ["bookmark"],
        }),
      );
    }
    return [...seededKnowledge, ...derived];
  }, [items]);

  // Real data from /knowledge wins; otherwise the locally-derived entries.
  const entries = knowledge.entries ?? localEntries;
  const live = useMemo(
    () =>
      entries
        .filter((entry) => !deleted.has(entry.id))
        .map((entry) => (edits[entry.id] !== undefined ? { ...entry, text: edits[entry.id] } : entry)),
    [entries, deleted, edits],
  );

  // Grouped by source (book / episode / article), derived — never stored.
  const groups = useMemo(() => groupKnowledge(live), [live]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [sort, setSort] = useState<GroupSort>("recent");
  const [typeFilter, setTypeFilter] = useState<"all" | SourceType>("all");
  const openGroup = groups.find((group) => group.key === groupKey) ?? null;
  // A group emptied by deletes closes itself rather than showing nothing.
  useEffect(() => {
    if (groupKey && !openGroup) setGroupKey(null);
  }, [groupKey, openGroup]);
  useEffect(() => {
    setTab("All");
    setQuery("");
  }, [groupKey]);

  const shownGroups = useMemo(() => {
    const byType = typeFilter === "all" ? groups : groups.filter((g) => g.sourceType === typeFilter);
    const narrowed = tab === "All" ? byType : byType
      .map((g) => ({ ...g, entries: g.entries.filter((e) => e.kind === tab) }))
      .filter((g) => g.entries.length);
    return sortGroups(searchGroups(narrowed, query), sort);
  }, [groups, typeFilter, tab, query, sort]);

  const scope = openGroup ? openGroup.entries : live;
  const visible = scope.filter((entry) => {
    if (tab !== "All" && entry.kind !== tab) return false;
    const haystack = `${entry.text} ${entry.heading ?? ""} ${entry.bookTitle} ${entry.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const counts = knowledgeTabs.map((item) => ({
    id: item.id,
    count: item.id === "All" ? scope.length : scope.filter((entry) => entry.kind === item.id).length,
  }));
  const typesPresent = [...new Set(groups.map((g) => g.sourceType))];

  const renderEntry = (entry: KnowledgeEntry) => (
    <article className="glass-card knowledge-card" key={entry.id}>
      <div className="knowledge-card-top">
        <span className={`knowledge-kind kind-${entry.tone}`}>{entry.kind}</span>
        <div className="knowledge-actions">
          <button aria-label="Edit" onClick={() => setEditingId(editingId === entry.id ? null : entry.id)}>
            <Pencil size={14} />
          </button>
          <button aria-label="Delete" onClick={() => removeEntry(entry.id)}>
            <X size={15} />
          </button>
        </div>
      </div>
      {entry.heading && <h3>{entry.heading}</h3>}
      {editingId === entry.id ? (
        <textarea
          className="knowledge-edit"
          autoFocus
          value={edits[entry.id] ?? entry.text}
          onChange={(event) => setEdits((current) => ({ ...current, [entry.id]: event.target.value }))}
          onBlur={() => commitEdit(entry)}
        />
      ) : (
        <p className="knowledge-text">{entry.text}</p>
      )}
      <div className="knowledge-tags">
        {entry.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
      <div className="knowledge-footer">
        <button className="knowledge-source" onClick={() => onJumpToSource(entry.bookTitle, entry.page)}>
          <ExternalLink size={13} />
          {openGroup ? sourceLocation(entry) : `${entry.bookTitle || "Your library"} → ${sourceLocation(entry)}`}
        </button>
        <time>{knowledgeDate(entry.date)}</time>
      </div>
    </article>
  );

  const kindTabs = (
    <div className="library-categories knowledge-tabs" role="tablist">
      {knowledgeTabs
        // Kinds with nothing in them are noise ("Notes 0"); keep All and the
        // one currently selected so a filter never vanishes from under you.
        .filter(({ id }) => id === "All" || id === tab || (counts.find((c) => c.id === id)?.count ?? 0) > 0)
        .map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? "active" : ""}
          onClick={() => setTab(id)}
        >
          <Icon size={13} />
          {label}
          <kbd>{counts.find((count) => count.id === id)?.count ?? 0}</kbd>
        </button>
      ))}
    </div>
  );

  return (
    <div className="page-content knowledge-view">
      {openGroup ? (
        <header className="knowledge-group-head">
          <button className="knowledge-back" onClick={() => setGroupKey(null)} aria-label="Back to all sources">
            <ChevronLeft size={17} /> Sources
          </button>
          <div className="knowledge-group-hero">
            <SourceCover group={openGroup} size="large" />
            <div>
              <span className="eyebrow muted-eyebrow">{SOURCE_LABEL[openGroup.sourceType]}</span>
              <h1>{openGroup.title}</h1>
              <p className="page-meta">
                {openGroup.creator ? `${openGroup.creator} · ` : ""}
                {openGroup.entries.length} {openGroup.entries.length === 1 ? "item" : "items"}
                {openGroup.lastAt ? ` · updated ${knowledgeDate(new Date(openGroup.lastAt).toISOString())}` : ""}
              </p>
            </div>
          </div>
        </header>
      ) : (
        <header className="page-heading">
          <div>
            <div className="eyebrow muted-eyebrow">KNOWLEDGE</div>
            <h1>Everything you saved.</h1>
            <p className="page-meta">
              {(() => {
                const sources = groups.filter((g) => g.key !== UNSORTED_KEY).length;
                return `${sources} ${sources === 1 ? "source" : "sources"} · ${live.length} ${
                  live.length === 1 ? "entry" : "entries"
                }`;
              })()}
            </p>
          </div>
        </header>
      )}

      {(knowledge.error || editError) && (
        <div className="data-banner data-banner-error" role="alert">
          {knowledge.error ?? editError}
        </div>
      )}
      {knowledge.loading && !knowledge.error && (
        <div className="data-banner" aria-live="polite">
          <Loading variant="inline" size={18} text="Loading your knowledge…" />
        </div>
      )}

      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={openGroup ? `Search ${openGroup.title}` : "Search sources and notes"}
            aria-label="Search knowledge"
          />
        </label>
        {kindTabs}
        {!openGroup && (
          <div className="knowledge-group-controls">
            <div className="knowledge-type-filter" role="group" aria-label="Source type">
              {(["all", ...typesPresent] as ("all" | SourceType)[]).map((type) => (
                <button
                  key={type}
                  className={typeFilter === type ? "active" : ""}
                  aria-pressed={typeFilter === type}
                  onClick={() => setTypeFilter(type)}
                >
                  {type === "all" ? "All sources" : SOURCE_LABEL[type]}
                </button>
              ))}
            </div>
            <label className="knowledge-sort">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as GroupSort)}>
                <option value="recent">Recent</option>
                <option value="az">A–Z</option>
                <option value="count">Most items</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {openGroup ? (
        <div className="knowledge-list">
          {visible.map(renderEntry)}
          {visible.length === 0 && (
            <div className="library-empty">
              <Search size={20} />
              <strong>Nothing matches</strong>
              <span>Try another word or kind.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="knowledge-groups">
          {shownGroups.map((group) => (
            <button
              key={group.key}
              className="glass-card knowledge-group-card"
              onClick={() => setGroupKey(group.key)}
              aria-label={`${group.title}, ${group.entries.length} items`}
            >
              <SourceCover group={group} />
              <span className="knowledge-group-body">
                <span className="knowledge-group-type">{SOURCE_LABEL[group.sourceType]}</span>
                <strong>{group.title}</strong>
                {group.creator && <small className="knowledge-group-creator">{group.creator}</small>}
                <span className="knowledge-group-kinds">
                  {(Object.entries(group.kinds) as [KnowledgeKind, number][])
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([kind, n]) => `${n} ${kind.toLowerCase()}${n === 1 ? "" : "s"}`)
                    .join(" · ")}
                </span>
              </span>
              <span className="knowledge-group-count">
                {group.entries.length}
                <ChevronRight size={15} />
              </span>
            </button>
          ))}
          {shownGroups.length === 0 && !knowledge.loading && (
            <div className="library-empty">
              <Brain size={20} />
              <strong>{live.length ? "Nothing matches" : "Nothing saved yet"}</strong>
              <span>
                {live.length
                  ? "Try another word, kind or source type."
                  : "Highlights, notes and quotes group themselves by book, episode and article as you save them."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A book row's offline state: saved, downloading (with %), or failed. */
function OfflineRowBadge({ item }: { item: LibraryItem }) {
  const offline = useOfflineBooks();
  const state = offline.state(item);
  if (state.phase === "done") {
    return (
      <span className="offline-badge" title="Saved on this device — readable offline">
        <WifiOff size={11} /> Offline
      </span>
    );
  }
  if (state.phase === "downloading") {
    return (
      <span className="offline-badge pending" role="status">
        <Download size={11} /> {state.percent}%
      </span>
    );
  }
  if (state.phase === "failed") {
    return (
      <span className="offline-badge failed" title={state.reason} role="alert">
        Download failed
      </span>
    );
  }
  return null;
}

const SOURCE_LABEL: Record<SourceType, string> = {
  book: "Book",
  podcast: "Podcast",
  article: "Article",
  note: "Note",
  unknown: "Other",
};

const SOURCE_ICON: Record<SourceType, typeof BookOpen> = {
  book: BookOpen,
  podcast: Headphones,
  article: FileText,
  note: StickyNote,
  unknown: Brain,
};

/** A source's cover, or its type icon when it has none (or the image fails). */
function SourceCover({ group, size = "small" }: { group: KnowledgeGroup; size?: "small" | "large" }) {
  const [failed, setFailed] = useState(false);
  const Icon = SOURCE_ICON[group.sourceType];
  return (
    <span className={`knowledge-cover knowledge-cover-${size}`} aria-hidden="true">
      {group.cover && !failed ? (
        <img src={group.cover} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon size={size === "large" ? 26 : 18} />
      )}
    </span>
  );
}

// IllnessRecord / IllnessMedication / IllnessDocument now live in ./lib/useHealth.

const demoIllnessRecords: IllnessRecord[] = [
  {
    id: 1,
    name: "Seasonal influenza",
    startDate: "2025-01-12",
    endDate: "2025-01-20",
    status: "Recovered",
    severity: "Moderate",
    symptoms: ["Fever", "Dry cough", "Fatigue", "Body aches"],
    symptomStart: "2025-01-12",
    symptomSeverity: "Moderate",
    symptomNotes: "Fever was highest during the first two evenings.",
    doctor: "Riverside Family Clinic",
    diagnosis: "Influenza A, recorded by clinician",
    consultationDate: "2025-01-14",
    medicalNotes: "Rest, hydration, and symptom monitoring were recommended.",
    medications: [
      {
        name: "Oseltamivir",
        dosage: "75 mg",
        frequency: "Twice daily",
        startDate: "2025-01-14",
        endDate: "2025-01-19",
        reason: "As prescribed after consultation",
        observations: "Mild nausea on the first day.",
      },
      {
        name: "Paracetamol",
        dosage: "500 mg",
        frequency: "As recorded when needed",
        startDate: "2025-01-12",
        endDate: "2025-01-17",
        reason: "Fever and body aches",
      },
    ],
    documents: [{ name: "Clinic prescription.pdf", type: "Prescription" }],
    recoveryDate: "2025-01-20",
    recoveryHelp: "Rest, fluids, and gradually returning to normal activity.",
    recoveryNotes: "Energy returned slowly over several days after the fever ended.",
  },
  {
    id: 2,
    name: "Acute sinus infection",
    startDate: "2024-10-03",
    endDate: "2024-10-15",
    status: "Recovered",
    severity: "Mild",
    symptoms: ["Sinus pressure", "Headache", "Congestion"],
    symptomStart: "2024-10-03",
    symptomSeverity: "Mild",
    doctor: "Northside Medical Centre",
    diagnosis: "Acute sinusitis, recorded at consultation",
    consultationDate: "2024-10-07",
    medications: [
      {
        name: "Amoxicillin",
        dosage: "As recorded on prescription",
        frequency: "Three times daily",
        startDate: "2024-10-07",
        endDate: "2024-10-14",
        reason: "Recorded treatment for sinus infection",
      },
    ],
    documents: [],
    recoveryDate: "2024-10-15",
    recoveryHelp: "Warm showers, rest, and completing the recorded medication course.",
  },
  {
    id: 3,
    name: "COVID-19 episode",
    startDate: "2023-08-18",
    endDate: "2023-08-30",
    status: "Recovered",
    severity: "Moderate",
    symptoms: ["Sore throat", "Fever", "Loss of smell", "Fatigue"],
    symptomStart: "2023-08-18",
    symptomSeverity: "Moderate",
    symptomNotes: "Fatigue continued after the other symptoms improved.",
    diagnosis: "Positive home and laboratory test",
    consultationDate: "2023-08-21",
    medicalNotes: "Telephone consultation; personal record only.",
    medications: [
      {
        name: "Paracetamol",
        dosage: "500 mg",
        frequency: "As personally recorded",
        startDate: "2023-08-18",
        endDate: "2023-08-24",
        reason: "Fever",
      },
    ],
    documents: [
      { name: "Laboratory result.pdf", type: "Test report" },
      { name: "Consultation summary.pdf", type: "Medical note" },
    ],
    recoveryDate: "2023-08-30",
    recoveryHelp: "Rest and a gradual return to activity.",
    recoveryNotes: "Full sense of smell returned over the following month.",
  },
  {
    id: 4,
    name: "Food poisoning episode",
    startDate: "2022-05-09",
    status: "Incomplete record",
    severity: "Moderate",
    symptoms: ["Nausea", "Stomach cramps"],
    medications: [],
    documents: [],
    recoveryNotes: "Recovery date was not recorded.",
  },
];

const emptyIllnessForm = {
  name: "",
  startDate: "",
  endDate: "",
  severity: "",
  status: "Incomplete record",
  symptoms: "",
  symptomStart: "",
  symptomSeverity: "",
  symptomNotes: "",
  doctor: "",
  diagnosis: "",
  consultationDate: "",
  medicalNotes: "",
  medicine: "",
  dosage: "",
  frequency: "",
  medicationStart: "",
  medicationEnd: "",
  medicationReason: "",
  sideEffects: "",
  recoveryDate: "",
  recoveryHelp: "",
  recoveryNotes: "",
};

function displayHealthDate(value?: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function illnessDuration(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return "Not available";
  const milliseconds =
    new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round(milliseconds / 86_400_000) + 1);
  return `${days} days`;
}

function HealthView() {
  // Loaded from /health/records (mapped) when configured; else the demo seed.
  const health = useHealth(demoIllnessRecords);
  const records = health.records;
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("All years");
  const [status, setStatus] = useState("All statuses");
  const [selectedRecord, setSelectedRecord] = useState<IllnessRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyIllnessForm);
  const [documentNames, setDocumentNames] = useState<string[]>([]);
  const [savingMode, setSavingMode] = useState<"draft" | "final" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const years = Array.from(
    new Set(
      records
        .map((record) => record.startDate?.slice(0, 4))
        .filter((item): item is string => Boolean(item)),
    ),
  ).sort((a, b) => Number(b) - Number(a));
  const totalMedications = records.reduce((total, record) => total + record.medications.length, 0);
  const totalDocuments = records.reduce((total, record) => total + record.documents.length, 0);
  const visibleRecords = records
    .filter((record) => {
      const matchesQuery = `${record.name} ${record.symptoms.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesYear = year === "All years" || record.startDate?.startsWith(year);
      const matchesStatus = status === "All statuses" || record.status === status;
      return matchesQuery && matchesYear && matchesStatus;
    })
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  const updateForm = (field: keyof typeof emptyIllnessForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const closeForm = () => {
    if (savingMode) return;
    setShowForm(false);
    setEditingId(null);
    setForm(emptyIllnessForm);
    setDocumentNames([]);
    setFormError(null);
  };

  const saveIllness = async (asDraft: boolean) => {
    if (savingMode) return;
    setSavingMode(asDraft ? "draft" : "final");
    const existing = editingId === null ? null : records.find((item) => item.id === editingId);
    const record: IllnessRecord = {
      id: editingId ?? Date.now(),
      serverId: existing?.serverId,
      name: form.name.trim() || "Untitled illness record",
      startDate: form.startDate || undefined,
      endDate: form.endDate || form.recoveryDate || undefined,
      status: asDraft ? "Incomplete record" : (form.status as IllnessRecord["status"]),
      severity: form.severity || undefined,
      symptoms: form.symptoms
        .split(",")
        .map((symptom) => symptom.trim())
        .filter(Boolean),
      symptomStart: form.symptomStart || undefined,
      symptomSeverity: form.symptomSeverity || undefined,
      symptomNotes: form.symptomNotes || undefined,
      doctor: form.doctor || undefined,
      diagnosis: form.diagnosis || undefined,
      consultationDate: form.consultationDate || undefined,
      medicalNotes: form.medicalNotes || undefined,
      medications: form.medicine
        ? [
            {
              name: form.medicine,
              dosage: form.dosage || undefined,
              frequency: form.frequency || undefined,
              startDate: form.medicationStart || undefined,
              endDate: form.medicationEnd || undefined,
              reason: form.medicationReason || undefined,
              observations: form.sideEffects || undefined,
            },
            ...(editingId === null
              ? []
              : (records.find((item) => item.id === editingId)?.medications.slice(1) ?? [])),
          ]
        : editingId === null
          ? []
          : (records.find((item) => item.id === editingId)?.medications ?? []),
      documents: documentNames.map((name) => ({ name, type: "Uploaded document" })),
      recoveryDate: form.recoveryDate || undefined,
      recoveryHelp: form.recoveryHelp || undefined,
      recoveryNotes: form.recoveryNotes || undefined,
    };
    // A failed save used to reject out of the click handler: the modal stayed
    // open, the buttons stayed disabled and nothing said why.
    try {
      await health.saveRecord(record, editingId !== null);
      setFormError(null);
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "That record could not be saved.",
      );
      return;
    } finally {
      setSavingMode(null);
    }
    closeForm();
  };

  const editRecord = (record: IllnessRecord) => {
    const medication = record.medications[0];
    setEditingId(record.id);
    setForm({
      name: record.name,
      startDate: record.startDate ?? "",
      endDate: record.endDate ?? "",
      severity: record.severity ?? "",
      status: record.status,
      symptoms: record.symptoms.join(", "),
      symptomStart: record.symptomStart ?? "",
      symptomSeverity: record.symptomSeverity ?? "",
      symptomNotes: record.symptomNotes ?? "",
      doctor: record.doctor ?? "",
      diagnosis: record.diagnosis ?? "",
      consultationDate: record.consultationDate ?? "",
      medicalNotes: record.medicalNotes ?? "",
      medicine: medication?.name ?? "",
      dosage: medication?.dosage ?? "",
      frequency: medication?.frequency ?? "",
      medicationStart: medication?.startDate ?? "",
      medicationEnd: medication?.endDate ?? "",
      medicationReason: medication?.reason ?? "",
      sideEffects: medication?.observations ?? "",
      recoveryDate: record.recoveryDate ?? "",
      recoveryHelp: record.recoveryHelp ?? "",
      recoveryNotes: record.recoveryNotes ?? "",
    });
    setDocumentNames(record.documents.map((document) => document.name));
    setSelectedRecord(null);
    setShowForm(true);
  };

  const healthStats: { icon: typeof Home; value: number; label: string; tone: string }[] = [
    { icon: HeartPulse, value: records.length, label: "Total illnesses recorded", tone: "coral" },
    { icon: Pill, value: totalMedications, label: "Total medication records", tone: "lavender" },
    { icon: FileText, value: totalDocuments, label: "Medical documents uploaded", tone: "blue" },
  ];

  return (
    <div className="page-content foundation-view health-history-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">HEALTH</div>
          <h1>Your health history.</h1>
          <p className="page-meta">
            {records.length} {records.length === 1 ? "record" : "records"}
            {totalMedications > 0 ? ` · ${totalMedications} medications` : ""}
          </p>
        </div>
        <button className="primary-button" onClick={() => setShowForm(true)}>
          <Plus size={17} /> Add Previous Illness
        </button>
      </header>

      {health.error && (
        <div className="data-banner data-banner-error" role="alert">
          {health.error}
        </div>
      )}
      {health.loading && !health.error && (
        <div className="data-banner" aria-live="polite">
          <Loading variant="inline" size={18} text="Loading your health records…" />
        </div>
      )}

      <div className="health-privacy-note">
        <Archive size={17} />
        <p>
          <strong>Personal reference only.</strong> Not medical advice.
        </p>
      </div>

      <section className="health-overview">
        {healthStats.map(({ icon: Icon, value, label, tone }) => (
          <div className={`glass-card health-stat health-stat-${tone}`} key={label}>
            <span>
              <Icon size={18} />
            </span>
            <div>
              <strong>{value}</strong>
              <small>{label}</small>
            </div>
          </div>
        ))}
      </section>

      <section className="glass-card illness-history-card">
        <div className="illness-history-heading">
          <div>
            <span className="section-kicker">ILLNESS HISTORY</span>
            <h2>Previous sickness episodes</h2>
          </div>
          <span>{visibleRecords.length} records</span>
        </div>
        <div className="health-history-filters">
          <label>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search illness or symptom"
            />
          </label>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            <option>All years</option>
            {years.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All statuses</option>
            <option>Recovered</option>
            <option>Recovery ongoing</option>
            <option>Incomplete record</option>
          </select>
        </div>
        <div className="illness-timeline">
          {visibleRecords.map((record) => (
            <article className="illness-record-row" key={record.id}>
              <div className="illness-timeline-date">
                <strong>
                  {record.startDate
                    ? new Date(`${record.startDate}T00:00:00Z`).getUTCFullYear()
                    : "—"}
                </strong>
                <span>
                  {record.startDate
                    ? new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(
                        new Date(`${record.startDate}T00:00:00Z`),
                      )
                    : "Unknown"}
                </span>
              </div>
              <i
                className={`illness-timeline-dot status-${record.status
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              />
              <div className="illness-record-content">
                <div className="illness-record-title">
                  <div>
                    <h3>{record.name}</h3>
                    <p>
                      {displayHealthDate(record.startDate)} —{" "}
                      {record.endDate ? displayHealthDate(record.endDate) : "Recovery date unknown"}
                    </p>
                  </div>
                  <span
                    className={`recovery-status status-${record.status
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {record.status}
                  </span>
                </div>
                <div className="symptom-tags">
                  {record.symptoms.slice(0, 4).map((symptom) => (
                    <span key={symptom}>{symptom}</span>
                  ))}
                  {record.symptoms.length === 0 && <span>No symptoms recorded</span>}
                </div>
                <div className="illness-record-footer">
                  <span>
                    <Pill size={13} /> {record.medications.length} medication records
                  </span>
                  <button onClick={() => setSelectedRecord(record)}>
                    View details <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
          {visibleRecords.length === 0 && (
            <div className="health-empty-state">
              <Search size={21} />
              <strong>No illness records found</strong>
              <span>Try a different search, year, or recovery status.</span>
            </div>
          )}
        </div>
      </section>

      {selectedRecord && (
        <div className="modal-backdrop" onMouseDown={() => setSelectedRecord(null)}>
          <div className="health-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="section-kicker">ILLNESS RECORD</span>
                <h2>{selectedRecord.name}</h2>
                <p>
                  {displayHealthDate(selectedRecord.startDate)} · {selectedRecord.status}
                </p>
              </div>
              <IconButton label="Close" onClick={() => setSelectedRecord(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="health-detail-sections">
              <HealthDetailSection icon={ClipboardList} label="A" title="Basic information">
                <DetailGrid
                  items={[
                    ["Illness", selectedRecord.name],
                    ["Started", displayHealthDate(selectedRecord.startDate)],
                    ["Ended", displayHealthDate(selectedRecord.endDate)],
                    ["Duration", illnessDuration(selectedRecord.startDate, selectedRecord.endDate)],
                    ["Severity", selectedRecord.severity ?? "Not recorded"],
                    ["Recovery status", selectedRecord.status],
                  ]}
                />
              </HealthDetailSection>
              <HealthDetailSection icon={Thermometer} label="B" title="Symptoms">
                <div className="detail-tags">
                  {selectedRecord.symptoms.map((symptom) => (
                    <span key={symptom}>{symptom}</span>
                  ))}
                </div>
                <DetailGrid
                  items={[
                    ["Symptoms began", displayHealthDate(selectedRecord.symptomStart)],
                    ["Recorded severity", selectedRecord.symptomSeverity ?? "Not recorded"],
                    ["Observations", selectedRecord.symptomNotes ?? "Not recorded"],
                  ]}
                />
              </HealthDetailSection>
              <HealthDetailSection icon={Stethoscope} label="C" title="Medical consultation">
                <DetailGrid
                  items={[
                    ["Doctor or hospital", selectedRecord.doctor ?? "Not recorded"],
                    ["Consultation date", displayHealthDate(selectedRecord.consultationDate)],
                    ["Recorded diagnosis", selectedRecord.diagnosis ?? "Not recorded"],
                    ["Medical notes", selectedRecord.medicalNotes ?? "Not recorded"],
                  ]}
                />
              </HealthDetailSection>
              <HealthDetailSection icon={Pill} label="D" title="Medication history">
                {selectedRecord.medications.length ? (
                  selectedRecord.medications.map((medication, index) => (
                    <div className="medication-history-row" key={`${medication.name}-${index}`}>
                      <h4>{medication.name}</h4>
                      <DetailGrid
                        items={[
                          ["Dosage", medication.dosage ?? "Not recorded"],
                          ["Frequency", medication.frequency ?? "Not recorded"],
                          ["Start date", displayHealthDate(medication.startDate)],
                          ["End date", displayHealthDate(medication.endDate)],
                          ["Reason", medication.reason ?? "Not recorded"],
                          [
                            "Observations / side effects",
                            medication.observations ?? "Not recorded",
                          ],
                        ]}
                      />
                    </div>
                  ))
                ) : (
                  <p className="not-recorded">No medication was recorded for this illness.</p>
                )}
              </HealthDetailSection>
              <HealthDetailSection icon={FileText} label="E" title="Tests and documents">
                {/* Only the filename is recorded, so there is nothing to open —
                    these are a list, not buttons that do nothing. */}
                {selectedRecord.documents.length ? (
                  <div className="health-documents">
                    {selectedRecord.documents.map((document, index) => (
                      <div key={`${document.name}-${index}`}>
                        <FileText size={15} />
                        <span>
                          <strong>{document.name}</strong>
                          <small>{document.type}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="not-recorded">No medical documents were added.</p>
                )}
              </HealthDetailSection>
              <HealthDetailSection icon={CheckCircle2} label="F" title="Recovery notes">
                <DetailGrid
                  items={[
                    ["Recovery date", displayHealthDate(selectedRecord.recoveryDate)],
                    ["What helped", selectedRecord.recoveryHelp ?? "Not recorded"],
                    ["Personal observations", selectedRecord.recoveryNotes ?? "Not recorded"],
                  ]}
                />
              </HealthDetailSection>
            </div>
            <div className="health-detail-footer">
              <p>Personal historical record · Not medical advice</p>
              <button className="primary-button" onClick={() => editRecord(selectedRecord)}>
                <Pencil size={14} /> Update record
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onMouseDown={closeForm}>
          <div className="health-form-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="section-kicker">
                  {editingId ? "UPDATE HISTORY" : "ADD PREVIOUS ILLNESS"}
                </span>
                <h2>{editingId ? "Update illness record" : "Record a past illness"}</h2>
                <p>All fields are optional. Add only what you remember.</p>
              </div>
              <IconButton label="Close" onClick={closeForm}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="health-form-scroll">
              <HealthFormSection number="01" title="Basic information">
                <label className="field-label health-field-wide">
                  ILLNESS OR CONDITION
                  <input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="e.g. Seasonal influenza"
                  />
                </label>
                <div className="field-grid">
                  <HealthInput
                    label="DATE STARTED"
                    type="date"
                    value={form.startDate}
                    onChange={(value) => updateForm("startDate", value)}
                  />
                  <HealthInput
                    label="DATE ENDED"
                    type="date"
                    value={form.endDate}
                    onChange={(value) => updateForm("endDate", value)}
                  />
                  <HealthSelect
                    label="SEVERITY"
                    value={form.severity}
                    onChange={(value) => updateForm("severity", value)}
                    options={["", "Mild", "Moderate", "Severe"]}
                  />
                  <HealthSelect
                    label="RECOVERY STATUS"
                    value={form.status}
                    onChange={(value) => updateForm("status", value)}
                    options={["Recovered", "Recovery ongoing", "Incomplete record"]}
                  />
                </div>
              </HealthFormSection>
              <HealthFormSection number="02" title="Symptoms">
                <label className="field-label health-field-wide">
                  SYMPTOMS — SEPARATE WITH COMMAS
                  <input
                    value={form.symptoms}
                    onChange={(event) => updateForm("symptoms", event.target.value)}
                    placeholder="Fever, cough, fatigue"
                  />
                </label>
                <div className="field-grid">
                  <HealthInput
                    label="SYMPTOMS STARTED"
                    type="date"
                    value={form.symptomStart}
                    onChange={(value) => updateForm("symptomStart", value)}
                  />
                  <HealthSelect
                    label="PERSONALLY RECORDED SEVERITY"
                    value={form.symptomSeverity}
                    onChange={(value) => updateForm("symptomSeverity", value)}
                    options={["", "Mild", "Moderate", "Severe"]}
                  />
                </div>
                <HealthTextarea
                  label="ADDITIONAL OBSERVATIONS"
                  value={form.symptomNotes}
                  onChange={(value) => updateForm("symptomNotes", value)}
                />
              </HealthFormSection>
              <HealthFormSection number="03" title="Medical consultation">
                <div className="field-grid">
                  <HealthInput
                    label="DOCTOR OR HOSPITAL"
                    value={form.doctor}
                    onChange={(value) => updateForm("doctor", value)}
                  />
                  <HealthInput
                    label="CONSULTATION DATE"
                    type="date"
                    value={form.consultationDate}
                    onChange={(value) => updateForm("consultationDate", value)}
                  />
                </div>
                <HealthInput
                  label="DIAGNOSIS AS RECORDED"
                  value={form.diagnosis}
                  onChange={(value) => updateForm("diagnosis", value)}
                  wide
                />
                <HealthTextarea
                  label="MEDICAL NOTES"
                  value={form.medicalNotes}
                  onChange={(value) => updateForm("medicalNotes", value)}
                />
              </HealthFormSection>
              <HealthFormSection number="04" title="Medication details">
                <div className="field-grid">
                  <HealthInput
                    label="MEDICINE NAME"
                    value={form.medicine}
                    onChange={(value) => updateForm("medicine", value)}
                  />
                  <HealthInput
                    label="DOSAGE"
                    value={form.dosage}
                    onChange={(value) => updateForm("dosage", value)}
                  />
                  <HealthInput
                    label="FREQUENCY"
                    value={form.frequency}
                    onChange={(value) => updateForm("frequency", value)}
                  />
                  <HealthInput
                    label="REASON FOR TAKING IT"
                    value={form.medicationReason}
                    onChange={(value) => updateForm("medicationReason", value)}
                  />
                  <HealthInput
                    label="START DATE"
                    type="date"
                    value={form.medicationStart}
                    onChange={(value) => updateForm("medicationStart", value)}
                  />
                  <HealthInput
                    label="END DATE"
                    type="date"
                    value={form.medicationEnd}
                    onChange={(value) => updateForm("medicationEnd", value)}
                  />
                </div>
                <HealthTextarea
                  label="PERSONAL OBSERVATIONS OR SIDE EFFECTS"
                  value={form.sideEffects}
                  onChange={(value) => updateForm("sideEffects", value)}
                />
              </HealthFormSection>
              <HealthFormSection number="05" title="Tests and documents">
                <label className="health-upload">
                  <Upload size={18} />
                  <span>
                    <strong>Add medical documents</strong>
                    <small>Prescription, blood test, scan, or other report · Demo only</small>
                  </span>
                  <input
                    type="file"
                    multiple
                    onChange={(event) =>
                      setDocumentNames(
                        Array.from(event.target.files ?? []).map((file) => file.name),
                      )
                    }
                  />
                </label>
                {documentNames.length > 0 && (
                  <div className="uploaded-file-list">
                    {documentNames.map((name) => (
                      <span key={name}>
                        <FileText size={12} /> {name}
                      </span>
                    ))}
                  </div>
                )}
              </HealthFormSection>
              <HealthFormSection number="06" title="Recovery notes">
                <HealthInput
                  label="RECOVERY DATE"
                  type="date"
                  value={form.recoveryDate}
                  onChange={(value) => updateForm("recoveryDate", value)}
                  wide
                />
                <HealthTextarea
                  label="WHAT HELPED DURING RECOVERY"
                  value={form.recoveryHelp}
                  onChange={(value) => updateForm("recoveryHelp", value)}
                />
                <HealthTextarea
                  label="ADDITIONAL PERSONAL OBSERVATIONS"
                  value={form.recoveryNotes}
                  onChange={(value) => updateForm("recoveryNotes", value)}
                />
              </HealthFormSection>
            </div>
            <div className="health-form-footer">
              {formError && (
                <p className="composer-error" role="alert">
                  {formError}
                </p>
              )}
              <button
                className="secondary-button"
                onClick={() => saveIllness(true)}
                disabled={savingMode !== null}
                aria-busy={savingMode === "draft"}
              >
                {savingMode === "draft" ? <Spinner /> : <Save size={14} />}
                {savingMode === "draft" ? "Saving…" : "Save incomplete"}
              </button>
              <button
                className="primary-button"
                onClick={() => saveIllness(false)}
                disabled={savingMode !== null}
                aria-busy={savingMode === "final"}
              >
                {savingMode === "final" ? <Spinner /> : <Check size={14} />}
                {savingMode === "final" ? "Saving…" : "Save record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HealthDetailSection({
  icon: Icon,
  label,
  title,
  children,
}: {
  icon: typeof Home;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="health-detail-section">
      <div className="health-detail-section-title">
        <span>{label}</span>
        <Icon size={16} />
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function DetailGrid({ items }: { items: string[][] }) {
  return (
    <div className="health-detail-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <p>{value}</p>
        </div>
      ))}
    </div>
  );
}

function HealthFormSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="health-form-section">
      <div className="health-form-section-title">
        <span>{number}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function HealthInput({
  label,
  value,
  onChange,
  type = "text",
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field-label ${wide ? "health-field-wide" : ""}`}>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function HealthSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="field-label">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option} key={option || "empty"}>
            {option || "Not recorded"}
          </option>
        ))}
      </select>
    </label>
  );
}

function HealthTextarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label health-field-wide">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * Web-push state, said plainly. "Blocked" and "Unavailable" are different
 * problems — one the user can undo in their browser, one they cannot — so the
 * panel never collapses them into a single "off".
 */
const PUSH_LABELS: Record<PushStatus, string> = {
  checking: "Checking…",
  unsupported: "Unavailable",
  idle: "Off",
  denied: "Blocked",
  subscribing: "Enabling…",
  subscribed: "On",
  error: "Something went wrong",
};

function SettingsView({
  books,
  onUpdateBookStorage,
  colorMode,
  onToggleColor,
  onSignOut,
  userEmail,
  notifications,
  profile,
}: {
  books: LibraryItem[];
  onUpdateBookStorage: (
    title: string,
    newStorageOption: "device" | "sync",
    syncStatus: "local" | "synced",
    lastSyncedAt?: string,
  ) => void;
  colorMode: boolean;
  onToggleColor: () => void;
  onSignOut: () => void;
  userEmail: string | null;
  notifications: NotificationsState;
  /** Shared with App, which needs it for Color Mode — one GET /me, not two. */
  profile: ProfileState;
}) {
  const [showStorage, setShowStorage] = useState(false);
  // Coming back from Google's consent screen lands here with Mail open, so the
  // result is shown where the user started.
  const [open, setOpen] = useState<
    "profile" | "notifications" | "mail" | "privacy" | null
  >(() => (isGmailReturn() ? "mail" : null));
  // Web push is disabled inside the native shell: the shell already runs its
  // own `registerForPush()` and `armUpcoming()`, so leaving this on would make
  // every notification arrive twice, drifting apart over time. The native clock
  // owns notifications in the app. (Android upgrade §2 — not optional.)
  const push = usePush(!!userEmail && !inShell);
  const phone = useShellNotifications(!!userEmail && open === "notifications");
  const gmail = useGmail(!!userEmail);
  // The access a new mailbox is connected with — read-only, or read + send.
  // Read + send by default: scheduled emails need send access, and every send
  // is still either scheduled by you or approved by you.
  const [mailMode, setMailMode] = useState<GmailAccessLevel>("send");
  // The in-app Google OAuth app credentials form. Write-only: never pre-filled
  // from the server, since the secret is never returned.
  const [oauthForm, setOauthForm] = useState({ client_id: "", client_secret: "" });
  const [testTo, setTestTo] = useState("");
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [savedNote, setSavedNote] = useState(false);

  // Fill the fields once the server's copy arrives.
  useEffect(() => {
    if (!profile.loaded) return;
    setName(profile.profile.display_name);
    setTimezone(profile.profile.timezone);
  }, [profile.loaded, profile.profile.display_name, profile.profile.timezone]);

  const noteTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const saveProfile = async () => {
    await profile.save({
      display_name: name.trim(),
      timezone: timezone.trim() || browserTimezone(),
    });
    setSavedNote(true);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setSavedNote(false), 2200);
  };

  if (showStorage) {
    return (
      <div className="page-content foundation-view storage-sync-view">
        <StorageSyncView
          books={books.filter((item) => item.type === "Books")}
          onUpdateBookStorage={onUpdateBookStorage}
          onBack={() => setShowStorage(false)}
          colorMode={colorMode}
        />
      </div>
    );
  }

  const liveLabel =
    notifications.live === "live"
      ? "Connected"
      : notifications.live === "connecting"
        ? "Connecting…"
        : "Not connected";

  return (
    <div className="page-content foundation-view settings-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">SETTINGS</div>
          <h1>Make MyPro yours.</h1>
        </div>
      </header>

      {profile.error && (
        <div className="data-banner data-banner-error" role="alert">
          {profile.error}
        </div>
      )}

      <div className="glass-card settings-card">
        {/* ---- Profile & preferences ---- */}
        <button
          onClick={() => setOpen((current) => (current === "profile" ? null : "profile"))}
          aria-expanded={open === "profile"}
        >
          <span>Profile &amp; preferences</span>
          <small>{profile.loading ? "Loading…" : name || userEmail || "Set up"}</small>
          <ChevronRight size={17} className={open === "profile" ? "rotated" : ""} />
        </button>
        {open === "profile" && (
          <div className="settings-panel">
            <label className="field-label">
              DISPLAY NAME
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="What should your companion call you?"
              />
            </label>
            <label className="field-label">
              TIME ZONE
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder={browserTimezone()}
              />
            </label>
            <p className="settings-hint">
              Schedules and briefs are timed against this. Your browser says{" "}
              <strong>{browserTimezone()}</strong>.
            </p>
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={colorMode}
                onChange={() => {
                  onToggleColor();
                  void profile.save({ color_mode: !colorMode });
                }}
              />
              <span>
                <strong>Color Mode</strong>
                <small>Accents warm up across the app. Saved to your profile.</small>
              </span>
            </label>
            <div className="settings-panel-actions">
              {savedNote && <span className="settings-saved">Saved</span>}
              <button className="primary-button" onClick={saveProfile} disabled={profile.saving}>
                {profile.saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        )}

        {/* ---- Notifications ---- */}
        <button
          onClick={() =>
            setOpen((current) => (current === "notifications" ? null : "notifications"))
          }
          aria-expanded={open === "notifications"}
        >
          <span>Notifications</span>
          <small>
            {liveLabel}
            {notifications.unread > 0 ? ` · ${notifications.unread} unread` : ""}
          </small>
          <ChevronRight size={17} className={open === "notifications" ? "rotated" : ""} />
        </button>
        {open === "notifications" && (
          <div className="settings-panel">
            <div className="settings-status-row">
              <span className={`settings-status-dot live-${notifications.live}`} aria-hidden="true" />
              <div>
                <strong>In-app notifications — {liveLabel}</strong>
                <small>Briefs and nudges arrive the moment they are written.</small>
              </div>
            </div>
            <div className="settings-panel-actions">
              <button
                className="secondary-button"
                onClick={() => void notifications.markAllRead()}
                disabled={notifications.unread === 0}
              >
                Mark all read
              </button>
              <button className="secondary-button" onClick={notifications.reload}>
                Refresh
              </button>
            </div>
            {inShell ? (
              /* In the app, the native clock owns notifications: it arms event
                 reminders and the brief on the device. Web push is off here
                 (it would double every alert), so offer a test instead. */
              <>
                <div className="settings-status-row">
                  <span
                    className={`settings-status-dot ${
                      phone.status?.permission === "granted"
                        ? "live-live"
                        : phone.status
                          ? "push-denied"
                          : "live-connecting"
                    }`}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>
                      On this phone —{" "}
                      {!phone.status
                        ? "checking…"
                        : phone.status.permission === "granted"
                          ? "allowed"
                          : "turned off"}
                    </strong>
                    <small>
                      {phone.status?.permission === "granted"
                        ? `Reminders, event alerts and your brief are scheduled on the device, so they arrive with the app closed${
                            phone.status.armed ? ` (${phone.status.armed} scheduled for the next 7 days)` : ""
                          }. They show as pop-ups and on the lock screen as your Android settings allow.`
                        : phone.status
                          ? "Android is blocking MyPro's notifications, so reminders cannot appear. Allow them to fix this."
                          : "Asking the phone…"}
                    </small>
                  </div>
                </div>
                {phone.status && phone.status.permission === "granted" && (
                  <div className="settings-status-row">
                    <span
                      className={`settings-status-dot ${
                        phone.status.push === "ready" ? "live-live" : "live-offline"
                      }`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>
                        Instant alerts — {phone.status.push === "ready" ? "on" : "unavailable"}
                      </strong>
                      <small>
                        {phone.status.push === "ready"
                          ? "Finished AI tasks and sent emails reach you even with the app closed."
                          : (phone.status.pushReason ??
                            "Finished AI tasks show here and in the app; scheduled reminders are unaffected.")}
                      </small>
                    </div>
                  </div>
                )}
                <div className="settings-panel-actions">
                  {phone.status && phone.status.permission !== "granted" ? (
                    <button className="primary-button" onClick={phone.fix}>
                      {phone.status.canAskAgain ? "Allow notifications" : "Open Android settings"}
                    </button>
                  ) : (
                    <button className="primary-button" onClick={phone.sendTest}>
                      Send a test notification
                    </button>
                  )}
                  <button className="secondary-button" onClick={phone.fix}>
                    Notification settings
                  </button>
                </div>
                {phone.status?.lastArm && (
                  <p className={`settings-hint ${phone.status.lastArm.error ? "settings-hint-error" : ""}`}>
                    {phone.status.lastArm.error
                      ? phone.status.lastArm.error
                      : `Reminders synced to this phone ${new Date(phone.status.lastArm.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} — ${phone.status.lastArm.armed} scheduled for the next 7 days.`}
                  </p>
                )}
                {phone.testNote && <p className="settings-hint">{phone.testNote}</p>}
                <p className="settings-hint">
                  Pop-ups not showing? In Android Settings → Notifications → MyPro, set the
                  “Reminders” category to “Pop on screen”, and turn off battery optimisation for
                  MyPro if alerts arrive late.
                </p>
              </>
            ) : (
              <>
                <div className="settings-status-row">
                  <span
                    className={`settings-status-dot push-${push.status}`}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>When the app is closed — {PUSH_LABELS[push.status]}</strong>
                    <small>
                      {push.reason ??
                        (push.status === "subscribed"
                          ? "This browser will show notifications even with every MyPro tab closed."
                          : "Allow notifications and this browser will hear from MyPro even when no tab is open.")}
                    </small>
                  </div>
                </div>
                <div className="settings-panel-actions">
                  {push.status === "idle" && (
                    <button className="primary-button" onClick={() => void push.subscribe()}>
                      Enable push
                    </button>
                  )}
                  {push.status === "subscribing" && (
                    <button className="primary-button" disabled>
                      Enabling…
                    </button>
                  )}
                  {push.status === "subscribed" && (
                    <button className="secondary-button" onClick={() => void push.unsubscribe()}>
                      Turn push off
                    </button>
                  )}
                  {push.status === "error" && (
                    <button className="secondary-button" onClick={() => void push.subscribe()}>
                      Try again
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- Mail (Phase 7) ---- */}
        <button
          onClick={() => setOpen((current) => (current === "mail" ? null : "mail"))}
          aria-expanded={open === "mail"}
        >
          <span>Mail</span>
          <small>
            {gmail.loading
              ? "Checking…"
              : !gmail.configured
                ? "Not available"
                : gmail.accounts.length
                  ? `${gmail.accounts.length} connected`
                  : "Not connected"}
          </small>
          <ChevronRight size={17} className={open === "mail" ? "rotated" : ""} />
        </button>
        {open === "mail" && (
          <div className="settings-panel">
            {/* Connection status first: what a person actually wants to know. */}
            {gmail.loading ? (
              <Loading variant="inline" size={16} text="Checking your mailboxes…" />
            ) : gmail.statusError ? (
              /* The check failed — that says nothing about the server's setup. */
              <>
                <div className="settings-status-row">
                  <span className="settings-status-dot push-error" aria-hidden="true" />
                  <div>
                    <strong>Couldn’t check your Gmail connection</strong>
                    <small>{gmail.statusError} The server may be waking up — try again in a moment.</small>
                  </div>
                </div>
                <div className="settings-panel-actions">
                  <button className="secondary-button" onClick={gmail.reload}>
                    Try again
                  </button>
                </div>
              </>
            ) : !gmail.configured ? (
              /* Not set up: the one-time setup form, right here — not hidden
                 behind a collapsed "Developer setup" line nobody noticed. */
              <div className="gmail-setup">
                <div className="settings-status-row">
                  <span className="settings-status-dot push-denied" aria-hidden="true" />
                  <div>
                    <strong>Set up Gmail (one time)</strong>
                    <small>
                      Paste your Google OAuth client below. The secret is encrypted on the server
                      and never shown again. After this you’ll just tap “Connect Gmail” and sign in
                      with Google.
                    </small>
                  </div>
                </div>
                {gmail.missing.some((name) => name.startsWith("migration")) && (
                  <p className="settings-hint settings-hint-error">
                    Saving it here needs the database update <code>0021_google_oauth_config.sql</code>{" "}
                    — run it in the Supabase SQL editor first, or set <code>GOOGLE_CLIENT_ID</code> and{" "}
                    <code>GOOGLE_CLIENT_SECRET</code> on Render instead.
                  </p>
                )}
                    <ol className="settings-steps">
                  <li>
                    In Google Cloud Console, enable the <strong>Gmail API</strong> and set up the
                    OAuth consent screen (add yourself as a test user, or publish the app).
                  </li>
                  <li>
                    Create an OAuth client of type <strong>Web application</strong> and add the
                    redirect URI below as an <em>Authorised redirect URI</em>.
                  </li>
                  <li>
                    Copy its <strong>Client ID</strong> and <strong>Client secret</strong> into the fields
                    below and tap <strong>Save Google app</strong>. (Or set <code>GOOGLE_CLIENT_ID</code> /{" "}
                    <code>GOOGLE_CLIENT_SECRET</code> on Render instead.)
                  </li>
                </ol>
                {gmail.redirectUri ? (
                  <div className="field-label">
                    AUTHORISED REDIRECT URI (ADD THIS IN GOOGLE CLOUD)
                    <div className="link-input copy-field">
                      <input value={gmail.redirectUri} readOnly aria-readonly="true" />
                      <button
                        type="button"
                        className="settings-inline-action"
                        onClick={() => void navigator.clipboard?.writeText(gmail.redirectUri ?? "")}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="settings-hint settings-hint-error">
                    The server can’t tell its own public address. Set{" "}
                    <code>PUBLIC_API_URL</code> on the API, then reload.
                  </p>
                )}
                <label className="field-label">
                  CLIENT ID
                  <input
                    value={oauthForm.client_id}
                    onChange={(e) => setOauthForm((f) => ({ ...f, client_id: e.target.value }))}
                    placeholder="xxxxxxxx.apps.googleusercontent.com"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field-label">
                  CLIENT SECRET
                  <input
                    type="password"
                    value={oauthForm.client_secret}
                    onChange={(e) =>
                      setOauthForm((f) => ({ ...f, client_secret: e.target.value }))
                    }
                    placeholder="GOCSPX-…"
                    autoComplete="off"
                  />
                </label>
                <div className="settings-panel-actions">
                  <button
                    className="primary-button"
                    disabled={
                      gmail.busy ||
                      !gmail.redirectUri ||
                      !oauthForm.client_id.trim() ||
                      !oauthForm.client_secret.trim()
                    }
                    onClick={async () => {
                      await gmail.saveOauthConfig({
                        client_id: oauthForm.client_id.trim(),
                        client_secret: oauthForm.client_secret.trim(),
                      });
                      setOauthForm({ client_id: "", client_secret: "" });
                    }}
                  >
                    {gmail.busy ? "Saving…" : "Save Google app"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {gmail.accounts.map((account) => {
                  const canSend = gmailScopesGrantSend(account.scopes);
                  const broken = account.sync_state === "error";
                  return (
                    <div className="settings-status-row" key={account.id}>
                      <span
                        className={`settings-status-dot mail-${account.sync_state}`}
                        aria-hidden="true"
                      />
                      <div>
                        <strong>{account.email}</strong>
                        <small>
                          <span className={`mail-access-tag ${canSend ? "send" : "read"}`}>
                            {canSend ? "Can send" : "Read only"}
                          </span>
                          {broken
                            ? ` · Needs attention: ${account.sync_error ?? "reconnect this mailbox"}`
                            : account.history_id
                              ? " · Connected and syncing."
                              : " · Connected. Sync to pull in your recent mail."}
                        </small>
                      </div>
                      <button
                        className="settings-inline-action"
                        onClick={() => void gmail.disconnect(account.id)}
                        disabled={gmail.busy}
                      >
                        Disconnect
                      </button>
                    </div>
                  );
                })}

                {!gmail.accounts.length && (
                  <p className="settings-hint">
                    Connect Gmail so your companion can triage your inbox and send the
                    emails you schedule. You’ll sign in with Google — nothing to configure.
                  </p>
                )}

                <div className="settings-panel-actions">
                  <button
                    className="primary-button"
                    onClick={() => void gmail.connect(mailMode)}
                    disabled={gmail.busy}
                  >
                    {gmail.busy
                      ? "Opening Google…"
                      : gmail.accounts.length
                        ? "Connect another"
                        : "Connect Gmail"}
                  </button>
                  {gmail.accounts.length > 0 && (
                    <button
                      className="secondary-button"
                      onClick={() => void gmail.sync()}
                      disabled={gmail.busy}
                    >
                      Sync now
                    </button>
                  )}
                </div>

                {/* A real send, right now, through the same path every email takes. */}
                {gmail.accounts.some((a) => gmailScopesGrantSend(a.scopes)) && (
                  <div className="mail-test">
                    <strong>Test sending</strong>
                    <small>
                      Sends a real email now — no approval step — so you can confirm sending works.
                      Leave the address empty to send it to yourself.
                    </small>
                    <div className="mail-test-row">
                      <input
                        type="email"
                        inputMode="email"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder={gmail.accounts.find((a) => gmailScopesGrantSend(a.scopes))?.email ?? "you@gmail.com"}
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        aria-label="Send the test email to"
                      />
                      <button
                        className="secondary-button"
                        disabled={gmail.busy || (testTo.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim()))}
                        onClick={() => void gmail.testSend(testTo.trim() || undefined)}
                      >
                        {gmail.busy ? "Sending…" : "Send test email"}
                      </button>
                    </div>
                    {gmail.testResult && (
                      <p
                        className={`settings-hint ${gmail.testResult.ok ? "" : "settings-hint-error"}`}
                        role="status"
                      >
                        {gmail.testResult.ok ? "✓ " : ""}
                        {gmail.testResult.message}
                      </p>
                    )}
                  </div>
                )}

                {/* Access level for the next mailbox. Per-account: one inbox
                    can be read-only while another may send scheduled email. */}
                <label className="schedule-confirm-row">
                  <input
                    type="checkbox"
                    checked={mailMode === "read"}
                    onChange={(e) => setMailMode(e.target.checked ? "read" : "send")}
                    disabled={gmail.busy}
                  />
                  <span>
                    <strong>Read only</strong>
                    <small>
                      {mailMode === "read"
                        ? "MyPro can read and triage this mailbox but never send from it — scheduled emails won’t work."
                        : "Leave off to let MyPro send the emails you schedule or approve."}
                    </small>
                  </span>
                </label>
              </>
            )}

            {(gmail.note || gmail.error) && (
              <p className={`settings-hint ${gmail.error ? "settings-hint-error" : ""}`} role="status">
                {gmail.error ?? gmail.note}
              </p>
            )}

            {/* Saved in-app: a way to remove/replace it, tucked away. */}
            {!gmail.loading && !gmail.statusError && gmail.configured && gmail.source === "settings" && (
              <details className="settings-advanced">
                <summary>
                  Google app settings <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className="settings-status-row">
                  <div>
                    <strong>Google app stored encrypted on the server</strong>
                    <small>The client secret is never shown. Remove it to enter a different one.</small>
                  </div>
                  <button
                    className="settings-inline-action"
                    onClick={() => void gmail.deleteOauthConfig()}
                    disabled={gmail.busy}
                  >
                    Remove
                  </button>
                </div>
              </details>
            )}
          </div>
        )}

        {/* ---- Storage ---- */}
        <button onClick={() => setShowStorage(true)}>
          <span>Storage &amp; sync</span>
          <small>Manage</small>
          <ChevronRight size={17} />
        </button>

        {/* ---- Privacy ---- */}
        <button
          onClick={() => setOpen((current) => (current === "privacy" ? null : "privacy"))}
          aria-expanded={open === "privacy"}
        >
          <span>Privacy &amp; security</span>
          <small>Protected</small>
          <ChevronRight size={17} className={open === "privacy" ? "rotated" : ""} />
        </button>
        {open === "privacy" && (
          <div className="settings-panel">
            <ul className="settings-facts">
              <li>
                <strong>Your rows are yours.</strong> Row-level security, default deny.
              </li>
              <li>
                <strong>Health needs consent.</strong> A time-boxed grant, enforced in the
                database.
              </li>
              <li>
                <strong>The model key stays on your laptop.</strong> Chat never runs on the
                server.
              </li>
              <li>
                <strong>PDFs never leave your device.</strong> Only extracted text syncs.
              </li>
            </ul>
            <p className="settings-hint">
              <strong>Planned:</strong> health-grant review and a full data export.
            </p>
          </div>
        )}
      </div>

      <div className="glass-card settings-card">
        <button className="settings-signout" onClick={onSignOut}>
          <LogOut size={17} />
          <span>Sign out</span>
          <small>{userEmail ?? ""}</small>
        </button>
      </div>
    </div>
  );
}

/* ---------- Page transition system ---------- */

const PAGE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ENTER_DURATION = 720;
const ENTER_OFFSET = 20;
const EXIT_DURATION = 240;
const SECTION_STAGGER = 85;
const ITEM_STAGGER = 40;
const MAX_DELAY = 720;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Containers whose children should reveal individually, in reading order.
const SECTION_GROUPS =
  ".day-grid, .dashboard-lower, .library-toolbar, .library-primary-grid, .library-secondary-grid, .health-overview, .calendar-layout";
// Small repeated elements that unfold after their parent section.
const SMALL_ITEMS = [
  ".agenda-row",
  ".free-time",
  ".focus-card > *",
  ".mail-content > *",
  ".book-row",
  ".mini-month-title",
  ".mini-month",
  ".week-header > div",
  ".calendar-event",
  ".month-event",
  ".mobile-day-strip button",
  ".mobile-agenda-event",
  ".all-day-row",
  ".library-categories button",
  ".library-filters button",
  ".learning-row",
  ".recent-note-row",
  ".collection-row",
  ".history-row",
  ".health-stat > *",
  ".health-history-filters",
  ".illness-record-row",
  ".settings-card button",
].join(", ");
const NEVER_ANIMATE = ".modal-backdrop, .app-toast";

/**
 * Reveals a page from top to bottom: title, then subtitle and controls, then
 * sections, then the small items inside each section. Animations use
 * fill "backwards" so finished elements keep their own styles (no lingering
 * transforms that would affect fixed-position dialogs).
 */
function revealPage(root: HTMLElement): Animation[] {
  const animations: Animation[] = [];
  const reveal = (element: Element, delay: number, offset = ENTER_OFFSET) => {
    if (!(element instanceof HTMLElement) || element.closest(NEVER_ANIMATE)) return;
    animations.push(
      element.animate(
        [
          { opacity: 0, transform: `translateY(${offset}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: ENTER_DURATION,
          delay: Math.min(delay, MAX_DELAY),
          easing: PAGE_EASE,
          fill: "backwards",
        },
      ),
    );
  };

  if (prefersReducedMotion()) {
    animations.push(
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }),
    );
    return animations;
  }

  // AI Assistant: the Rolling Cubes keep playing; only the copy and composer unfold.
  if (root.classList.contains("assistant-stage")) {
    let delay = 0;
    root
      .querySelectorAll(
        ".assistant-top, .assistant-intro > .section-kicker, .assistant-intro > h1, .assistant-intro > p, .conversation, .composer",
      )
      .forEach((element) => {
        reveal(element, delay, element.matches(".composer") ? 14 : ENTER_OFFSET);
        delay += SECTION_STAGGER;
      });
    return animations;
  }

  const content = root.querySelector(".page-content") ?? root;
  const heading = content.querySelector(":scope > .page-heading");
  if (heading) {
    heading
      .querySelectorAll(".eyebrow, h1")
      .forEach((element, index) => reveal(element, index * 50));
    heading
      .querySelectorAll("p, :scope > .primary-button, .calendar-actions")
      .forEach((element, index) => reveal(element, 110 + index * 50));
  }

  const sections: Element[] = [];
  Array.from(content.children).forEach((child) => {
    if (child === heading || child.matches(NEVER_ANIMATE)) return;
    if (child.matches(SECTION_GROUPS)) sections.push(...Array.from(child.children));
    else sections.push(child);
  });

  sections.forEach((section, index) => {
    const sectionDelay = 190 + index * SECTION_STAGGER;
    reveal(section, sectionDelay);
    Array.from(section.querySelectorAll(SMALL_ITEMS))
      .slice(0, 10)
      .forEach((item, itemIndex) =>
        reveal(item, sectionDelay + 120 + itemIndex * ITEM_STAGGER, 10),
      );
  });

  return animations;
}

function hidePage(root: HTMLElement): Animation {
  const reduced = prefersReducedMotion();
  return root.animate(
    [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: reduced ? "translateY(0)" : "translateY(-10px)" },
    ],
    {
      duration: reduced ? 120 : EXIT_DURATION,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    },
  );
}

/* ---------- Login entrance choreography ---------- */

const DROP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Plays once when the login page appears. The cubes run inside the Lottie
 * intro; everything else descends into place on this timeline. Uses fill
 * "backwards" so controls stay fully interactive and keep their own styles.
 */
function runLoginEntrance(root: HTMLElement, phase: "top" | "content"): Animation[] {
  const animations: Animation[] = [];
  const query = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));

  if (prefersReducedMotion()) {
    if (phase === "top")
      animations.push(
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" }),
      );
    return animations;
  }

  const descend = (
    elements: HTMLElement[],
    start: number,
    { offset = -15, duration = 680, stagger = 100, settle = false } = {},
  ) =>
    elements.forEach((element, index) => {
      const frames: Keyframe[] = settle
        ? [
            { opacity: 0, transform: `translateY(${offset}px)` },
            { opacity: 1, transform: "translateY(2px)", offset: 0.72 },
            { opacity: 1, transform: "translateY(0)" },
          ]
        : [
            { opacity: 0, transform: `translateY(${offset}px)` },
            { opacity: 1, transform: "translateY(0)" },
          ];
      animations.push(
        element.animate(frames, {
          duration,
          delay: start + index * stagger,
          easing: DROP_EASE,
          fill: "backwards",
        }),
      );
    });

  if (phase === "top") {
    // On first paint: logo settles, top control follows.
    descend(query(".login-topbar .brand"), 0, { offset: -35, duration: 700, settle: true });
    descend(query(".login-topbar .welcome-color-toggle"), 160, { offset: -12, duration: 560 });
    return animations;
  }

  // Timed from the moment the cubes begin to fall (first lands at ~1.1s).
  // 700–1300ms: welcome copy, then the three product blocks.
  descend(
    query(".login-introduction > .eyebrow, .login-introduction > h1, .login-introduction > p"),
    700,
  );
  query(".login-pillars").forEach((element) =>
    animations.push(
      element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 600,
        delay: 950,
        easing: "ease-out",
        fill: "backwards",
      }),
    ),
  );
  descend(query(".login-pillars > div"), 1000);

  // 900–1700ms: the card descends, then its contents in reading order.
  descend(query(".login-panel"), 900, { offset: -35, duration: 760, settle: true });
  descend(
    query(
      ".login-panel-heading > *, .login-panel > .auth-button, .login-panel > .login-separator, .login-panel > .email-auth-form, .login-panel > .account-switch, .login-panel > .legal, .login-panel > .prototype-note",
    ),
    1300,
    { offset: -10, duration: 600, stagger: 80 },
  );
  descend(query(".login-footer"), 1800, { offset: -8, duration: 600 });

  return animations;
}

function AppShell({
  colorMode,
  onToggleColor,
  onSignOut,
  userEmail,
  profile,
}: {
  colorMode: boolean;
  onToggleColor: () => void;
  onSignOut: () => void;
  userEmail: string | null;
  profile: ProfileState;
}) {
  // Live notifications (Realtime) — toasts plus the sidebar bell.
  const notifications = useNotifications(!!userEmail);
  const [bellOpen, setBellOpen] = useState(false);
  // `view` drives navigation highlights immediately; `displayedView` is the page on screen.
  // A return from Google's consent screen opens Settings (→ Mail) directly.
  const initialView = (): View => (isGmailReturn() ? "settings" : viewFromHash());
  const [view, setView] = useState<View>(initialView);
  const [displayedView, setDisplayedView] = useState<View>(initialView);
  // The deep-link focus (e.g. which calendar event a notification tap opened),
  // parsed from the hash on mount and refreshed on every hashchange.
  const [deepLinkFocus, setDeepLinkFocus] = useState<DeepLinkFocus>(() => focusFromHash(0));
  const [entranceToken, setEntranceToken] = useState(0);
  const [assistantVisited, setAssistantVisited] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // These must start where the hash actually put us. Seeded with "today" they
  // disagreed with `displayedView` on any deep link, and `navigate` then
  // short-circuited: opening #library and pressing Today moved the highlight
  // but left the Library on screen.
  const displayedRef = useRef<View>(displayedView);
  const pendingRef = useRef<View>(displayedView);
  const exitRef = useRef<Animation | null>(null);
  /** Fallback that commits a navigation if the exit animation never settles. */
  const exitTimerRef = useRef<number | undefined>(undefined);
  const entranceRef = useRef<Animation[]>([]);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const [indicatorAnimated, setIndicatorAnimated] = useState(false);

  // Library content is shared between the Library and My Knowledge views, and
  // the reader/player overlays write progress and annotations back into it.
  // Loaded from /library (mapped to the UI model) when the backend is
  // configured; otherwise the seed, so the prototype still works offline.
  const {
    items: libraryItems,
    loading: libraryLoading,
    error: libraryError,
    offline: libraryOffline,
    configured: libraryConfigured,
    createItem: createLibraryItem,
    removeItem: removeLibraryItem,
    updateItem,
  } = useLibrary(initialLibraryItems);
  const readerSync = useReaderSync(libraryConfigured);
  const enrichedReaderId = useRef<string | null>(null);
  const [reader, setReader] = useState<LibraryItem | null>(null);
  const [player, setPlayer] = useState<LibraryItem | null>(null);
  // Whether the podcast player shows full-screen or as the persistent mini bar.
  const [playerExpanded, setPlayerExpanded] = useState(true);
  /**
   * The library row the open player writes back to.
   *
   * It cannot be derived from the player's payload: saving the episode
   * details renames the row to the episode title, and the next write would
   * then look for a row under a name that no longer matches anything. Held
   * in a ref rather than state so a rename does not change the player's
   * React key and remount it mid-playback.
   */
  const playerKeyRef = useRef<string | null>(null);
  const openPodcast = useCallback((item: LibraryItem) => {
    playerKeyRef.current = itemKey(item);
    setPlayer(item);
    setPlayerExpanded(true);
  }, []);
  const [articleItem, setArticleItem] = useState<LibraryItem | null>(null);
  const [bookOptions, setBookOptions] = useState<LibraryItem | null>(null);

  // Open a book in the reader. When it's a saved item we first load its
  // annotations + bookmarks so the reader mounts with them (the reader seeds
  // its state once, so post-open injection wouldn't show), and record the
  // session start for reconciliation on close.
  const openReader = useCallback(
    async (item: LibraryItem) => {
      if (libraryConfigured && item.id) {
        readerSync.begin(item.id);
        try {
          // With a copy on this device, don't hold the book hostage to a
          // waking server: give it a few seconds, then open from the copy.
          const hasCopy = Boolean(readReaderCache(item.id));
          const [annotations, bookmarks] = await Promise.race([
            Promise.all([api.reader.annotations(item.id), api.reader.bookmarks(item.id)]),
            new Promise<never>((_, reject) =>
              window.setTimeout(() => reject(new Error("slow")), hasCopy ? 4000 : 20000),
            ),
          ]);
          // Changes made offline and not yet synced are newer than the
          // server's list: keep the cached copy while they are queued.
          const queued = outbox.pendingFor(item.id).some((op) => op.kind !== "library.patch");
          const cached = queued ? readReaderCache(item.id) : null;
          const useAnnotations = cached?.annotations ?? annotations;
          const useBookmarks = cached?.bookmarks ?? bookmarks;
          if (!cached) writeReaderCache(item.id, annotations, bookmarks);
          readerSync.setServer(item.id, useAnnotations, useBookmarks);
          enrichedReaderId.current = item.id;
          setReader({
            ...item,
            annotations: useAnnotations.map(annotationRowToUi),
            bookmarks: useBookmarks.map(bookmarkRowToUi),
          });
          return;
        } catch {
          // Offline (or the server is waking): open from this device's copy,
          // and diff against it on close so nothing is re-created or lost.
          const cached = readReaderCache(item.id);
          if (cached) {
            readerSync.setServer(item.id, cached.annotations, cached.bookmarks);
            enrichedReaderId.current = item.id;
            setReader({
              ...item,
              annotations: cached.annotations.map(annotationRowToUi),
              bookmarks: cached.bookmarks.map(bookmarkRowToUi),
            });
            return;
          }
        }
      }
      if (item.id) {
        readerSync.begin(item.id);
        enrichedReaderId.current = item.id;
      }
      setReader(item);
    },
    [libraryConfigured, readerSync],
  );

  // When the reader closes, reconcile the final annotations/bookmarks to the
  // server (create the new, delete the removed) and log the reading session.
  useEffect(() => {
    if (reader || !enrichedReaderId.current) return;
    const id = enrichedReaderId.current;
    enrichedReaderId.current = null;
    readerSync.flush(id);
  }, [reader, readerSync]);

  const activeRoot = () =>
    displayedRef.current === "assistant" ? assistantRef.current : pageRef.current;

  const navigate = useCallback((next: View) => {
    setView(next);
    // Keep the address bar in step so a refresh returns here. `replaceState`
    // rather than a hash assignment: this records where you are, it does not
    // add a history entry per tab press.
    if (typeof window !== "undefined") {
      const hash = next === "settings" ? "" : `#${next}`;
      window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
    }
    pendingRef.current = next;
    // An exit is already running; it will show the latest requested page.
    if (exitRef.current) return;
    if (next === displayedRef.current) return;

    entranceRef.current.forEach((animation) => animation.cancel());
    entranceRef.current = [];

    /**
     * Put the latest requested page on screen. Runs exactly once per exit,
     * whichever of the three ways below gets here first.
     */
    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(exitTimerRef.current);
      exitRef.current = null;
      displayedRef.current = pendingRef.current;
      setDisplayedView(pendingRef.current);
      setEntranceToken((token) => token + 1);
    };

    const root = activeRoot();
    if (!root) {
      commit();
      return;
    }
    const exit = hidePage(root);
    exitRef.current = exit;
    /*
     * The fade is an embellishment; the navigation is not.
     *
     * `exit.finished` is not a promise to rely on: it rejects when the
     * animation is cancelled (the entrance effect cancels animations on
     * every view change) and can simply never settle when its element is
     * hidden mid-flight — which is what happened on the way out of the
     * assistant. Either way `exitRef` stayed set, so `navigate` bailed at
     * the guard above *forever after*: the sidebar highlight moved, the
     * address bar changed, and the page underneath never did.
     *
     * So: commit when the animation finishes, when it is cancelled, or when
     * its duration has simply elapsed — whichever comes first.
     */
    exitTimerRef.current = window.setTimeout(commit, EXIT_DURATION + 60);
    exit.finished.then(commit).catch(commit);
  }, []);

  // Keep the ref that `navigate` reasons about in step with what is actually
  // rendered, so the two can never disagree about where we are.
  useLayoutEffect(() => {
    displayedRef.current = displayedView;
  }, [displayedView]);

  /**
   * React to the address-bar hash changing under us. Browser back/forward move
   * through the `#calendar`-style hashes `navigate` writes, and the native
   * shell delivers a notification deep-link into an already-open app the same
   * way — by setting the hash. Without this the view only read the hash once,
   * at mount, so a deep link into a running app did nothing.
   */
  useEffect(() => {
    const onHashChange = () => {
      const next = viewFromHash();
      // Refresh the focus first, so the view it lands on can act on it.
      setDeepLinkFocus((prev) => focusFromHash(prev.token + 1));
      if (next !== displayedRef.current) navigate(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [navigate]);

  /**
   * Tapping a push notification (Phase 6.2) when a tab is already open.
   *
   * The service worker focuses that tab and posts the deeplink here rather
   * than calling `openWindow`, which would open a second copy of the app and
   * throw away whatever the user was in the middle of. A deeplink we do not
   * recognise is ignored — the tab is focused either way, which is most of
   * what the user wanted.
   */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; deeplink?: string } | null;
      if (data?.type !== "mypro:navigate") return;
      const target = (data.deeplink ?? "").replace(/^\//, "");
      if (NOTIFICATION_VIEWS.includes(target as View)) navigate(target as View);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);

  const openMedia = useCallback(
    (item: LibraryItem) => {
      if (item.type === "Podcasts") openPodcast(item);
      else if (item.type === "Articles") setArticleItem(item);
      else if (item.type === "Notes") navigate("knowledge");
      else if (item.pdfFileName || item.pdfUrl) void openReader(item);
      else setBookOptions(item);
    },
    [navigate, openReader, openPodcast],
  );

  const jumpToSource = useCallback(
    (title: string, page: number) => {
      const item = libraryItems.find((entry) => entry.title === title);
      if (!item) return;
      if (item.type === "Books" && (item.pdfFileName || item.pdfUrl)) {
        void openReader({ ...item, currentPage: page });
      } else {
        openMedia(item);
      }
    },
    [libraryItems, openMedia, openReader],
  );

  const saveReaderProgress = (
    title: string,
    currentPage: number,
    totalPages: number,
    bookmarks: BookmarkItem[],
    notes: NoteItem[],
    highlights: HighlightItem[],
    annotations: Annotation[],
  ) => {
    // Stash the latest reader snapshot so it can be reconciled to the API when
    // the reader closes (create new / delete removed annotations + bookmarks).
    readerSync.snapshot({ bookmarks, annotations, currentPage, totalPages });
    updateItem(title, (item) => ({
      ...item,
      currentPage,
      totalPages,
      progress: totalPages ? Math.round((currentPage / totalPages) * 100) : item.progress,
      bookmarks,
      notes,
      highlights,
      annotations,
      accessed: "Just now",
    }));
  };

  const updatePodcastProgress = (
    title: string,
    currentTimeSeconds: number,
    durationSeconds: number,
  ) =>
    updateItem(title, (item) => ({
      ...item,
      currentTimeSeconds,
      durationSeconds,
      progress: durationSeconds
        ? Math.round((currentTimeSeconds / durationSeconds) * 100)
        : item.progress,
      accessed: "Just now",
    }));

  /**
   * The player sends its *edited* episode title back with the rest, so this
   * is keyed by the row the player was opened on rather than by the title in
   * the payload — otherwise nothing matched and every note typed during an
   * episode was dropped on the next render.
   */
  const savePodcastDetails = (updated: LibraryItem) => {
    const key = playerKeyRef.current ?? itemKey(updated);
    updateItem(key, (item) => ({ ...item, ...updated }));
    // Saving the details renames the row; follow it so later writes still land.
    if (!updated.id && updated.title) playerKeyRef.current = updated.title;
  };

  /** The library's podcasts, in the order the player steps through them. */
  const podcastQueue = useMemo(
    () => libraryItems.filter((item) => item.type === "Podcasts"),
    [libraryItems],
  );

  const updateArticleProgress = (title: string, progress: number) =>
    updateItem(title, (item) => ({ ...item, progress, accessed: "Just now" }));

  const updateBookProgress = (title: string, newPage: number, totalPages: number) =>
    updateItem(title, (item) => ({
      ...item,
      currentPage: newPage,
      totalPages,
      progress: totalPages ? Math.round((newPage / totalPages) * 100) : item.progress,
    }));

  const importPdf = (
    title: string,
    fileName: string,
    storageChoice: "device" | "sync",
    detectedPages: number,
    syncStatus: "local" | "synced",
    fileSizeBytes?: number,
  ) =>
    updateItem(title, (item) => ({
      ...item,
      pdfFileName: fileName,
      pdfStorageOption: storageChoice,
      totalPages: detectedPages,
      syncStatus,
      fileSizeBytes,
    }));

  const updateBookStorage = (
    title: string,
    newStorageOption: "device" | "sync",
    syncStatus: "local" | "synced",
    lastSyncedAt?: string,
  ) =>
    updateItem(title, (item) => ({
      ...item,
      pdfStorageOption: newStorageOption,
      syncStatus,
      lastSyncedAt,
    }));

  // Runs before paint so the new page never flashes before its entrance starts.
  useLayoutEffect(() => {
    if (displayedView === "assistant") setAssistantVisited(true);
    [pageRef.current, assistantRef.current].forEach((root) =>
      root?.getAnimations().forEach((animation) => animation.cancel()),
    );
    scrollRef.current?.scrollTo({ top: 0 });
    const root = displayedView === "assistant" ? assistantRef.current : pageRef.current;
    if (root) entranceRef.current = revealPage(root);
  }, [displayedView, entranceToken]);

  useEffect(
    () => () => {
      window.clearTimeout(exitTimerRef.current);
      exitRef.current?.cancel();
      entranceRef.current.forEach((animation) => animation.cancel());
    },
    [],
  );

  // Escape closes the notification panel wherever it is opened from.
  useEffect(() => {
    if (!bellOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBellOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bellOpen]);

  // Sliding sidebar highlight.
  useLayoutEffect(() => {
    const measure = () => {
      const button = navRef.current?.querySelector<HTMLButtonElement>(`[data-nav="${view}"]`);
      setIndicator(button ? { top: button.offsetTop, height: button.offsetHeight } : null);
    };
    measure();
    // Enable sliding only after the first placement so it never sweeps in on load.
    const frame = window.requestAnimationFrame(() => setIndicatorAnimated(true));
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [view]);

  const renderView = () => {
    if (displayedView === "today")
      return <TodayView navigate={navigate} items={libraryItems} onOpenMedia={openMedia} />;
    if (displayedView === "calendar") return <CalendarView focus={deepLinkFocus} />;
    if (displayedView === "library")
      return (
        <LibraryView
          items={libraryItems}
          onOpenMedia={openMedia}
          onCreateItem={createLibraryItem}
          onRemoveItem={removeLibraryItem}
          loading={libraryLoading}
          error={libraryError}
          showingSaved={libraryOffline}
        />
      );
    if (displayedView === "knowledge")
      return <KnowledgeView items={libraryItems} onJumpToSource={jumpToSource} />;
    if (displayedView === "health") return <HealthView />;
    if (displayedView === "commitments") return <CommitmentsView />;
    if (displayedView === "schedules")
      return <SchedulesView onOpenSettings={() => navigate("settings")} />;
    if (displayedView === "settings")
      return (
        <SettingsView
          books={libraryItems}
          onUpdateBookStorage={updateBookStorage}
          colorMode={colorMode}
          onToggleColor={onToggleColor}
          onSignOut={onSignOut}
          userEmail={userEmail}
          notifications={notifications}
          profile={profile}
        />
      );
    return null;
  };

  return (
    <div
      className={`app-shell dark-app ${colorMode ? "color-mode" : ""} ${
        player && !playerExpanded ? "mini-player-active" : ""
      }`}
    >
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand compact colorMode={colorMode} />
        </div>
        <nav ref={navRef}>
          <span className="nav-label">SPACE</span>
          <span
            className={`nav-indicator ${indicator ? "visible" : ""} ${indicatorAnimated ? "animated" : ""}`}
            style={
              indicator
                ? { transform: `translateY(${indicator.top}px)`, height: indicator.height }
                : undefined
            }
            aria-hidden="true"
          />
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-nav={id}
              className={view === id ? "active" : ""}
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {userEmail && (
          <div className="sidebar-account">
            <span className="sidebar-account-email" title={userEmail}>
              {userEmail}
            </span>
            <button
              type="button"
              className="sidebar-signout"
              onClick={onSignOut}
              aria-label="Sign out"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </aside>
      <div className="app-main">
        <NotificationToasts
          toasts={notifications.toasts}
          onRead={(id) => void notifications.markRead(id)}
          onDismiss={notifications.dismiss}
        />
        <header className="mobile-header">
          <Brand compact colorMode={colorMode} />
          <div className="mobile-header-actions">
            <button
              className={`mobile-header-button ${colorMode ? "active" : ""}`}
              onClick={onToggleColor}
              aria-pressed={colorMode}
              aria-label="Toggle Color Mode"
            >
              <Palette size={18} />
            </button>
            <button
              className={`mobile-header-button ${view === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
              aria-label="Open settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        <div className="view-scroll" ref={scrollRef}>
          {displayedView !== "assistant" && (
            <div className="page-stage" ref={pageRef}>
              {renderView()}
            </div>
          )}
          {/* Kept mounted after first visit so the AI animation and chat never restart. */}
          {(assistantVisited || displayedView === "assistant") && (
            <div
              className="assistant-stage"
              ref={assistantRef}
              hidden={displayedView !== "assistant"}
            >
              <AssistantView userEmail={userEmail} />
            </div>
          )}
        </div>
      </div>
      <div className="global-controls">
        {userEmail && (
          <div className="notifications-control">
            <button
              type="button"
              className={`notifications-fab ${bellOpen ? "active" : ""}`}
              onClick={() => setBellOpen((open) => !open)}
              aria-expanded={bellOpen}
              aria-label={
                notifications.unread
                  ? `Notifications, ${notifications.unread} unread`
                  : "Notifications"
              }
            >
              <Bell size={16} />
              <span>Notifications</span>
              {notifications.unread > 0 && (
                <span className="notifications-fab-count">{notifications.unread}</span>
              )}
              <span
                className={`notifications-fab-live live-${notifications.live}`}
                title={
                  notifications.live === "live"
                    ? "Live"
                    : notifications.live === "connecting"
                      ? "Connecting…"
                      : "Not live — reload to reconnect"
                }
                aria-hidden="true"
              />
            </button>

            {bellOpen && (
              <>
                {/* On a phone the bell itself is hidden (the sheet opens this
                    panel instead), so without these the panel had no way out. */}
                <div
                  className="notification-panel-backdrop"
                  onClick={() => setBellOpen(false)}
                  aria-hidden="true"
                />
                <div className="notification-panel" role="dialog" aria-label="Notifications">
                  <div className="notification-panel-head">
                    <span className="section-kicker">NOTIFICATIONS</span>
                    {notifications.unread > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void notifications.markAllRead()}
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      type="button"
                      className="notification-panel-close"
                      onClick={() => setBellOpen(false)}
                      aria-label="Close notifications"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {!notifications.items.length ? (
                    <p className="notification-panel-empty">Nothing yet.</p>
                  ) : (
                    <ul className="notification-panel-list">
                      {notifications.items.slice(0, 12).map((item) => (
                        <li key={item.id} className={item.read_at ? "read" : "unread"}>
                          <button
                            type="button"
                            onClick={() => void notifications.markRead(item.id)}
                          >
                            <strong>{item.title}</strong>
                            {item.body && <small>{item.body}</small>}
                            <span>{new Date(item.created_at).toLocaleString()}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <button
          className={`settings-fab ${view === "settings" ? "active" : ""}`}
          onClick={() => navigate("settings")}
          aria-label="Open settings"
        >
          <Settings size={19} />
          <span>Settings</span>
        </button>
        <button
          className={`color-mode-button ${colorMode ? "active" : ""}`}
          onClick={onToggleColor}
          aria-pressed={colorMode}
        >
          <Palette size={19} />
          <span>Color Mode</span>
          <i />
        </button>
      </div>
      <MobileNavSheet
        items={navItems}
        tabIds={["today", "calendar", "assistant", "library", "health"]}
        view={view}
        onNavigate={(id) => navigate(id as View)}
        colorMode={colorMode}
        onToggleColor={onToggleColor}
        unreadCount={notifications.unread}
        onOpenNotifications={() => setBellOpen(true)}
        onSignOut={onSignOut}
      />

      {/*
        `key` is the point of these three.

        Each of these components seeds its state from the item it is given —
        the reader's page, bookmarks and annotations; the player's episode,
        link and notes. Without a key React reuses the instance when the item
        changes, so opening a second podcast left the first one's metadata on
        screen and its video still playing, and opening a second book carried
        the first one's annotations across. A key per item makes switching a
        remount: fresh state, and the old YouTube player torn down by its own
        effect cleanup, which is what stops the previous episode.
      */}
      {reader && (
        <MyProDarkReader
          key={itemKey(reader)}
          book={reader}
          isOpen
          colorMode={colorMode}
          onClose={() => setReader(null)}
          onSaveProgress={saveReaderProgress}
        />
      )}
      {player && (
        <MyProPodcastPlayer
          key={itemKey(player)}
          podcast={player}
          isOpen
          colorMode={colorMode}
          expanded={playerExpanded}
          onExpandedChange={setPlayerExpanded}
          onClose={() => setPlayer(null)}
          /* Bound to the row this player was opened on: the player may have
             been used to rename the episode, so its own title no longer
             matches what the library holds. */
          onUpdateProgress={(_title, seconds, duration) =>
            updatePodcastProgress(playerKeyRef.current ?? itemKey(player), seconds, duration)
          }
          onSavePodcastDetails={savePodcastDetails}
          queue={podcastQueue}
          onSelectEpisode={openPodcast}
        />
      )}
      {articleItem && (
        <ArticleReaderModal
          key={itemKey(articleItem)}
          article={articleItem}
          isOpen
          colorMode={colorMode}
          onClose={() => setArticleItem(null)}
          onUpdateProgress={updateArticleProgress}
        />
      )}
      {bookOptions && (
        <BookOptionsModal
          book={bookOptions}
          isOpen
          colorMode={colorMode}
          onClose={() => setBookOptions(null)}
          onUpdateProgress={updateBookProgress}
          onOpenReader={(item) => {
            setBookOptions(null);
            void openReader(item);
          }}
          onImportPdf={importPdf}
        />
      )}
    </div>
  );
}

/** Minimal brand-only screen shown while the stored session is restored. */
function AuthSplash({ colorMode }: { colorMode: boolean }) {
  return (
    <main className={`welcome login-welcome auth-splash ${colorMode ? "color-mode" : ""}`}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <Brand colorMode={colorMode} />
        <Loading variant="inline" size={30} />
      </div>
    </main>
  );
}

export default function App() {
  const { session, loading, configured, expired } = useSession();
  const [colorMode, setColorMode] = useState(readColorPref);
  const toggleColorMode = () =>
    setColorMode((active) => {
      const next = !active;
      // This device's choice becomes the local truth; the profile save (via the
      // Settings toggle, or picked up on next sync) carries it across devices.
      try {
        localStorage.setItem(COLOR_PREF_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked — session-only is fine */
      }
      return next;
    });

  // When Supabase isn't configured, the Welcome prototype still lets you in via
  // this local flag so the design stays demoable; with Supabase, the real
  // session is the single source of truth.
  const [previewEntered, setPreviewEntered] = useState(false);
  const authenticated = configured ? Boolean(session) : previewEntered;

  // Presence heartbeat — only meaningful with a real session + core API.
  useActivityHeartbeat(authenticated && configured);

  // Color Mode is stored on the profile, so it follows you between devices.
  // The one instance is handed to Settings too; it used to load `/me` again.
  const rootProfile = useProfile(authenticated && configured);
  useEffect(() => {
    if (!rootProfile.loaded) return;
    let hasLocalPref = false;
    try {
      hasLocalPref = localStorage.getItem(COLOR_PREF_KEY) !== null;
    } catch {
      hasLocalPref = false;
    }
    // This device's explicit choice always wins. Otherwise adopt the profile
    // only when it turns colour ON — a fresh profile defaults colour off in the
    // DB, and we don't want that to override the colour-by-default experience.
    if (!hasLocalPref && rootProfile.profile.color_mode) setColorMode(true);
    // Only on the first read: after that this device's toggle is the truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootProfile.loaded]);

  const handleSignOut = useCallback(() => {
    setPreviewEntered(false);
    // Release this device's push channel first (needs the live token), then
    // clear the session. The native shell is told via the session bridge and
    // cancels its own armed reminders and push token.
    void releasePushOnSignOut().finally(() => void signOut());
  }, []);

  if (loading) return <AuthSplash colorMode={colorMode} />;

  return authenticated ? (
    <AppShell
      colorMode={colorMode}
      onToggleColor={toggleColorMode}
      onSignOut={handleSignOut}
      userEmail={session?.user?.email ?? null}
      profile={rootProfile}
    />
  ) : (
    <Welcome
      onEnter={() => setPreviewEntered(true)}
      colorMode={colorMode}
      onToggleColor={toggleColorMode}
      notice={expired ? "Your session expired. Sign in again to continue." : undefined}
    />
  );
}
