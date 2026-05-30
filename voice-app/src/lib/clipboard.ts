// navigator.clipboard.writeText() can block WebKitGTK's JS thread on Linux:
// the browser has to complete a synchronous X11 selection-ownership exchange
// before the Promise resolves, which stalls rendering and makes the window go
// blank. document.execCommand('copy') routes through GTK's clipboard directly
// and is non-blocking, so we use it exclusively inside Tauri.
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function writeToClipboard(text: string): Promise<void> {
  if (isTauri) {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    if (!ok) throw new Error("copy failed");
    return;
  }
  await navigator.clipboard.writeText(text);
}
