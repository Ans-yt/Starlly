// AI chat panel — the mock-up's .chat panel, restyled with its classes.
// Read-only, cited; drafts it creates go to Messages for approval.
import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { Icon, Orb } from "./icons.js";

interface ChatQuote {
  reviewId: string;
  quote: string;
}

interface ChatMessageState {
  role: "user" | "assistant";
  text: string;
  sourceLabel?: string;
  quotes?: ChatQuote[];
  droppedQuotes?: number;
  draftId?: string;
}

const SUGGESTIONS = ["What should I improve?", "Who needs a call?", "Draft a review request"];

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessageState[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.post<{
        answer: string;
        quotes?: ChatQuote[];
        droppedQuotes?: number;
        sourceLabel?: string;
        draftId?: string;
      }>("/api/chat", { message: trimmed });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: res.answer,
          sourceLabel: res.sourceLabel,
          quotes: res.quotes,
          droppedQuotes: res.droppedQuotes,
          draftId: res.draftId,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat" id="chatPanel" aria-label="Starlly assistant">
      <div className="chat-head">
        <Orb size={27} />
        <div className="grow">
          <h3>Starlly assistant</h3>
          <p>Let's find your next bright idea.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close assistant">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="chat-body">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <Orb size={64} />
            <h2>A little help, a little clarity.</h2>
            <p>Answers come from your own reviews and records.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => void send(s)}>
                ✧ &nbsp; {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className={`bubble${m.role === "user" ? " user" : ""}`}>{m.text}</div>
              {m.role === "assistant" ? (
                <>
                  {m.sourceLabel ? (
                    <details>
                      <summary className="small muted" style={{ cursor: "pointer", fontSize: 10 }}>
                        {m.sourceLabel}
                        {m.droppedQuotes ? ` · ${m.droppedQuotes} unverified quote${m.droppedQuotes === 1 ? "" : "s"} dropped` : ""}
                      </summary>
                      {m.quotes?.map((q, j) => (
                        <blockquote key={j} className="small muted" style={{ margin: "6px 0 0", borderLeft: "3px solid var(--purple)", paddingLeft: 8 }}>
                          "{q.quote}" <span>({q.reviewId})</span>
                        </blockquote>
                      ))}
                    </details>
                  ) : null}
                  {m.draftId ? (
                    <a className="small" href={`/messages/${m.draftId}`} style={{ color: "var(--purple)" }}>
                      Open the draft in Messages → (needs your approval)
                    </a>
                  ) : null}
                </>
              ) : null}
            </div>
          ))
        )}
        {busy ? <div className="spinner" /> : null}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your business…"
            autoComplete="off"
            aria-label="Message the assistant"
          />
          <button aria-label="Send message" disabled={busy || !input.trim()}>
            <Icon name="arrow" size={16} />
          </button>
        </div>
        <p className="chat-note">Drafts always need your approval.</p>
      </form>
    </section>
  );
}
