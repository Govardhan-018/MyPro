# MyPro — Android Upgrade Plan

**Decision: the phone becomes a thin native shell around the web app.** One
codebase, one design, one place a bug gets fixed. The shell keeps the ~220
lines that are genuinely native — the Phase 11 clock and push arming — and
the UI becomes the web app itself.

> **Status (Nov 2026).** Decided, not built. `docs/PHASES.md` remains the
> record of what *is* built; this is the route for what replaces the phone's
> UI layer.

---

## 1. Why

Four rounds of hand-matching the Android app to the web's design closed every
gap that was pointed at and still did not arrive at "the same". The
measurement says why:

| | Lines |
|---|---|
| Android UI (`android/src/screens`, `src/components`, `App.tsx`) | 8,936 |
| Web UI + CSS (`frontend/src/App.tsx`, `index.css`, `reading-listening.css`) | 17,796 |
| Genuinely native Android code (`notifications.ts`, `client.ts`) | 220 |

**About 97% of the Android app exists only to re-draw what the web already
draws.** React Native has no cascade, no media queries, no pseudo-elements,
no grid, no `backdrop-filter` and no font inheritance, so nothing is shared —
only transcribed, by hand, twice. Two implementations drift by default;
closing the visible gaps only moves them somewhere nobody looked.

A WebView shell removes the second implementation rather than trying to keep
it in step. The UI cannot drift, because there is nothing to drift from.

**What survives unchanged:** `armUpcoming()` and `registerForPush()` run in
the native shell on `AppState` changes and call Render directly. They never
touched the UI. The clock — the thing that makes MyPro useful with the laptop
shut and the server asleep — is unaffected by any of this.

**What it costs:** no offline UI until §5 is done, some bridging work (back
button, deep links, session), and browser-grade scrolling and keyboard feel.
Step 0 below is there to test that feel before any of it is built.

---

## 2. Making it feel like an app, not a web page

One codebase, with the shell **announcing itself** so the web app can adapt
its presentation. The shell injects a marker before the page loads:

```js
injectedJavaScriptBeforeContentLoaded = "window.__MYPRO_SHELL__ = '1.0';"
```

`window.ReactNativeWebView` is also present automatically. The web app reads
this **once**, in a single `frontend/src/lib/shell.ts`, which exports an
`inShell` flag and a `postToShell()` helper. Nothing else sniffs the user
agent inline. A `.in-shell` class goes on `<body>` so most of the work can be
done in CSS.

### Turn off in the shell — presentation only

| What | How | Why |
|---|---|---|
| Pull-to-refresh, overscroll bounce | `overscroll-behavior: none` | The single biggest "this is a web page" tell |
| Double-tap zoom | `touch-action: manipulation` | Apps do not zoom their own chrome |
| Grey tap flash | `-webkit-tap-highlight-color: transparent` | |
| Long-press callout | `-webkit-touch-callout: none` | On chrome only |
| Text selection | `user-select: none` on nav, headers, buttons | **Never in the reader** — selecting text is the feature there |
| Links opening a browser tab | Route through the shell | A new Chrome tab breaks the illusion completely |

Nearly all of it is one CSS block under `.in-shell`, which is about as cheap
as a divergence gets.

### Turn on / change in the shell

- **`viewport-fit=cover`** on the viewport meta in `frontend/index.html`,
  which currently lacks it. Without it `env(safe-area-inset-*)` does not
  resolve inside the WebView and the layout ignores the notch and the home
  indicator — which reads as "web page" instantly.
- **Status bar styling** and **haptics** on key actions, via the shell.
- **Android back button** → WebView history (shell side).

### One that is a correctness bug, not polish

**Web push must be disabled in the shell.** `usePush` registers a browser
push subscription, and the native shell already runs `registerForPush()` and
`armUpcoming()`. Left alone, both fire: **every notification arrives twice**,
and because the two arm from different sources they drift apart over time.

Gate `usePush(enabled)` on `!inShell` and let the native clock own
notifications entirely. This one is not optional.

### The rule that keeps this from re-growing a second app

Every `if (inShell)` is a place the two experiences diverge — the exact thing
this upgrade exists to escape.

> **Branch on presentation and platform integration only. Never on features
> or data.**

If a branch changes *what the user can do* rather than *how it feels*, the
second app is growing back. Keeping every branch in `lib/shell.ts` makes them
countable, and a list that can be read in ten seconds stays honest.

---

## 3. The route

Staged so it can be abandoned cheaply at any point.

0. **Step 0 — two minutes, before any code.** Open the deployed web app in
   Chrome on the phone. That is within a rounding error of what the shell
   will feel like. If scrolling, the keyboard or the reader feel wrong, stop
   and reconsider — everything below assumes this passes.
1. **Spike — 1 day.** `react-native-webview` (a native module; needs a
   `prebuild` and a CI build to prove it, as `expo-blur` did) behind a dev
   toggle, pointed at the Vercel URL. Confirm sign-in and the reader on a
   real phone.
   *If this feels wrong, stop here: one day spent, native app untouched.*
2. **Session bridge — half a day.** The web posts its session out via
   `postToShell()`; the shell keeps it in AsyncStorage so `armUpcoming()`
   still has a token. Verify a brief fires with the laptop shut.
3. **Shell polish — half a day.** `lib/shell.ts`, the `.in-shell` CSS block,
   `viewport-fit=cover`, and the `usePush` gate from §2.
4. **Navigation — half a day.** Back button to WebView history; notification
   deep links to the right route (the web already reads its section from the
   URL hash, so this is a `#calendar`-style load).
5. **Cut over.** WebView becomes the default; the native screens stay one
   release behind a flag.
6. **Delete.** Remove `android/src/screens/**` and `android/src/components/**`.
   The payoff: ~8,900 lines, and half of every future design change, gone.

**Dependencies that go with them:** `@expo/vector-icons`,
`@expo-google-fonts/dm-sans`, `expo-blur`, `expo-linear-gradient` — all four
exist only to imitate the web's styling natively.

---

## 4. What this does not fix

**The reader will still not show the PDF.**

The web renders real PDFs with pdf.js from IndexedDB *on the device that
imported them*. A WebView on the phone is a separate browser profile with
empty storage, so it falls back to the synced extracted text — exactly what
the web app does on any second device.

That is identical behaviour to the web, which is the goal. It is not "the PDF
on your phone". That is a different question — whether PDF files should sync
at all — and Phase 10.2 deliberately answered it the other way, because the
file staying put is the privacy property the whole pipeline is built on.
Decide it separately, on its own merits. No amount of UI work resolves it.

---

## 5. Offline is its own piece — do not bundle it into the cutover

Caching the app shell so it opens without a connection is **Phase 13.2, the
one open item left in Phase 13**, not a shell toggle.

`frontend/public/sw.js` says in its own comment that it deliberately does not
cache the shell, because that means reasoning about stale bundles on every
Vercel deploy. Caching inside the app is more justified than in a browser
tab, but it needs a versioned cache and an update path — otherwise the phone
quietly runs last week's app with no way to be told.

Keep it out of the cutover and do it deliberately afterwards. It is the piece
with real risk, and the cutover is easier to judge without it.

---

## 6. Summary

| | |
|---|---|
| **Decision** | Thin native shell + WebView onto the deployed web app |
| **Kept native** | The Phase 11 clock, push arming, the session store |
| **Deleted** | ~8,900 lines of parallel UI, and four styling dependencies |
| **Feels native via** | One `lib/shell.ts` flag and one `.in-shell` CSS block |
| **Must not forget** | Disable web push in the shell, or notifications double |
| **Separate decisions** | PDF sync (§4), offline cache / Phase 13.2 (§5) |
