import { useMemo, useState } from "react";
import type { Folder, Note } from "../lib/types";
import { relativeDay } from "../lib/utils";
import { NoteRow } from "./NoteRow";

type FolderFilter = "all" | "uncategorized" | string;

export function Library({
  notes,
  allNotesCount,
  folders,
  selectedFolderId,
  folderCounts,
  onFolderSelect,
  onFolderCreate,
  onFolderRename,
  onFolderDelete,
  onOpen,
  onEdit,
  onDelete,
  onBulkDelete,
  onOpenTrash,
  onOpenAsk,
}: {
  notes: Note[];
  allNotesCount: number;
  folders: Folder[];
  selectedFolderId: FolderFilter;
  folderCounts: Record<string, number>;
  onFolderSelect: (folderId: FolderFilter) => void;
  onFolderCreate: (name: string) => Promise<void>;
  onFolderRename: (id: string, name: string) => Promise<void>;
  onFolderDelete: (id: string) => Promise<void>;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onBulkDelete: (ids: string[]) => Promise<void>;
  onOpenTrash: () => void;
  onOpenAsk: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const sorted = useMemo(
    () => [...notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [notes],
  );

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((n) => selectedIds.has(n.id));

  const toggleSelectAll = () =>
    setSelectedIds(
      allVisibleSelected ? new Set() : new Set(sorted.map((n) => n.id)),
    );

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await onBulkDelete(Array.from(selectedIds));
      exitSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const saveFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    setSavingFolder(true);
    try {
      await onFolderCreate(name);
      setNewFolder("");
      setCreating(false);
    } finally {
      setSavingFolder(false);
    }
  };
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId);

  const startRename = () => {
    if (!selectedFolder) return;
    setRenamingId(selectedFolder.id);
    setRenameValue(selectedFolder.name);
  };

  const saveRename = async () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) return;
    setFolderBusy(true);
    try {
      await onFolderRename(renamingId, name);
      setRenamingId(null);
      setRenameValue("");
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteSelectedFolder = async () => {
    if (!selectedFolder) return;
    setFolderBusy(true);
    try {
      await onFolderDelete(selectedFolder.id);
      setRenamingId(null);
      setRenameValue("");
    } finally {
      setFolderBusy(false);
    }
  };

  if (allNotesCount === 0) {
    return (
      <div className="page-in mx-auto max-w-[620px] px-12 pt-28 pb-32 text-center">
        <p
          className="display text-[44px] text-ink leading-[1.05]"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50, "wght" 360' }}
        >
          Nothing yet.
        </p>
        <p
          className="mt-7 font-serif text-[16px] text-ink-quiet italic"
          style={{ lineHeight: 1.7 }}
        >
          Press Record — or the global hotkey — and your first note will
          appear here.
        </p>
      </div>
    );
  }

  let prevDay: string | null = null;

  return (
    <div className="page-in mx-auto grid max-w-[1120px] grid-cols-1 gap-12 px-8 pb-32 md:grid-cols-[184px_1fr] md:px-12">
      <aside className="pt-6 md:sticky md:top-20 md:self-start">
        <div className="eyebrow mb-5">Folders</div>
        <nav className="flex gap-2 overflow-auto pb-2 md:block md:overflow-visible md:pb-0">
          <FolderButton
            name="All"
            count={allNotesCount}
            active={selectedFolderId === "all"}
            onClick={() => onFolderSelect("all")}
          />
          <FolderButton
            name="Unfiled"
            count={folderCounts.uncategorized || 0}
            active={selectedFolderId === "uncategorized"}
            onClick={() => onFolderSelect("uncategorized")}
          />
          {folders.map((folder) => (
            <FolderButton
              key={folder.id}
              name={folder.name}
              count={folderCounts[folder.id] ?? folder.noteCount}
              active={selectedFolderId === folder.id}
              onClick={() => onFolderSelect(folder.id)}
            />
          ))}
        </nav>
        {creating ? (
          <form
            className="mt-4 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveFolder();
            }}
          >
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="folder"
              className="min-w-0 flex-1 border-0 border-b border-rule-soft bg-transparent py-1 font-serif text-[14px] text-ink outline-none focus:border-rule"
              autoFocus
            />
            <button
              type="submit"
              disabled={savingFolder || !newFolder.trim()}
              className="eyebrow cursor-pointer hover:text-ink disabled:opacity-50"
            >
              Add
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="eyebrow mt-4 cursor-pointer hover:text-ink transition-colors"
          >
            New folder
          </button>
        )}
        {selectedFolder && (
          <div className="mt-5 border-t border-rule-soft pt-4">
            {renamingId === selectedFolder.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveRename();
                }}
              >
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="min-w-0 flex-1 border-0 border-b border-rule-soft bg-transparent py-1 font-serif text-[14px] text-ink outline-none focus:border-rule"
                  aria-label="Folder name"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={folderBusy || !renameValue.trim()}
                  className="eyebrow cursor-pointer hover:text-ink disabled:opacity-50"
                >
                  Save
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={startRename}
                  disabled={folderBusy}
                  className="eyebrow cursor-pointer hover:text-ink disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedFolder}
                  disabled={folderBusy}
                  className="eyebrow cursor-pointer hover:text-ink disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={onOpenAsk}
            className="eyebrow block cursor-pointer text-ink-quiet hover:text-ink transition-colors text-left"
          >
            Ask your notes
          </button>
          <button
            type="button"
            onClick={onOpenTrash}
            className="eyebrow block cursor-pointer text-ink-quiet hover:text-ink transition-colors text-left"
          >
            Trash
          </button>
        </div>
      </aside>

      <section className="min-w-0">
        {sorted.length > 0 && (
          <div className="flex items-center justify-between gap-4 pt-6 pb-2 min-h-[28px]">
            {selecting ? (
              <>
                <div className="flex items-center gap-5">
                  <span className="eyebrow text-ink-quiet">
                    {selectedIds.size} selected
                  </span>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="eyebrow cursor-pointer hover:text-ink transition-colors"
                  >
                    {allVisibleSelected ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={deleteSelected}
                    disabled={bulkBusy || selectedIds.size === 0}
                    className="eyebrow cursor-pointer transition-colors disabled:opacity-50"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {bulkBusy ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={exitSelection}
                    disabled={bulkBusy}
                    className="eyebrow cursor-pointer hover:text-ink transition-colors disabled:opacity-50"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSelecting(true)}
                className="eyebrow ml-auto cursor-pointer hover:text-ink transition-colors"
              >
                Select
              </button>
            )}
          </div>
        )}
        {sorted.length === 0 ? (
          <div className="pt-24 text-center">
            <p
              className="display text-[36px] text-ink leading-[1.08]"
              style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50, "wght" 360' }}
            >
              No notes here.
            </p>
          </div>
        ) : (
          sorted.map((note, i) => {
            const day = relativeDay(note.createdAt);
            const isFirstOfDay = day !== prevDay;
            prevDay = day;
            return (
              <NoteRow
                key={note.id}
                note={note}
                folderName={folders.find((f) => f.id === note.folderId)?.name}
                dayLabel={isFirstOfDay ? day : null}
                firstOfDay={isFirstOfDay}
                firstOverall={i === 0}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
                selecting={selecting}
                selected={selectedIds.has(note.id)}
                onToggleSelect={toggleSelect}
              />
            );
          })
        )}

        <footer className="mt-32 pt-6 text-center">
          <p className="eyebrow">
            {sorted.length} {sorted.length === 1 ? "note" : "notes"} · stored
            locally
          </p>
        </footer>
      </section>
    </div>
  );
}

function FolderButton({
  name,
  count,
  active,
  onClick,
}: {
  name: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-[132px] items-baseline justify-between gap-5 border-b px-0 py-2 text-left md:w-full md:min-w-0"
      style={{
        borderColor: active ? "var(--color-ink)" : "var(--color-rule-soft)",
        color: active ? "var(--color-ink)" : "var(--color-ink-quiet)",
      }}
    >
      <span className="min-w-0 truncate font-serif text-[14px]">{name}</span>
      <span className="numeric shrink-0 text-[11px] text-ink-faint">{count}</span>
    </button>
  );
}
