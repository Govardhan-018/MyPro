import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initShell } from "./lib/shell";
import "./index.css";
import "./reading-listening.css";

// Adapt presentation when running inside the native shell (sets the .in-shell
// body class, viewport-fit=cover, and the session bridge). No-op in a browser.
initShell();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
