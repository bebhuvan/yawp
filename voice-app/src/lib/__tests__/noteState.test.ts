import { describe, expect, it } from "vitest";
import { removeNote, replaceExistingNote, upsertNote } from "../noteState";
import { note } from "./fixtures";


describe("noteState", () => {
  it("prepends a new note on upsert", () => {
    const existing = note({ id: "old" });
    const created = note({ id: "new" });

    expect(upsertNote([existing], created)).toEqual([created, existing]);
  });

  it("replaces an existing note on upsert without duplicating it", () => {
    const original = note({ id: "same", title: "Original" });
    const updated = note({ id: "same", title: "Updated" });

    expect(upsertNote([original], updated)).toEqual([updated]);
  });

  it("only replaces existing search results", () => {
    const original = note({ id: "same", title: "Original" });
    const updated = note({ id: "same", title: "Updated" });
    const missing = note({ id: "missing" });

    expect(replaceExistingNote([original], updated)).toEqual([updated]);
    expect(replaceExistingNote([original], missing)).toEqual([original]);
  });

  it("removes notes by id", () => {
    const keep = note({ id: "keep" });
    const remove = note({ id: "remove" });

    expect(removeNote([keep, remove], "remove")).toEqual([keep]);
  });
});
