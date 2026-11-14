import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { LottieHandle } from "lottie-react";
import {
  Apple,
  Archive,
  ArrowLeft,
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
  ChevronRight,
  Clock3,
  ClipboardList,
  Ellipsis,
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
  Mic,
  Paperclip,
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
  Upload,
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
import { isApiConfigured, isSupabaseConfigured } from "./lib/env";
import {
  AgentOfflineError,
  api,
  forgetAgentBase,
  type AssistantSettingsRow,
  type PendingActionRow,
  type ReceiptRow,
} from "./lib/api";
import { signInWithOAuth, signInWithPassword, signOut, signUpWithPassword } from "./lib/supabase";
import { useSession } from "./lib/useSession";
import { useActivityHeartbeat } from "./lib/useActivityHeartbeat";

type View =
  | "today"
  | "calendar"
  | "library"
  | "knowledge"
  | "health"
  | "assistant"
  | "settings";

// Lottie is large; load it in its own chunk so the first screen renders immediately.
const LottieSvg = lazy(() =>
  import("lottie-react").then((module) => ({ default: module.LottieSvg })),
);

/** Resolves public assets against Vite's base URL so sub-path deployments work. */
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

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
  return <i className="button-spinner" aria-hidden="true" />;
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "library", label: "My Library", icon: Library },
  { id: "knowledge", label: "My Knowledge", icon: Brain },
  { id: "health", label: "Health Records", icon: HeartPulse },
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
}: {
  onEnter: () => void;
  colorMode: boolean;
  onToggleColor: () => void;
}) {
  const [emailMode, setEmailMode] = useState(false);
  const [accountMode, setAccountMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [feedback, setFeedback] = useState("");
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

  // Real Supabase auth when the project is configured; otherwise the original
  // local-only prototype flow, so the design stays demoable without a backend.
  const configured = isSupabaseConfigured;
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

  const continueWithProvider = async (provider: "google" | "apple", label: string) => {
    if (!configured) return runPrototype(label);
    setAuthState("loading");
    setFeedback(`Redirecting to ${label}…`);
    try {
      // Redirects away to the provider and back; the session is then picked up
      // on return by the auth listener, which swaps in the app shell.
      await signInWithOAuth(provider);
    } catch (error) {
      setAuthState("error");
      setFeedback(error instanceof Error ? error.message : `Could not continue with ${label}.`);
    }
  };

  const submitEmail = async () => {
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
    setEmailMode(true);
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
            {authState === "loading" && <i className="auth-spinner" />}
            {authState === "success" && <CheckCircle2 size={15} />}
            {authState === "error" && <span>!</span>}
            {feedback && <p>{feedback}</p>}
          </div>

          <button
            className="auth-button auth-primary"
            onClick={() => continueWithProvider("apple", "Apple")}
            disabled={authState === "loading"}
          >
            <Apple size={19} fill="currentColor" /> Continue with Apple
          </button>
          <button
            className="auth-button"
            onClick={() => continueWithProvider("google", "Google")}
            disabled={authState === "loading"}
          >
            <span className="google-mark">G</span> Continue with Google
          </button>

          <div className="login-separator">
            <span />
            or
            <span />
          </div>

          {!emailMode ? (
            <button className="auth-button" onClick={() => setEmailMode(true)}>
              <Mail size={18} /> Continue with Email
            </button>
          ) : (
            <div className="email-auth-form">
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
          )}

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

const events = [
  { time: "9:30", duration: "45 min", title: "Product strategy", type: "Work", color: "violet" },
  {
    time: "11:00",
    duration: "30 min",
    title: "Dentist appointment",
    type: "Health",
    color: "mint",
  },
  { time: "2:00", duration: "1 hr", title: "Deep work session", type: "Personal", color: "blue" },
];

function TodayView({ navigate }: { navigate: (v: View) => void }) {
  return (
    <div className="page-content dashboard-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">MONDAY, MAY 26</div>
          <h1>Good morning, Alex.</h1>
          <p>Here’s a calm look at what’s ahead.</p>
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
            {events.map((event) => (
              <div className="agenda-row" key={event.title}>
                <div className="agenda-time">
                  <strong>{event.time}</strong>
                  <span>{event.duration}</span>
                </div>
                <div className={`agenda-event event-${event.color}`}>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{event.type}</span>
                  </div>
                  <Ellipsis size={18} />
                </div>
              </div>
            ))}
          </div>
          <div className="free-time">
            <Clock3 size={15} /> Next open block <strong>3:00–5:30 PM</strong>
          </div>
        </div>

        <div className="glass-card focus-card">
          <div className="orb orb-small">
            <div className="orb-core">
              <Sparkles size={18} />
            </div>
          </div>
          <span className="section-kicker">MYPRO INSIGHT</span>
          <h2>You have a focused afternoon.</h2>
          <p>I can protect your free block and move two flexible tasks around it.</p>
          <button onClick={() => navigate("assistant")}>
            Plan it with me <ArrowRight size={15} />
          </button>
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="glass-card important-mail">
          <div className="mail-icon">
            <Mail size={20} />
          </div>
          <div className="mail-content">
            <div className="mail-meta">
              <span className="section-kicker">IMPORTANT MAIL</span>
              <span>12 min ago</span>
            </div>
            <h2>Q3 proposal needs your review</h2>
            <p>Maya Chen · Product team</p>
            <div className="mail-insight">
              <Sparkles size={14} />
              <span>
                Needs your approval before 3 PM; the launch date is the only open question.
              </span>
            </div>
          </div>
          <button className="mail-open" aria-label="Open important mail">
            <ArrowRight size={17} />
          </button>
        </div>

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
          <div className="book-row">
            <div className="book-cover">
              <span>THE</span>
              <strong>
                CREATIVE
                <br />
                ACT
              </strong>
              <small>Rick Rubin</small>
            </div>
            <div className="book-info">
              <span className="soft-label">BOOK</span>
              <h3>The Creative Act</h3>
              <p>Chapter 18 · 32 min left</p>
              <div className="progress">
                <i style={{ width: "64%" }} />
              </div>
              <small>64% completed</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const week = [
  { day: "MON", date: 26 },
  { day: "TUE", date: 27 },
  { day: "WED", date: 28 },
  { day: "THU", date: 29 },
  { day: "FRI", date: 30 },
];

function CalendarView() {
  const [mode, setMode] = useState<"Day" | "Week" | "Month">("Week");
  const [showModal, setShowModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useSimulatedRequest();
  const openQuickAdd = () => {
    setSaved(false);
    setShowModal(true);
  };
  const addToCalendar = async () => {
    setSaving(true);
    await request();
    setSaving(false);
    setSaved(true);
  };
  const calendarTitles = {
    Day: "Monday, May 26",
    Week: "May 26–30",
    Month: "May 2025",
  };
  return (
    <div className="page-content calendar-view">
      <header className="page-heading calendar-heading">
        <div>
          <div className="eyebrow muted-eyebrow">CALENDAR</div>
          <h1>{calendarTitles[mode]}</h1>
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
          <button className="secondary-button" onClick={() => setMode("Day")}>
            Today
          </button>
          <IconButton label={`Previous ${mode.toLowerCase()}`}>
            <ArrowLeft size={18} />
          </IconButton>
          <IconButton label={`Next ${mode.toLowerCase()}`}>
            <ArrowRight size={18} />
          </IconButton>
          <button className="primary-button" onClick={openQuickAdd}>
            <Plus size={17} /> New
          </button>
        </div>
      </header>
      <div className={`calendar-layout calendar-layout-${mode.toLowerCase()}`}>
        {mode !== "Month" && (
          <aside className="calendar-context glass-card">
            <div className="mini-month-title">
              <strong>May 2025</strong>
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
              {Array.from({ length: 35 }, (_, i) => {
                const day = i - 2;
                return (
                  <span
                    key={i}
                    className={day === 26 ? "active" : day < 1 || day > 31 ? "faded" : ""}
                  >
                    {day < 1 ? 30 + day : day > 31 ? day - 31 : day}
                  </span>
                );
              })}
            </div>
          </aside>
        )}
        {mode === "Week" && <MobileWeekAgenda />}
        {mode === "Week" && (
          <div className="week-calendar glass-card">
            <div className="week-header">
              <div className="timezone">GMT+1</div>
              {week.map((d, index) => (
                <div className={index === 0 ? "today-column" : ""} key={d.day}>
                  <span>{d.day}</span>
                  <strong>{d.date}</strong>
                </div>
              ))}
            </div>
            <div className="week-grid">
              <div className="time-rail">
                {[
                  "8 AM",
                  "9 AM",
                  "10 AM",
                  "11 AM",
                  "12 PM",
                  "1 PM",
                  "2 PM",
                  "3 PM",
                  "4 PM",
                  "5 PM",
                ].map((time) => (
                  <span key={time}>{time}</span>
                ))}
              </div>
              {week.map((d, i) => (
                <div className="day-column" key={d.date}>
                  {i === 0 && (
                    <>
                      <CalendarEvent
                        top={67}
                        height={74}
                        title="Product strategy"
                        meta="9:30 · 45 min"
                        color="lavender"
                      />
                      <CalendarEvent
                        top={214}
                        height={82}
                        title="Dentist"
                        meta="11:00 · 30 min"
                        color="mint"
                      />
                      <CalendarEvent
                        top={457}
                        height={106}
                        title="Deep work"
                        meta="2:00 · 1 hr"
                        color="blue"
                      />
                      <div className="current-time" style={{ top: 375 }}>
                        <i />
                        <span>1:12</span>
                      </div>
                    </>
                  )}
                  {i === 1 && (
                    <CalendarEvent
                      top={148}
                      height={103}
                      title="Team review"
                      meta="10:15 · 1 hr"
                      color="blue"
                    />
                  )}
                  {i === 2 && (
                    <>
                      <CalendarEvent
                        top={67}
                        height={73}
                        title="Morning run"
                        meta="9:30 · 45 min"
                        color="mint"
                      />
                      <CalendarEvent
                        top={373}
                        height={114}
                        title="Read & notes"
                        meta="1:00 · 1 hr"
                        color="peach"
                      />
                    </>
                  )}
                  {i === 3 && (
                    <CalendarEvent
                      top={214}
                      height={105}
                      title="Project sync"
                      meta="11:00 · 1 hr"
                      color="lavender"
                    />
                  )}
                  {i === 4 && (
                    <CalendarEvent
                      top={294}
                      height={71}
                      title="Weekly review"
                      meta="12:00 · 45 min"
                      color="peach"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === "Day" && <DayCalendar />}
        {mode === "Month" && <MonthCalendar />}
      </div>
      {showModal && (
        <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}>
          <div className="event-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="section-kicker">QUICK ADD</span>
                <h2>{saved ? "Added to your day" : "Create something new"}</h2>
              </div>
              <IconButton label="Close" onClick={() => setShowModal(false)}>
                <X size={18} />
              </IconButton>
            </div>
            {saved ? (
              <div className="saved-state">
                <div>
                  <Check size={28} />
                </div>
                <h3>Design review</h3>
                <p>Tuesday, May 27 · 10:00–10:45 AM</p>
                <button className="primary-button" onClick={() => setShowModal(false)}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="type-switch">
                  <button className="active">Event</button>
                  <button>Task</button>
                </div>
                <label className="field-label">
                  TITLE
                  <input defaultValue="Design review" />
                </label>
                <label className="field-label">
                  DESCRIPTION
                  <textarea placeholder="Add notes, links, or context..." />
                </label>
                <div className="field-grid">
                  <label className="field-label">
                    DATE
                    <input defaultValue="Tue, May 27" />
                  </label>
                  <label className="field-label">
                    TIME
                    <input defaultValue="10:00 – 10:45 AM" />
                  </label>
                </div>
                <div className="field-grid">
                  <label className="field-label">
                    CATEGORY
                    <select defaultValue="Work">
                      <option>Work</option>
                      <option>Personal</option>
                      <option>Health</option>
                      <option>Reading</option>
                    </select>
                  </label>
                  <label className="field-label">
                    REMINDER
                    <select defaultValue="10 minutes before">
                      <option>10 minutes before</option>
                      <option>At start time</option>
                      <option>1 hour before</option>
                    </select>
                  </label>
                </div>
                <div className="modal-footer">
                  <button className="secondary-button" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    onClick={addToCalendar}
                    disabled={saving}
                    aria-busy={saving}
                  >
                    {saving ? (
                      <>
                        <Spinner /> Adding…
                      </>
                    ) : (
                      "Add to calendar"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const weekAgenda: { time: string; duration: string; title: string; tone: string }[][] = [
  [
    { time: "9:30 AM", duration: "45 min", title: "Product strategy", tone: "lavender" },
    { time: "11:00 AM", duration: "30 min", title: "Dentist", tone: "mint" },
    { time: "2:00 PM", duration: "1 hr", title: "Deep work", tone: "blue" },
  ],
  [{ time: "10:15 AM", duration: "1 hr", title: "Team review", tone: "blue" }],
  [
    { time: "9:30 AM", duration: "45 min", title: "Morning run", tone: "mint" },
    { time: "1:00 PM", duration: "1 hr", title: "Read & notes", tone: "peach" },
  ],
  [{ time: "11:00 AM", duration: "1 hr", title: "Project sync", tone: "lavender" }],
  [{ time: "12:00 PM", duration: "45 min", title: "Weekly review", tone: "peach" }],
];

/* Phone-only week view: a day strip with a vertical agenda instead of a 5-column grid. */
function MobileWeekAgenda() {
  const [selected, setSelected] = useState(0);
  const items = weekAgenda[selected];
  return (
    <div className="mobile-week-agenda">
      <div className="mobile-day-strip" role="tablist" aria-label="Days this week">
        {week.map((d, index) => (
          <button
            key={d.day}
            role="tab"
            aria-selected={selected === index}
            className={`${selected === index ? "selected" : ""} ${index === 0 ? "today" : ""}`}
            onClick={() => setSelected(index)}
          >
            <span>{d.day}</span>
            <strong>{d.date}</strong>
            <i>
              {weekAgenda[index].map((item) => (
                <b key={item.title} className={`tone-${item.tone}`} />
              ))}
            </i>
          </button>
        ))}
      </div>
      <div className="mobile-agenda-summary">
        <strong>
          {selected === 0
            ? "Today"
            : `${week[selected].day.charAt(0)}${week[selected].day.slice(1).toLowerCase()}, May ${week[selected].date}`}
        </strong>
        <span>
          {items.length} {items.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="mobile-agenda-list">
        {items.map((item) => (
          <article className={`mobile-agenda-event tone-${item.tone}`} key={item.title}>
            <time>
              <strong>{item.time.replace(/ (AM|PM)/, "")}</strong>
              <span>{item.time.slice(-2)}</span>
            </time>
            <div>
              <strong>{item.title}</strong>
              <span>{item.duration}</span>
            </div>
            <ChevronRight size={16} />
          </article>
        ))}
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
}: {
  top: number;
  height: number;
  title: string;
  meta: string;
  color: string;
}) {
  return (
    <div className={`calendar-event calendar-${color}`} style={{ top, height }}>
      <strong>{title}</strong>
      <span>{meta}</span>
    </div>
  );
}

function DayCalendar() {
  const hours = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];

  return (
    <div className="day-calendar glass-card">
      <div className="day-calendar-header">
        <div>
          <span className="section-kicker">MONDAY</span>
          <h2>26 May</h2>
        </div>
        <div className="day-summary">
          <strong>3 events</strong>
          <span>3h 15m scheduled</span>
        </div>
      </div>
      <div className="all-day-row">
        <span>ALL DAY</span>
        <div>Submit monthly expenses</div>
      </div>
      <div className="day-timeline">
        <div className="time-rail">
          {hours.map((time) => (
            <span key={time}>{time}</span>
          ))}
        </div>
        <div className="day-column day-column-expanded">
          <CalendarEvent
            top={67}
            height={74}
            title="Product strategy"
            meta="9:30–10:15 AM · Conference room"
            color="lavender"
          />
          <CalendarEvent
            top={214}
            height={82}
            title="Dentist appointment"
            meta="11:00–11:30 AM · Health"
            color="mint"
          />
          <CalendarEvent
            top={457}
            height={106}
            title="Deep work session"
            meta="2:00–3:00 PM · Focus time"
            color="blue"
          />
          <div className="current-time" style={{ top: 375 }}>
            <i />
            <span>1:12</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthCalendar() {
  const monthEvents: Record<number, { title: string; color: string }[]> = {
    2: [{ title: "Project kickoff", color: "blue" }],
    6: [{ title: "Read & notes", color: "peach" }],
    8: [{ title: "Team review", color: "blue" }],
    12: [{ title: "Dentist", color: "mint" }],
    15: [{ title: "Project sync", color: "lavender" }],
    20: [{ title: "Morning run", color: "mint" }],
    23: [{ title: "Weekly review", color: "peach" }],
    26: [
      { title: "Product strategy", color: "lavender" },
      { title: "Deep work", color: "blue" },
    ],
    28: [{ title: "Read & notes", color: "peach" }],
    30: [{ title: "Monthly review", color: "lavender" }],
  };
  const [selectedDay, setSelectedDay] = useState(26);
  const selectedEvents = monthEvents[selectedDay] ?? [];

  return (
    <div className="month-calendar glass-card">
      <div className="month-weekdays">
        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid">
        {Array.from({ length: 35 }, (_, index) => {
          const rawDay = index - 2;
          const isPreviousMonth = rawDay < 1;
          const isNextMonth = rawDay > 31;
          const day = isPreviousMonth ? 30 + rawDay : isNextMonth ? rawDay - 31 : rawDay;
          const eventsForDay = !isPreviousMonth && !isNextMonth ? monthEvents[day] : undefined;

          return (
            <div
              className={`month-day ${isPreviousMonth || isNextMonth ? "outside-month" : ""} ${
                day === 26 && !isPreviousMonth && !isNextMonth ? "today" : ""
              } ${day === selectedDay && !isPreviousMonth && !isNextMonth ? "selected" : ""}`}
              onClick={() => {
                if (!isPreviousMonth && !isNextMonth) setSelectedDay(day);
              }}
              key={index}
            >
              <span className="month-day-number">{day}</span>
              <div className="month-day-events">
                {eventsForDay?.map((event) => (
                  <div className={`month-event month-event-${event.color}`} key={event.title}>
                    <i />
                    <span>{event.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mobile-month-agenda">
        <div className="mobile-agenda-summary">
          <strong>{selectedDay === 26 ? "Today" : `May ${selectedDay}`}</strong>
          <span>
            {selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="mobile-agenda-list">
          {selectedEvents.map((event) => (
            <article
              className={`mobile-agenda-event mobile-month-event tone-${event.color}`}
              key={event.title}
            >
              <div>
                <strong>{event.title}</strong>
                <span>May {selectedDay}, 2025</span>
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

function AnimatedReply({ text }: { text: string }) {
  const words = text.split(" ");
  const [visibleWords, setVisibleWords] = useState(0);

  useEffect(() => {
    setVisibleWords(0);
    const interval = window.setInterval(() => {
      setVisibleWords((current) => {
        if (current >= words.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 42);
    return () => window.clearInterval(interval);
  }, [text, words.length]);

  return (
    <>
      {words.slice(0, visibleWords).join(" ")}
      {visibleWords < words.length && <i className="typing-cursor" />}
    </>
  );
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
};

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

type Persona = {
  name?: string;
  tone?: string;
  style_notes?: string;
  check_in_time?: string;
  inactivity_hours?: number;
  proactive_enabled?: boolean;
};

/** Persona/charter + runtime settings editor — both live on the laptop agent. */
function AssistantSettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AssistantSettingsRow | null>(null);
  const [persona, setPersona] = useState<Persona>({});

  useEffect(() => {
    let active = true;
    Promise.all([api.assistant.settings(), api.assistant.persona()])
      .then(([loadedSettings, loadedPersona]) => {
        if (!active) return;
        setSettings(loadedSettings);
        setPersona((loadedPersona ?? {}) as Persona);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(
          caught instanceof AgentOfflineError
            ? "Wake your laptop to edit the assistant."
            : caught instanceof Error
              ? caught.message
              : "Could not load assistant settings.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api.assistant.updateSettings({
        context_message_limit: settings.context_message_limit,
        temperature: settings.temperature,
        allow_auto_send_email: settings.allow_auto_send_email,
        ...(settings.model && settings.model.trim().length >= 3
          ? { model: settings.model.trim() }
          : {}),
      });

      const personaPatch: Record<string, unknown> = {
        tone: persona.tone ?? "",
        style_notes: persona.style_notes ?? "",
      };
      if (persona.name?.trim()) personaPatch.name = persona.name.trim();
      if (persona.check_in_time) personaPatch.check_in_time = persona.check_in_time;
      if (typeof persona.inactivity_hours === "number")
        personaPatch.inactivity_hours = persona.inactivity_hours;
      if (typeof persona.proactive_enabled === "boolean")
        personaPatch.proactive_enabled = persona.proactive_enabled;
      await api.assistant.updatePersona(personaPatch);

      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
      setSaving(false);
    }
  };

  return (
    <div className="assistant-settings-overlay" onClick={onClose}>
      <div
        className="assistant-settings-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Assistant settings"
      >
        <header className="assistant-settings-head">
          <h2>Assistant settings</h2>
          <button className="quiet-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <div className="assistant-settings-loading">Loading…</div>
        ) : error && !settings ? (
          <div className="assistant-settings-loading">{error}</div>
        ) : (
          settings && (
            <div className="assistant-settings-body">
              <span className="settings-group-label">Persona</span>
              <label className="settings-row">
                <span>Name</span>
                <input
                  type="text"
                  value={persona.name ?? ""}
                  maxLength={60}
                  onChange={(e) => setPersona((p) => ({ ...p, name: e.target.value }))}
                  placeholder="MyPro"
                />
              </label>
              <label className="settings-row">
                <span>Tone</span>
                <input
                  type="text"
                  value={persona.tone ?? ""}
                  maxLength={400}
                  onChange={(e) => setPersona((p) => ({ ...p, tone: e.target.value }))}
                  placeholder="Warm, concise, encouraging"
                />
              </label>
              <label className="settings-row settings-row-stack">
                <span>Style notes</span>
                <textarea
                  value={persona.style_notes ?? ""}
                  maxLength={4000}
                  rows={3}
                  onChange={(e) => setPersona((p) => ({ ...p, style_notes: e.target.value }))}
                  placeholder="How should it talk to you? What should it avoid?"
                />
              </label>
              <label className="settings-row">
                <span>Daily check-in</span>
                <input
                  type="time"
                  value={(persona.check_in_time ?? "").slice(0, 5)}
                  onChange={(e) => setPersona((p) => ({ ...p, check_in_time: e.target.value }))}
                />
              </label>
              <label className="settings-row">
                <span>Nudge after (hours idle)</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={persona.inactivity_hours ?? ""}
                  onChange={(e) =>
                    setPersona((p) => ({
                      ...p,
                      inactivity_hours: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                />
              </label>
              <label className="settings-row settings-toggle-row">
                <span>Proactive check-ins</span>
                <input
                  type="checkbox"
                  checked={persona.proactive_enabled ?? false}
                  onChange={(e) => setPersona((p) => ({ ...p, proactive_enabled: e.target.checked }))}
                />
              </label>

              <span className="settings-group-label">Conversation</span>
              <div className="settings-row settings-row-stack">
                <span>
                  Context window — {settings.context_message_limit} message
                  {settings.context_message_limit === 1 ? "" : "s"} replayed
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={2}
                  value={settings.context_message_limit}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, context_message_limit: Number(e.target.value) } : s,
                    )
                  }
                />
              </div>
              <div className="settings-row settings-row-stack">
                <span>Temperature — {settings.temperature.toFixed(1)}</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature}
                  onChange={(e) =>
                    setSettings((s) => (s ? { ...s, temperature: Number(e.target.value) } : s))
                  }
                />
              </div>
              <label className="settings-row">
                <span>Model (optional)</span>
                <input
                  type="text"
                  value={settings.model ?? ""}
                  onChange={(e) =>
                    setSettings((s) => (s ? { ...s, model: e.target.value } : s))
                  }
                  placeholder="Uses the agent default"
                />
              </label>
              <label className="settings-row settings-toggle-row">
                <span>Let it send email without asking</span>
                <input
                  type="checkbox"
                  checked={settings.allow_auto_send_email}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, allow_auto_send_email: e.target.checked } : s,
                    )
                  }
                />
              </label>

              {error && <p className="composer-error">{error}</p>}
            </div>
          )
        )}

        <footer className="assistant-settings-foot">
          <button className="settings-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="settings-save"
            onClick={save}
            disabled={loading || saving || !settings}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AssistantView() {
  // Real agent chat when the backend is configured; otherwise the original
  // local prototype flow so the design stays demoable without a laptop.
  const configured = isApiConfigured;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const request = useSimulatedRequest();

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isThinking]);

  // Load history, then poll agent presence and the approval queue.
  useEffect(() => {
    if (!configured) return;
    let active = true;

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
            })),
        );
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
    const timer = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
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
      const result = await api.assistant.send(clean);
      setAgentOnline(true);
      setMessages((current) => [
        ...current,
        {
          id: result.message.id,
          from: "ai",
          text: result.message.content ?? "",
          time: fmtTime(result.message.created_at),
          receipts: result.receipts,
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

  const resolvePending = async (id: string, action: "approve" | "reject") => {
    setPending((queue) => queue.filter((item) => item.id !== id));
    try {
      if (action === "approve") await api.skills.approve(id);
      else await api.skills.reject(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the request.");
      api.skills.pending().then(setPending).catch(() => {});
    }
  };

  const clearConversation = async () => {
    setMenuOpen(false);
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
          <div className="mode-select">
            <span className="mode-spark">
              <Sparkles size={14} />
            </span>{" "}
            MyPro Personal <ChevronDown size={14} />
          </div>
          <div className="assistant-top-right">
            {configured && (
              <span
                className={`agent-status ${agentOnline === null ? "unknown" : agentOnline ? "online" : "offline"}`}
              >
                <i />
                {agentOnline === null
                  ? "Connecting"
                  : agentOnline
                    ? "Agent online"
                    : "Agent asleep"}
              </span>
            )}
            <div className="assistant-menu">
              <button
                className="quiet-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Conversation options"
              >
                <Ellipsis size={19} />
              </button>
              {menuOpen && (
                <div className="assistant-menu-pop">
                  {configured && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setSettingsOpen(true);
                      }}
                    >
                      Assistant settings
                    </button>
                  )}
                  <button onClick={clearConversation}>Clear conversation</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={`assistant-center ${messages.length > 0 ? "chatting" : ""}`}>
          {messages.length === 0 ? (
            <div className="assistant-intro">
              <RollingCubes thinking={isThinking} />
              <span className="section-kicker">YOUR COMPANION</span>
              <h1>Hi, how can I help you today?</h1>
              <p>I can organize your time, knowledge, and health — all in one thoughtful space.</p>
            </div>
          ) : (
            <div className="conversation" ref={conversationRef}>
              {messages.map((m) => (
                <div key={m.id} className={`message ${m.from}`}>
                  <div className="message-avatar">
                    {m.from === "ai" ? <Sparkles size={15} /> : "AK"}
                  </div>
                  <div className="message-bubble">
                    <p>{m.from === "ai" ? <AnimatedReply text={m.text} /> : m.text}</p>
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
              ))}
              {isThinking && (
                <div className="message ai loading-message">
                  <div className="message-avatar">
                    <Sparkles size={15} />
                  </div>
                  <div className="message-bubble thinking-bubble">
                    <span>MyPro is thinking</span>
                    <div className="typing-dots" aria-label="Loading response">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {pending.length > 0 && (
          <div className="approval-queue">
            {pending.map((item) => (
              <div key={item.id} className="approval-item">
                <div className="approval-text">
                  <strong>{item.summary || item.skill}</strong>
                  <small>Needs your approval</small>
                </div>
                <div className="approval-actions">
                  <button
                    className="approval-reject"
                    onClick={() => resolvePending(item.id, "reject")}
                  >
                    Dismiss
                  </button>
                  <button
                    className="approval-approve"
                    onClick={() => resolvePending(item.id, "approve")}
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <div className={`composer-field ${offline ? "disabled" : ""}`}>
            <textarea
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
            <div className="composer-tools">
              <div>
                <IconButton label="Attach file">
                  <Paperclip size={18} />
                </IconButton>
                <IconButton label="Use voice">
                  <Mic size={18} />
                </IconButton>
              </div>
              <button
                className={`send-button ${isThinking ? "sending" : ""}`}
                onClick={() => send()}
                disabled={isThinking || offline}
              >
                {isThinking ? <i className="send-loader" /> : <Send size={17} />}
              </button>
            </div>
          </div>
          {error ? (
            <p className="composer-error">{error}</p>
          ) : offline ? (
            <p>Wake your laptop to chat with your companion. Everything else keeps working.</p>
          ) : (
            <p>MyPro keeps your personal data private and under your control.</p>
          )}
        </div>
        {configured && settingsOpen && (
          <AssistantSettingsPanel onClose={() => setSettingsOpen(false)} />
        )}
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
};

function LibraryView({
  colorMode,
  items: libraryItems,
  setItems: setLibraryItems,
  onOpenMedia,
}: {
  colorMode: boolean;
  items: LibraryItem[];
  setItems: Dispatch<SetStateAction<LibraryItem[]>>;
  onOpenMedia: (item: LibraryItem) => void;
}) {
  const categories = ["All", "Books", "Podcasts", "Articles", "Notes"] as const;
  const filters = ["All", "In Progress", "Completed", "Want to Read", "Favorites"] as const;
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<AddKind>("Digital Book");
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
    if (addType === "Digital Book") {
      base.totalPages = total;
      base.currentPage = 1;
      base.pdfFileName = form.fileName || "document.pdf";
      base.pdfStorageOption = "device";
      base.syncStatus = "local";
    } else if (addType === "Physical Book") {
      base.totalPages = total;
      base.currentPage = current;
      base.progress = total ? Math.round((current / total) * 100) : 0;
      if (base.progress > 0) base.status = "In Progress";
    } else if (addType === "Podcast") {
      base.youtubeUrl = form.url.trim();
      base.podcastName = form.channel.trim() || "Podcast";
      base.episodeTitle = title;
      base.durationSeconds = parseTimestamp(form.duration) || 3600;
      base.currentTimeSeconds = parseTimestamp(form.timestamp);
      base.playbackSpeed = 1;
    } else {
      base.readTimeMinutes = 8;
    }
    setAddingItem(true);
    await request();
    setLibraryItems((currentItems) => [base, ...currentItems]);
    setAddingItem(false);
    setShowAdd(false);
    setForm(emptyAddForm);
    setCategory("All");
    setFilter("All");
    setQuery("");
    setToast(`“${title}” added to your library`);
    await request(2600);
    setToast("");
  };
  const [editingCollection, setEditingCollection] = useState<number | null>(null);
  const [draggedCollection, setDraggedCollection] = useState<number | null>(null);
  const [collections, setCollections] = useState([
    { name: "Personal Growth", count: 8 },
    { name: "Technology", count: 12 },
    { name: "Business", count: 6 },
    { name: "Philosophy", count: 5 },
    { name: "Health & Fitness", count: 4 },
  ]);

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

  const addCollection = () => {
    setCollections((current) => [...current, { name: "Untitled Collection", count: 0 }]);
    setEditingCollection(collections.length);
  };

  return (
    <div className="page-content foundation-view library-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">MY LIBRARY</div>
          <h1>Your ideas, all in one place.</h1>
          <p>Books, listening, articles, and the notes you want to keep.</p>
        </div>
        <button className="primary-button" onClick={() => setShowAdd(true)}>
          <Plus size={17} /> Add to library
        </button>
      </header>

      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
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

      <div className="library-primary-grid">
        <section className="glass-card continue-learning-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">CONTINUE</span>
              <h2>Pick up where you left off</h2>
            </div>
            <span className="library-result-count">{visibleItems.length} items</span>
          </div>
          <div className="learning-list">
            {visibleItems.map((item) => (
              <article className="learning-row" key={item.title}>
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
                      <h3>{item.title}</h3>
                    </div>
                    <button aria-label={`More options for ${item.title}`}>
                      <Ellipsis size={17} />
                    </button>
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
            {visibleItems.length === 0 && (
              <div className="library-empty">
                <Search size={20} />
                <strong>No matching items</strong>
                <span>Try another category, filter, or search.</span>
              </div>
            )}
          </div>
        </section>

        <section className="glass-card recent-notes-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">RECENT NOTES</span>
              <h2>Ideas worth returning to</h2>
            </div>
            <StickyNote size={17} />
          </div>
          <div className="recent-notes-list">
            {[
              {
                title: "Attention creates quality",
                preview: "The quality of attention changes the quality of the work itself.",
                source: "The Creative Act · Chapter 18",
                date: "Updated today",
              },
              {
                title: "Designing for trust",
                preview: "Calm systems explain what changed without demanding attention.",
                source: "Design Better · Episode 42",
                date: "May 24",
              },
              {
                title: "Weekly reflection",
                preview: "Protect the first hour of the day for focused reading and notes.",
                source: "Personal note · Learning review",
                date: "May 21",
              },
            ].map((note) => (
              <article className="recent-note-row" key={note.title}>
                <div>
                  <h3>{note.title}</h3>
                  <p>{note.preview}</p>
                  <span>{note.source}</span>
                  <small>{note.date}</small>
                </div>
                <button aria-label={`Open ${note.title}`}>
                  <ArrowRight size={15} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="library-secondary-grid">
        <section className="glass-card collections-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">MY COLLECTIONS</span>
              <h2>Organize what matters</h2>
            </div>
            <button className="text-button" onClick={addCollection}>
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
                  setCollections((current) => {
                    const reordered = [...current];
                    const [moved] = reordered.splice(draggedCollection, 1);
                    reordered.splice(index, 0, moved);
                    return reordered;
                  });
                  setDraggedCollection(null);
                }}
                onDragEnd={() => setDraggedCollection(null)}
                key={`${collection.name}-${index}`}
              >
                <GripVertical className="collection-grip" size={13} />
                <span className={`collection-icon collection-tone-${(index % 5) + 1}`}>
                  <Folder size={16} />
                </span>
                {editingCollection === index ? (
                  <input
                    autoFocus
                    value={collection.name}
                    onChange={(event) =>
                      setCollections((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                    onBlur={() => setEditingCollection(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setEditingCollection(null);
                    }}
                  />
                ) : (
                  <button className="collection-name">
                    <strong>{collection.name}</strong>
                    <span>{collection.count} saved items</span>
                  </button>
                )}
                <button
                  className="collection-edit"
                  onClick={() => setEditingCollection(index)}
                  aria-label={`Rename ${collection.name}`}
                >
                  <Pencil size={13} />
                </button>
              </div>
            ))}
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

      <section className="glass-card learning-history-card">
        <div className="card-heading">
          <div>
            <span className="section-kicker">LEARNING HISTORY</span>
            <h2>Recent sample activity</h2>
          </div>
          <span className="sample-badge">Example</span>
        </div>
        <div className="history-list">
          {[
            [BookOpen, "Read for 24 minutes", "The Creative Act · Chapter 18", "Today, 8:20 AM"],
            [StickyNote, "Created a note", "Attention creates quality", "Today, 8:44 AM"],
            [Headphones, "Listened for 38 minutes", "Design Better · Episode 42", "Yesterday"],
            [FileText, "Finished an article", "Designing Calm Systems", "May 23"],
          ].map(([Icon, action, source, date]) => (
            <div className="history-row" key={String(action)}>
              <span>
                <Icon size={15} />
              </span>
              <div>
                <strong>{String(action)}</strong>
                <small>{String(source)}</small>
              </div>
              <time>{String(date)}</time>
            </div>
          ))}
        </div>
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
                    onChange={(event) =>
                      setField("fileName", event.target.files?.[0]?.name ?? "")
                    }
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
                    onChange={(event) => setField("url", event.target.value)}
                    placeholder={
                      addType === "Podcast"
                        ? "Paste a YouTube link"
                        : "Paste the article URL"
                    }
                  />
                </div>
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
      {toast && (
        <div className="app-toast" role="status">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

type KnowledgeKind = "Note" | "Highlight" | "Quote" | "Summary" | "Question" | "Bookmark";

type KnowledgeEntry = {
  id: string;
  kind: KnowledgeKind;
  text: string;
  heading?: string;
  bookTitle: string;
  page: number;
  date: string;
  tone: string;
  tags: string[];
};

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
  colorMode: boolean;
  onJumpToSource: (title: string, page: number) => void;
}) {
  const [tab, setTab] = useState<"All" | KnowledgeKind>("All");
  const [query, setQuery] = useState("");
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const entries = useMemo(() => {
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
          date: bookmark.createdAt,
          tone,
          tags: ["bookmark"],
        }),
      );
    }
    return [...seededKnowledge, ...derived];
  }, [items]);

  const visible = entries.filter((entry) => {
    if (deleted.has(entry.id)) return false;
    if (tab !== "All" && entry.kind !== tab) return false;
    const text = (edits[entry.id] ?? entry.text).toLowerCase();
    const haystack = `${text} ${entry.bookTitle} ${entry.tags.join(" ")}`;
    return haystack.includes(query.toLowerCase());
  });

  const counts = knowledgeTabs.map((item) => ({
    id: item.id,
    count:
      item.id === "All"
        ? entries.filter((entry) => !deleted.has(entry.id)).length
        : entries.filter((entry) => entry.kind === item.id && !deleted.has(entry.id)).length,
  }));

  return (
    <div className="page-content knowledge-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">MY KNOWLEDGE</div>
          <h1>Everything you saved, connected.</h1>
          <p>Notes, highlights, quotes, summaries, and questions — organized across your library.</p>
        </div>
      </header>

      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your knowledge"
          />
        </label>
        <div className="library-categories knowledge-tabs" role="tablist">
          {knowledgeTabs.map(({ id, label, icon: Icon }) => (
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
      </div>

      <div className="knowledge-list">
        {visible.map((entry) => (
          <article className="glass-card knowledge-card" key={entry.id}>
            <div className="knowledge-card-top">
              <span className={`knowledge-kind kind-${entry.tone}`}>{entry.kind}</span>
              <div className="knowledge-actions">
                <button
                  aria-label="Edit"
                  onClick={() => setEditingId(editingId === entry.id ? null : entry.id)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label="Delete"
                  onClick={() => setDeleted((current) => new Set(current).add(entry.id))}
                >
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
                onChange={(event) =>
                  setEdits((current) => ({ ...current, [entry.id]: event.target.value }))
                }
                onBlur={() => setEditingId(null)}
              />
            ) : (
              <p className="knowledge-text">{edits[entry.id] ?? entry.text}</p>
            )}
            <div className="knowledge-tags">
              {entry.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
            <div className="knowledge-footer">
              <button
                className="knowledge-source"
                onClick={() => onJumpToSource(entry.bookTitle, entry.page)}
              >
                <ExternalLink size={13} />
                {entry.bookTitle} → Page {entry.page}
              </button>
              <time>{entry.date}</time>
            </div>
          </article>
        ))}
        {visible.length === 0 && (
          <div className="library-empty">
            <Brain size={20} />
            <strong>Nothing here yet</strong>
            <span>Highlights and notes you save while reading appear here.</span>
          </div>
        )}
      </div>
    </div>
  );
}

type IllnessMedication = {
  name: string;
  dosage?: string;
  frequency?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  observations?: string;
};

type IllnessDocument = {
  name: string;
  type: string;
};

type IllnessRecord = {
  id: number;
  name: string;
  startDate?: string;
  endDate?: string;
  status: "Recovered" | "Recovery ongoing" | "Incomplete record";
  severity?: string;
  symptoms: string[];
  symptomStart?: string;
  symptomSeverity?: string;
  symptomNotes?: string;
  doctor?: string;
  diagnosis?: string;
  consultationDate?: string;
  medicalNotes?: string;
  medications: IllnessMedication[];
  documents: IllnessDocument[];
  recoveryDate?: string;
  recoveryHelp?: string;
  recoveryNotes?: string;
};

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
  const [records, setRecords] = useState(demoIllnessRecords);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("All years");
  const [status, setStatus] = useState("All statuses");
  const [selectedRecord, setSelectedRecord] = useState<IllnessRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyIllnessForm);
  const [documentNames, setDocumentNames] = useState<string[]>([]);
  const [savingMode, setSavingMode] = useState<"draft" | "final" | null>(null);
  const request = useSimulatedRequest();

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
  };

  const saveIllness = async (asDraft: boolean) => {
    if (savingMode) return;
    setSavingMode(asDraft ? "draft" : "final");
    await request();
    setSavingMode(null);
    const record: IllnessRecord = {
      id: editingId ?? Date.now(),
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
    setRecords((current) =>
      editingId === null
        ? [record, ...current]
        : current.map((item) => (item.id === editingId ? record : item)),
    );
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
          <div className="eyebrow muted-eyebrow">PERSONAL HEALTH HISTORY</div>
          <h1>Your health, clearly organized.</h1>
          <p>A private record of past illnesses, symptoms, medications, and recovery.</p>
        </div>
        <button className="primary-button" onClick={() => setShowForm(true)}>
          <Plus size={17} /> Add Previous Illness
        </button>
      </header>

      <div className="health-privacy-note">
        <Archive size={17} />
        <p>
          <strong>Personal reference only.</strong> You decide what to record and share. This demo
          does not provide medical advice or claim secure storage.
        </p>
        <span>Demo records</span>
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
                  selectedRecord.medications.map((medication) => (
                    <div className="medication-history-row" key={medication.name}>
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
                {selectedRecord.documents.length ? (
                  <div className="health-documents">
                    {selectedRecord.documents.map((document) => (
                      <button key={document.name}>
                        <FileText size={15} />
                        <span>
                          <strong>{document.name}</strong>
                          <small>{document.type}</small>
                        </span>
                        <ExternalLink size={13} />
                      </button>
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

function SettingsView({
  books,
  onUpdateBookStorage,
  colorMode,
  onSignOut,
  userEmail,
}: {
  books: LibraryItem[];
  onUpdateBookStorage: (
    title: string,
    newStorageOption: "device" | "sync",
    syncStatus: "local" | "synced",
    lastSyncedAt?: string,
  ) => void;
  colorMode: boolean;
  onSignOut: () => void;
  userEmail: string | null;
}) {
  const [showStorage, setShowStorage] = useState(false);

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

  return (
    <div className="page-content foundation-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow muted-eyebrow">SETTINGS</div>
          <h1>Make MyPro yours.</h1>
          <p>Manage connected sources, preferences, and privacy.</p>
        </div>
      </header>
      <div className="glass-card settings-card">
        <button onClick={() => setShowStorage(true)}>
          <span>Storage &amp; sync</span>
          <small>Manage</small>
          <ChevronRight size={17} />
        </button>
        {[
          "Profile & preferences",
          "Notifications",
          "Connected calendars",
          "Privacy & security",
        ].map((x, i) => (
          <button key={x}>
            <span>{x}</span>
            <small>{i === 3 ? "Protected" : "Configure"}</small>
            <ChevronRight size={17} />
          </button>
        ))}
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
}: {
  colorMode: boolean;
  onToggleColor: () => void;
  onSignOut: () => void;
  userEmail: string | null;
}) {
  // `view` drives navigation highlights immediately; `displayedView` is the page on screen.
  const [view, setView] = useState<View>("today");
  const [displayedView, setDisplayedView] = useState<View>("today");
  const [entranceToken, setEntranceToken] = useState(0);
  const [assistantVisited, setAssistantVisited] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const assistantRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const displayedRef = useRef<View>("today");
  const pendingRef = useRef<View>("today");
  const exitRef = useRef<Animation | null>(null);
  const entranceRef = useRef<Animation[]>([]);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const [indicatorAnimated, setIndicatorAnimated] = useState(false);

  // Library content is shared between the Library and My Knowledge views, and
  // the reader/player overlays write progress and annotations back into it.
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>(initialLibraryItems);
  const [reader, setReader] = useState<LibraryItem | null>(null);
  const [player, setPlayer] = useState<LibraryItem | null>(null);
  const [articleItem, setArticleItem] = useState<LibraryItem | null>(null);
  const [bookOptions, setBookOptions] = useState<LibraryItem | null>(null);

  const updateItem = useCallback(
    (title: string, patch: (item: LibraryItem) => LibraryItem) =>
      setLibraryItems((items) =>
        items.map((item) => (item.title === title ? patch(item) : item)),
      ),
    [],
  );

  const activeRoot = () =>
    displayedRef.current === "assistant" ? assistantRef.current : pageRef.current;

  const navigate = useCallback((next: View) => {
    setView(next);
    pendingRef.current = next;
    // An exit is already running; it will show the latest requested page.
    if (exitRef.current) return;
    if (next === displayedRef.current) return;

    entranceRef.current.forEach((animation) => animation.cancel());
    entranceRef.current = [];
    const root = activeRoot();
    if (!root) {
      displayedRef.current = next;
      setDisplayedView(next);
      setEntranceToken((token) => token + 1);
      return;
    }
    const exit = hidePage(root);
    exitRef.current = exit;
    exit.finished
      .then(() => {
        exitRef.current = null;
        displayedRef.current = pendingRef.current;
        setDisplayedView(pendingRef.current);
        setEntranceToken((token) => token + 1);
      })
      .catch(() => {
        exitRef.current = null;
      });
  }, []);

  const openMedia = useCallback(
    (item: LibraryItem) => {
      if (item.type === "Podcasts") setPlayer(item);
      else if (item.type === "Articles") setArticleItem(item);
      else if (item.type === "Notes") navigate("knowledge");
      else if (item.pdfFileName || item.pdfUrl) setReader(item);
      else setBookOptions(item);
    },
    [navigate],
  );

  const jumpToSource = useCallback(
    (title: string, page: number) => {
      const item = libraryItems.find((entry) => entry.title === title);
      if (!item) return;
      if (item.type === "Books" && (item.pdfFileName || item.pdfUrl)) {
        setReader({ ...item, currentPage: page });
      } else {
        openMedia(item);
      }
    },
    [libraryItems, openMedia],
  );

  const saveReaderProgress = (
    title: string,
    currentPage: number,
    totalPages: number,
    bookmarks: BookmarkItem[],
    notes: NoteItem[],
    highlights: HighlightItem[],
    annotations: Annotation[],
  ) =>
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

  const savePodcastDetails = (updated: LibraryItem) =>
    updateItem(updated.title, (item) => ({ ...item, ...updated }));

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
      exitRef.current?.cancel();
      entranceRef.current.forEach((animation) => animation.cancel());
    },
    [],
  );

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
    if (displayedView === "today") return <TodayView navigate={navigate} />;
    if (displayedView === "calendar") return <CalendarView />;
    if (displayedView === "library")
      return (
        <LibraryView
          colorMode={colorMode}
          items={libraryItems}
          setItems={setLibraryItems}
          onOpenMedia={openMedia}
        />
      );
    if (displayedView === "knowledge")
      return (
        <KnowledgeView
          items={libraryItems}
          colorMode={colorMode}
          onJumpToSource={jumpToSource}
        />
      );
    if (displayedView === "health") return <HealthView />;
    if (displayedView === "settings")
      return (
        <SettingsView
          books={libraryItems}
          onUpdateBookStorage={updateBookStorage}
          colorMode={colorMode}
          onSignOut={onSignOut}
          userEmail={userEmail}
        />
      );
    return null;
  };

  return (
    <div className={`app-shell dark-app ${colorMode ? "color-mode" : ""}`}>
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
              <AssistantView />
            </div>
          )}
        </div>
      </div>
      <div className="global-controls">
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
      <nav className="bottom-nav">
        {(["today", "calendar", "assistant", "library", "health"] as const).map((id) => {
          const item = navItems.find((navItem) => navItem.id === id)!;
          const Icon = item.icon;
          const label = {
            today: "Today",
            calendar: "Calendar",
            assistant: "Assistant",
            library: "Library",
            health: "Health",
          }[id];
          return id === "assistant" ? (
            <button
              key={id}
              className={`assistant-tab ${view === id ? "active" : ""}`}
              onClick={() => navigate(id)}
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
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {reader && (
        <MyProDarkReader
          book={reader}
          isOpen
          colorMode={colorMode}
          onClose={() => setReader(null)}
          onSaveProgress={saveReaderProgress}
        />
      )}
      {player && (
        <MyProPodcastPlayer
          podcast={player}
          isOpen
          colorMode={colorMode}
          onClose={() => setPlayer(null)}
          onUpdateProgress={updatePodcastProgress}
          onSavePodcastDetails={savePodcastDetails}
        />
      )}
      {articleItem && (
        <ArticleReaderModal
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
            setReader(item);
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
      <Brand colorMode={colorMode} />
    </main>
  );
}

export default function App() {
  const { session, loading, configured } = useSession();
  const [colorMode, setColorMode] = useState(false);
  const toggleColorMode = () => setColorMode((active) => !active);

  // When Supabase isn't configured, the Welcome prototype still lets you in via
  // this local flag so the design stays demoable; with Supabase, the real
  // session is the single source of truth.
  const [previewEntered, setPreviewEntered] = useState(false);
  const authenticated = configured ? Boolean(session) : previewEntered;

  // Presence heartbeat — only meaningful with a real session + core API.
  useActivityHeartbeat(authenticated && configured);

  const handleSignOut = useCallback(() => {
    setPreviewEntered(false);
    void signOut();
  }, []);

  if (loading) return <AuthSplash colorMode={colorMode} />;

  return authenticated ? (
    <AppShell
      colorMode={colorMode}
      onToggleColor={toggleColorMode}
      onSignOut={handleSignOut}
      userEmail={session?.user?.email ?? null}
    />
  ) : (
    <Welcome
      onEnter={() => setPreviewEntered(true)}
      colorMode={colorMode}
      onToggleColor={toggleColorMode}
    />
  );
}
