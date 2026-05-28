import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useNoteSearch } from "../useNoteSearch";
import { note } from "./fixtures";


vi.mock("../api", () => ({
  api: {
    search: vi.fn(),
  },
}));

describe("useNoteSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.search).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns original notes when search is inactive", () => {
    const notes = [note({ id: "one" })];
    const { result } = renderHook(() => useNoteSearch(notes));

    expect(result.current.displayedNotes).toEqual(notes);
    expect(result.current.results).toBeNull();
  });

  it("debounces search and displays results", async () => {
    const found = note({ id: "found", title: "Found" });
    vi.mocked(api.search).mockResolvedValue([found]);

    const { result } = renderHook(() => useNoteSearch([note({ id: "base" })]));

    act(() => {
      result.current.setActive(true);
      result.current.setValue("found");
    });
    await act(async () => {
      vi.advanceTimersByTime(140);
      await Promise.resolve();
    });

    expect(result.current.results).toEqual([found]);
    expect(api.search).toHaveBeenCalledWith("found");
    expect(result.current.displayedNotes).toEqual([found]);
  });

  it("reset clears active search state", () => {
    const { result } = renderHook(() => useNoteSearch([note()]));

    act(() => {
      result.current.setActive(true);
      result.current.setValue("query");
      result.current.setResults([note({ id: "result" })]);
      result.current.reset();
    });

    expect(result.current.active).toBe(false);
    expect(result.current.value).toBe("");
    expect(result.current.results).toBeNull();
  });
});
