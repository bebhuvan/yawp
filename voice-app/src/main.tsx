import React from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installWebkitRepaintRecovery } from "./lib/repaint";
import "./styles/globals.css";

installWebkitRepaintRecovery();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

// The native window starts hidden; the backend reveals it on "app-ready".
// Wait two frames so the first real paint has landed before we show it —
// this is what removes the black flash WebKitGTK shows pre-paint.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void emit("app-ready");
  });
});
