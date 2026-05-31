import { emit } from "@tauri-apps/api/event";

let repaintPending = false;

export function requestNativeRepaint() {
  if (repaintPending) return;
  repaintPending = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      repaintPending = false;
      void document.documentElement.offsetHeight;
      void emit("yawp-repaint").catch(() => {
        // Browser/dev preview: no Tauri event bridge is available.
      });
    });
  });
}

export function installWebkitRepaintRecovery() {
  // Flush WebKit layout and ask the native shell for a real GTK repaint.
  // Avoid the previous opacity:0.999 trick: with software compositing it forced
  // a new layer on the path that was already blanking.
  window.addEventListener("focus", requestNativeRepaint);
  window.addEventListener("pageshow", requestNativeRepaint);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestNativeRepaint();
  });
}
