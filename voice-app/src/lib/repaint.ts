export function installWebkitRepaintRecovery() {
  // Flush any pending WebKit layout so the compositor has fresh content to
  // blit. Avoid the previous opacity:0.999 trick — with
  // WEBKIT_DISABLE_COMPOSITING_MODE=1 that forced a new compositing layer on
  // a disabled compositing path, which made blanks worse, not better.
  const poke = () => {
    requestAnimationFrame(() => void document.documentElement.offsetHeight);
  };

  window.addEventListener("focus", poke);
  window.addEventListener("pageshow", poke);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poke();
  });
}
