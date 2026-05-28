import { Mic, Settings as SettingsIcon, Square } from "lucide-react";
import { longDate } from "../lib/utils";
import { SearchBox } from "./SearchBox";

interface TopBarProps {
  view: "library" | "settings" | "trash" | "ask";
  onNavigate: (v: "library" | "settings") => void;
  onRecord: () => void;
  recording: boolean;
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchActive: boolean;
  onSearchActivate: () => void;
  onSearchDeactivate: () => void;
}

export function TopBar({
  view,
  onNavigate,
  onRecord,
  recording,
  searchValue,
  onSearchChange,
  searchActive,
  onSearchActivate,
  onSearchDeactivate,
}: TopBarProps) {
  const today = longDate(new Date());

  return (
    <header className="relative z-20 pt-8 pb-7">
      <div className="mx-auto flex max-w-[860px] items-end justify-between px-12">
        <div className="drag">
          <div className="flex items-baseline gap-2.5">
            <button
              onClick={() => onNavigate("library")}
              className="no-drag display-tight text-[28px] text-ink leading-none cursor-pointer text-action hover:opacity-70"
              style={{ letterSpacing: "-0.025em" }}
            >
              Yawp
            </button>
            <span
              className="font-serif text-[15.5px] italic"
              style={{ color: "var(--color-ink-quiet)" }}
            >
              in&thinsp;
              <span style={{ color: "var(--color-ink-soft)" }}>
                {view === "settings"
                  ? "settings"
                  : searchActive && searchValue
                    ? `“${searchValue}”`
                    : "notes"}
              </span>
            </span>
          </div>
          <div className="mt-2 eyebrow">{today}</div>
        </div>

        <nav className="no-drag flex items-center gap-4">
          {/* Always reserve the search slot's width so the right-side nav
              doesn't shift when navigating between library and settings.
              SearchBox itself is hidden on non-library views. */}
          <div
            style={{
              width: 220,
              visibility: view === "library" ? "visible" : "hidden",
            }}
            aria-hidden={view !== "library"}
          >
            <SearchBox
              value={searchValue}
              onChange={onSearchChange}
              active={searchActive}
              onActivate={onSearchActivate}
              onDeactivate={onSearchDeactivate}
            />
          </div>
          <button
            onClick={() => onNavigate("settings")}
            className={`rail-control text-action flex items-center gap-2 px-2.5 cursor-pointer ${
              view === "settings"
                ? "text-ink"
                : "text-ink-quiet hover:text-ink-soft"
            }`}
            aria-label="Open settings"
          >
            <SettingsIcon size={13} strokeWidth={1.7} aria-hidden />
            Settings
          </button>
          <button
            onClick={onRecord}
            className="no-drag rail-control text-action group flex items-center gap-2.5 px-2.5 cursor-pointer"
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {recording ? (
              <Square size={12} strokeWidth={1.8} fill="var(--color-accent)" color="var(--color-accent)" aria-hidden />
            ) : (
              <Mic size={14} strokeWidth={1.8} color="var(--color-ink)" aria-hidden />
            )}
            <span
              className="font-serif text-[15px] transition-colors"
              style={{
                color: recording ? "var(--color-accent)" : "var(--color-ink)",
              }}
            >
              {recording ? "Stop" : "Record"}
            </span>
          </button>
        </nav>
      </div>
    </header>
  );
}
