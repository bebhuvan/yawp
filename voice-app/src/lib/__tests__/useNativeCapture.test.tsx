import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useNativeCapture } from "../useNativeCapture";
import { note } from "./fixtures";


vi.mock("../api", () => ({
  api: {
    captureCancel: vi.fn(),
    captureStart: vi.fn(),
    captureStopAndSave: vi.fn(),
    health: vi.fn(),
  },
  userMessage: (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
}));

describe("useNativeCapture", () => {
  const setSidecarUp = vi.fn();
  const showToast = vi.fn();

  beforeEach(() => {
    setSidecarUp.mockReset();
    showToast.mockReset();
    vi.mocked(api.captureCancel).mockReset();
    vi.mocked(api.captureStart).mockReset();
    vi.mocked(api.captureStopAndSave).mockReset();
    vi.mocked(api.health).mockReset();
  });

  it("starts capture and moves to recording state", async () => {
    vi.mocked(api.captureStart).mockResolvedValue({ recording: true });
    const { result } = renderHook(() =>
      useNativeCapture({ sidecarUp: true, setSidecarUp, showToast }),
    );

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });

    expect(api.captureStart).toHaveBeenCalledOnce();
    expect(result.current.flow).toBe("recording");
    expect(result.current.nativeRecording).toBe(true);
  });

  it("checks health before starting when sidecar was previously down", async () => {
    vi.mocked(api.health).mockResolvedValue({
      ok: true,
      backends: [],
      default_model: "test",
      model_ready: true,
      db_path: "db",
      notes_count: 0,
      openrouter_configured: false,
    });
    vi.mocked(api.captureStart).mockResolvedValue({ recording: true });
    const { result } = renderHook(() =>
      useNativeCapture({ sidecarUp: false, setSidecarUp, showToast }),
    );

    await act(async () => {
      await result.current.start();
    });

    expect(api.health).toHaveBeenCalledOnce();
    expect(setSidecarUp).toHaveBeenCalledWith(true);
    expect(api.captureStart).toHaveBeenCalledOnce();
  });

  it("stops and saves through the atomic backend endpoint", async () => {
    const saved = note({ id: "saved", mode: "paste" });
    vi.mocked(api.captureStopAndSave).mockResolvedValue(saved);
    const { result } = renderHook(() =>
      useNativeCapture({ sidecarUp: true, setSidecarUp, showToast }),
    );

    await act(async () => {
      result.current.setNativeRecording(true);
    });
    let returned = null;
    await act(async () => {
      returned = await result.current.stopAndSave("paste");
    });

    expect(api.captureStopAndSave).toHaveBeenCalledWith("paste");
    expect(returned).toEqual(saved);
    expect(result.current.flow).toBe("idle");
    expect(result.current.nativeRecording).toBe(false);
  });

  it("cancels capture and clears recording state", async () => {
    vi.mocked(api.captureCancel).mockResolvedValue({ recording: false });
    const { result } = renderHook(() =>
      useNativeCapture({ sidecarUp: true, setSidecarUp, showToast }),
    );

    await act(async () => {
      result.current.setNativeRecording(true);
    });
    await act(async () => {
      await result.current.cancel();
    });

    expect(api.captureCancel).toHaveBeenCalledOnce();
    expect(result.current.nativeRecording).toBe(false);
  });
});
