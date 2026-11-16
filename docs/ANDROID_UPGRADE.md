# MyPro — Android Upgrade Plan

**How to make the phone and the browser the same product, and why four rounds
of hand-matching did not get there.**

> **Status (Nov 2026).** Nothing here is built yet. This is the decision and
> the route, written down after the Android app was rebuilt in the web app's
> visual language (`docs/PHASES.md` 13.5–13.9) and still did not match it.
> `docs/PHASES.md` remains the record of what *is* built.

---

## 1. The problem, in numbers

| | Lines |
|---|---|
| Android UI (`android/src/screens`, `src/components`, `App.tsx`) | 8,936 |
| Web UI + CSS (`frontend/src/App.tsx`, `index.css`, `reading-listening.css`) | 17,796 |
| Genuinely native Android code (`notifications.ts`, `client.ts`) | 220 |

**About 97% of the Android app exists only to re-draw what the web already
draws.** Two implementations, in two languages with incompatible styling
models, maintained by hand.

They do not drift because anyone was careless. They drift because that is
what two implementations do. React Native has no cascade, no media queries,
no pseudo-elements, no grid, no `backdrop-filter`, no gradients without a
native module, and no font inheritance — so nothing can be shared, only
transcribed. Every design change has to be made twice and *judged* twice.

The consequence, observed four times now: each round closes the gaps someone
noticed, and new ones surface in the places nobody looked. The approach
converges asymptotically and never arrives, at double the cost forever.

So "make the app exactly like the web" is not a design task. It is an
architecture decision.

---

## 2. Test the conclusion before funding it

**Open the deployed web app in Chrome on the phone.**

That is, to within a rounding error, what Option A below would look and feel
like — same code, same pixels, same behaviour. It costs two minutes and
commits nothing.

- If it feels right → Option A is mostly mechanical from there.
- If scrolling, the keyboard or the reader feel wrong → stop. Stay native,
  and close specific gaps as they are reported.

Do this first. Everything below is downstream of the answer.

---

## 3. The options

### Option A — WebView shell *(recommended)*

Keep `android/` as a thin Expo shell: the ~220 lines that are genuinely
native, plus a WebView pointed at the deployed web app. Retire the ~8,900
lines of parallel UI.

**Why it is the only option that actually delivers parity:** the UI *is* the
web app. It cannot drift, because there is nothing to drift from. One
codebase, one design, one place a bug gets fixed.

**What survives unchanged:**

- **The Phase 11 clock.** `armUpcoming()` runs in the native shell on
  `AppState` changes and calls Render directly. It never needed the UI. This
  is the whole reason the app exists with the laptop shut, and a WebView does
  not touch it.
- **Push registration** (`registerForPush`), for the same reason.
- **Speed.** The UI is served by Vercel — always on, fast. Only data calls
  hit Render's sleepy free tier, exactly as the browser does today.

**Honest costs:**

- **No offline UI.** `frontend/public/sw.js` deliberately does not cache the
  app shell, and its comment explains why (stale bundles across Vercel
  deploys). Today's native app has the same practical limit — everything but
  the reader needs the network — so this is a smaller change than it sounds,
  but it is a real one.
- **Bridging work:** the Android back button to WebView history, notification
  deep links into the right route, and a ~30-line session bridge so the
  native clock has a token (the web posts the session out via
  `window.ReactNativeWebView.postMessage`; the shell keeps it in
  AsyncStorage).
- **Feel.** Scrolling, the keyboard and overscroll are browser-grade, not
  native. This is the main thing the two-minute test in §2 is for.

### Option B — react-native-web

One codebase rendering both targets, by rewriting the web app in React Native
primitives. ~17,800 lines of UI and CSS to port. Months of work, and the web
app comes out worse than it is now. **Not recommended.**

### Option C — keep transcribing

What has been done so far. It works, the app is good, and it never finishes.
Reasonable *only* if the two-minute test says a WebView feels wrong.

---

## 4. The route for Option A

Staged so it can be abandoned cheaply at any point.

1. **Spike — 1 day.** A WebView screen behind a dev toggle, pointed at the
   Vercel URL. Confirm sign-in, the reader and the feel on a real phone.
   *If this feels wrong, stop here. One day spent, native app untouched.*
2. **Session bridge — half a day.** The web posts its session to the shell;
   the shell stores it and keeps arming notifications. Verify a brief still
   fires with the laptop shut.
3. **Navigation — half a day.** Android back button to WebView history,
   notification deep links to the right route (the web already reads the
   section from the URL hash, so this is a `#calendar`-style load).
4. **Cut over.** Make the WebView the default; keep the native screens one
   release behind a flag.
5. **Delete.** Remove `android/src/screens/**` and `android/src/components/**`
   once a release has proven the shell. This is the payoff: ~8,900 lines, and
   half of every future design change, gone.

**Dependencies that can then also go:** `@expo/vector-icons`,
`@expo-google-fonts/dm-sans`, `expo-blur`, `expo-linear-gradient` — all four
exist only to imitate the web's styling natively.

---

## 5. What no option fixes

**The reader will still not show the PDF.**

The web renders real PDFs with pdf.js from IndexedDB *on the device that
imported them*. A WebView on the phone is a separate browser profile with
empty storage, so it falls back to the synced extracted text — which is
precisely what the web app does on any second device.

That is genuinely identical behaviour to the web, which is what was asked
for. It is not "the PDF on your phone." Those are different questions, and
the second one is about whether PDF files should sync at all — an
architecture decision deliberately taken the other way in Phase 10.2, because
the file staying put is the privacy property the whole pipeline is built on.

Decide that separately, on its own merits. It is not a UI problem and no
amount of UI work will resolve it.

---

## 6. Recommendation

Run the two-minute test in §2 today.

If it passes, take Option A and follow §4. The result is a phone app that is
the web app, a single design to maintain, and ~8,900 fewer lines to keep in
sync — while the notification clock, the part that makes MyPro useful with
everything else switched off, carries on exactly as it does now.
