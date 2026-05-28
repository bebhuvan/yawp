import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Note } from "./types";


export function useNoteSearch(notes: Note[]) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [results, setResults] = useState<Note[] | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setResults(null);
      return;
    }
    const q = value.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (seq === seqRef.current) setResults(r);
      } catch (e) {
        console.error(e);
      }
    }, 140);
    return () => clearTimeout(t);
  }, [active, value]);

  return {
    active,
    value,
    results,
    displayedNotes: results ?? notes,
    setActive,
    setValue,
    setResults,
    reset: () => {
      setActive(false);
      setValue("");
      setResults(null);
    },
  };
}
