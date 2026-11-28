import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initShell } from "./lib/shell";
import { installFonts } from "./lib/fonts";
import { startOutbox } from "./lib/outbox";
import "./index.css";
import "./styles/tokens.css";
import "./reading-listening.css";

// Adapt presentation when running inside the native shell (sets the .in-shell
// body class, viewport-fit=cover, and the session bridge). No-op in a browser.
initShell();

// Bundled typefaces (offline-safe; no Google Fonts request).
installFonts();

// Reading progress, notes and bookmarks queue here and sync whenever there is
// a connection (back online, back to the foreground, on the way out).
startOutbox();

// The service worker lets the app itself open offline (and delivers web push).
// Production only: in `vite dev` it would cache modules mid-edit.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
