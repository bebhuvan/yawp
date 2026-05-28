export function installWebkitRepaintRecovery() {
  const poke = () => {
    const root = document.getElementById("root");
    if (!root) return;
    root.style.opacity = "0.999";
    void root.offsetHeight; // synchronous reflow
    requestAnimationFrame(() => {
      root.style.opacity = "";
    });
  };

  window.addEventListener("focus", poke);
  window.addEventListener("pageshow", poke);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poke();
  });
}
