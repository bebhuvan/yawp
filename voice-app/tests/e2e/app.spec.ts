import { expect, test, type Page } from "@playwright/test";

const note = {
  id: "note-1",
  title: "Release hardening",
  transcript:
    "Make the app robust, reliable, and polished enough for daily dictation.",
  language: "en",
  model: "faster-whisper:base.en",
  mode: "notes",
  durationSec: 4.2,
  audioPath: null,
  createdAt: "2026-05-16T10:00:00.000Z",
  tags: ["quality", "release"],
  todos: [],
  folderId: "folder-product",
  smartMetadata: {
    summary: "A release hardening note about robustness and polish.",
    kind: "idea",
    collection: "Product",
    keywords: ["robustness"],
    source: "test",
  },
};

const folders = [
  {
    id: "folder-product",
    name: "Product",
    createdAt: "2026-05-16T09:30:00.000Z",
    noteCount: 1,
  },
];

test.beforeEach(async ({ page }) => {
  await mockSidecar(page);
});

test("library renders notes and highlighted search snippets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Yawp" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Release hardening" })).toBeVisible();

  await page.getByPlaceholder("search").fill("robust");

  await expect(page.getByText("Make the app")).toBeVisible();
  await expect(page.locator("mark", { hasText: "robust" })).toBeVisible();
});

test("settings exposes runtime status without a terminal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();

  await expect(page.getByText("System status")).toBeVisible();
  await expect(page.getByRole("combobox").first()).toBeVisible();
  // The downloadable-model comparison is a collapsible disclosure; expand it.
  await expect(page.getByText("Compare downloadable models")).toBeVisible();
  await page.getByText("Compare downloadable models").click();
  await expect(page.getByText("Reliable downloadable models")).toBeVisible();
  await expect(page.getByText("Distil-Whisper Large v3")).toBeVisible();
  await expect(page.getByText("Daemon", { exact: true })).toBeVisible();
  await expect(page.getByText("Loaded mode", { exact: true })).toBeVisible();
  await expect(page.getByText("Auto-organize into folders")).toBeVisible();
  await expect(page.getByText("./scripts/doctor")).toBeVisible();
});

test("polish is previewed before it mutates the note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Release hardening" }).click();
  await page.getByRole("button", { name: /polish/i }).click();

  const dialog = page.getByRole("dialog", { name: "Review polished transcript" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Current")).toBeVisible();
  await expect(dialog.getByText("Proposed")).toBeVisible();
  await expect(dialog.getByText("daily dictation").first()).toBeVisible();
});

test("organize enriches note metadata without leaving the page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Release hardening" }).click();
  await page.getByRole("button", { name: /organize/i }).click();

  await expect(page.getByText("Organized with AI.")).toBeVisible();
  await expect(
    page.getByRole("complementary").getByText("Product ideas for a refined dictation app."),
  ).toBeVisible();
});

test("folders filter and move notes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: /Product\s+1/ })).toBeVisible();
  await page.getByRole("button", { name: /Product\s+1/ }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Folder name").fill("Ideas");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Folder renamed.")).toBeVisible();

  await page.getByRole("button", { name: /Unfiled\s+0/ }).click();
  await expect(page.getByText("No notes here.")).toBeVisible();

  await page.getByRole("button", { name: /All\s+1/ }).click();
  await page.getByRole("heading", { name: "Release hardening" }).click();
  await page.getByLabel("Move note to folder").selectOption("");

  await expect(page.getByText("Removed from folder.")).toBeVisible();
});

async function mockSidecar(page: Page) {
  await page.route("http://127.0.0.1:17893/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/health") {
      return route.fulfill({
        json: {
          ok: true,
          backends: ["faster-whisper:base.en"],
          default_model: "base.en",
          model_ready: true,
          db_path: "/tmp/yawp-test.db",
          notes_count: 1,
          openrouter_configured: false,
        },
      });
    }

    if (url.pathname === "/settings" && method === "GET") {
      return route.fulfill({
        json: {
          asr_model: "base.en",
          input_device: null,
          cleanup_enabled: true,
          voice_commands_enabled: false,
          live_transcription_enabled: true,
          auto_tag_enabled: true,
          extract_todos_enabled: false,
          auto_organize_enabled: true,
          auto_organize_min_confidence: 0.65,
          openrouter_model: "openai/gpt-oss-20b:free",
          openrouter_api_key_set: false,
          max_tags: 5,
          hotkey_mode: "toggle",
          hotkey_notes: "<ctrl>+<alt>+n",
          hotkey_paste: "<ctrl>+<alt>+v",
          hold_key_notes: "<menu>",
          hold_key_paste: "<ctrl_r>",
          auto_stop_ms: 1200,
          audio_feedback_enabled: false,
          export_path: "",
          auto_export_enabled: false,
        },
      });
    }

    if (url.pathname === "/diagnostics") {
      return route.fulfill({
        json: {
          host: "127.0.0.1",
          port: 17893,
          data_dir: "/tmp/.voice",
          audio_dir: "/tmp/.voice/audio",
          db_path: "/tmp/.voice/notes.db",
          imports: { fastapi: true, sounddevice: true },
          tools: { xdotool: true, wtype: false, dotool: false, "notify-send": true },
          paste: { session: "x11", selected_tool: "xdotool", ready: true },
          daemon: {
            running: true,
            socket: "/tmp/.voice/daemon.sock",
            status: "idle",
            detail: {
              state: "idle",
              recording_mode: null,
              hotkey_mode: "toggle",
              auto_stop_ms: 1200,
              audio_feedback_enabled: false,
              bindings: {
                hotkey_notes: "<ctrl>+<alt>+n",
                hotkey_paste: "<ctrl>+<alt>+v",
                hold_key_notes: "<menu>",
                hold_key_paste: "<ctrl_r>",
              },
              paste_tool: "xdotool",
            },
          },
          database: { ready: true, path: "/tmp/.voice/notes.db", notes_count: 1 },
          settings: {
            asr_model: "base.en",
            input_device: null,
            hotkey_mode: "toggle",
            hotkey_notes: "<ctrl>+<alt>+n",
            hotkey_paste: "<ctrl>+<alt>+v",
            hold_key_notes: "<menu>",
            hold_key_paste: "<ctrl_r>",
            auto_stop_ms: 1200,
            audio_feedback_enabled: false,
            auto_organize_enabled: true,
            auto_organize_min_confidence: 0.65,
            openrouter_configured: false,
          },
          model: {
            configured: "base.en",
            active_backend: "faster-whisper:base.en",
            active_model: "base.en",
            loaded: true,
            restart_required: false,
            device: "cpu",
            compute_type: "int8",
          },
          microphone: {
            available: true,
            name: "Test microphone",
            channels: 1,
            default_samplerate: 16000,
            selected_index: null,
          },
          port_available: false,
        },
      });
    }

    if (url.pathname === "/audio/input-devices") {
      return route.fulfill({
        json: {
          selected: null,
          devices: [
            {
              index: 0,
              name: "Test microphone",
              channels: 1,
              defaultSamplerate: 16000,
              isDefault: true,
              selected: true,
            },
          ],
        },
      });
    }

    if (url.pathname === "/capture/status") {
      return route.fulfill({ json: { recording: false } });
    }

    if (url.pathname === "/notes") {
      return route.fulfill({ json: { notes: [note] } });
    }

    if (url.pathname === "/folders") {
      return route.fulfill({ json: { folders } });
    }

    if (url.pathname === "/folders/folder-product" && method === "PATCH") {
      return route.fulfill({
        json: {
          ...folders[0],
          name: "Ideas",
        },
      });
    }

    if (url.pathname === "/folders/folder-product" && method === "DELETE") {
      return route.fulfill({ status: 204 });
    }

    if (url.pathname === "/search") {
      return route.fulfill({
        json: {
          query: url.searchParams.get("q") || "",
          notes: [
            {
              ...note,
              searchSnippet: "Make the app [[robust]], reliable, and polished.",
            },
          ],
        },
      });
    }

    if (url.pathname === "/polish") {
      return route.fulfill({
        json: {
          text:
            "Make the app robust, reliable, and polished enough for daily dictation.",
          source: "cleanup-only",
        },
      });
    }

    if (url.pathname === "/notes/note-1/organize") {
      return route.fulfill({
        json: {
          ...note,
          tags: ["quality", "release", "product"],
          smartMetadata: {
            summary: "Product ideas for a refined dictation app.",
            kind: "idea",
            collection: "Product",
            keywords: ["organization", "search"],
            source: "openrouter",
          },
        },
      });
    }

    if (url.pathname === "/notes/note-1/folder") {
      return route.fulfill({
        json: {
          ...note,
          folderId: null,
        },
      });
    }

    if (url.pathname === "/events") {
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body: "event: hello\ndata: {}\n\n",
      });
    }

    return route.fulfill({ status: 404, json: { detail: "not mocked" } });
  });
}
