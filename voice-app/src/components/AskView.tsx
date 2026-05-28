import { useState } from "react";
import { api, userMessage, type AskAnswer } from "../lib/api";

export function AskView({
  onBack,
  onOpenNote,
  openRouterConfigured,
}: {
  onBack: () => void;
  onOpenNote: (id: string) => void;
  openRouterConfigured: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      setResult(await api.askNotes(q));
    } catch (e) {
      setError(userMessage(e, "Couldn't answer that."));
      setResult(null);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="page-in mx-auto max-w-[760px] px-12 pb-32">
      <button
        onClick={onBack}
        className="eyebrow mt-2 mb-12 cursor-pointer hover:text-ink-soft transition-colors"
      >
        ← Back to notes
      </button>

      <h1
        className="display-tight text-[34px] text-ink leading-tight"
        style={{ letterSpacing: "-0.022em" }}
      >
        Ask your notes
      </h1>
      <p
        className="mt-1.5 font-serif text-[15px] text-ink-soft italic"
        style={{ lineHeight: 1.6 }}
      >
        Ask a question and Yawp answers from your own notes, citing the ones it
        used.
      </p>

      <div className="mt-8 flex items-end gap-4 border-b border-rule-soft pb-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={1}
          placeholder="What did I decide about the pricing model?"
          className="selectable flex-1 resize-none bg-transparent font-serif text-[18px] text-ink outline-none"
          style={{ lineHeight: 1.5 }}
          autoFocus
        />
        <button
          onClick={ask}
          disabled={asking || !question.trim()}
          className="font-serif text-[15px] shrink-0 cursor-pointer transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ color: "var(--color-accent)" }}
        >
          {asking ? "Thinking…" : "Ask"}
        </button>
      </div>

      {!openRouterConfigured && (
        <p
          className="mt-5 font-serif text-[14px] text-ink-soft italic"
          style={{ lineHeight: 1.6 }}
        >
          Add an OpenRouter key in Settings to get written answers. Without one,
          Yawp will just show the notes that match your question.
        </p>
      )}

      {error && (
        <p className="mt-8 font-serif text-[15px]" style={{ color: "var(--color-accent-ink)" }}>
          {error}
        </p>
      )}

      {result && (
        <div className="mt-10">
          {result.answer && (
            <article
              className="selectable font-serif text-[18px] text-ink whitespace-pre-wrap"
              style={{ lineHeight: 1.75, overflowWrap: "anywhere" }}
            >
              {result.answer}
            </article>
          )}
          {result.sources.length > 0 && (
            <div className="mt-10 border-t border-rule-soft pt-5">
              <p className="eyebrow text-ink-quiet mb-3">
                {result.answered ? "Sources" : "Matching notes"}
              </p>
              <ul className="space-y-2">
                {result.sources.map((src, i) => (
                  <li key={src.id} className="flex items-baseline gap-3">
                    <span className="numeric text-[11px] text-ink-faint shrink-0">
                      {i + 1}
                    </span>
                    <button
                      onClick={() => onOpenNote(src.id)}
                      className="font-serif text-[15.5px] text-left text-ink-soft cursor-pointer transition-colors hover:text-ink"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {src.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.answered && result.sources.length === 0 && !result.answer && (
            <p className="mt-8 font-serif text-[16px] text-ink-quiet italic">
              No notes matched that question.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
