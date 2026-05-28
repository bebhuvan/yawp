import React from "react";


export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Yawp render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-[680px] px-12 pt-20">
        <h1 className="display-tight text-[28px] text-ink">Yawp hit a UI error</h1>
        <p className="mt-4 font-serif text-[16px] text-ink-soft">
          The app stayed open, but this screen failed to render. Restart the
          window after checking the console logs.
        </p>
        <pre className="mt-8 overflow-auto rounded bg-paper-deep p-4 numeric text-[11px] text-ink-soft">
          {this.state.error.message}
        </pre>
      </main>
    );
  }
}
