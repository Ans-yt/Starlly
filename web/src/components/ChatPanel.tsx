import { useEffect, useRef, useState } from "react";
import { Icon, Orb } from "./icons.js";
interface ChatQuote {
  reviewId: string;
  quote: string;
}
interface Message {
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  sourceLabel?: string;
  quotes?: ChatQuote[];
  droppedQuotes?: number;
  draftId?: string;
  error?: boolean;
  pending?: boolean;
}
const SUGGESTIONS = [
  "What should I improve?",
  "Who needs a call?",
  "Draft a review request",
];
export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const index = messages.length + 1;
    const update = (patch: Partial<Message>) =>
      setMessages((current) =>
        current.map((m, i) => (i === index ? { ...m, ...patch } : m)),
      );
    const history = messages
      .filter((m) => !m.error && !m.pending && m.text)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.text }));
    setMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      { role: "assistant", text: "", pending: true },
    ]);
    setInput("");
    setBusy(true);
    let reasoning = "",
      answer = "",
      completed = false;
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, stream: true, history }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          typeof error.message === "string"
            ? error.message
            : "The assistant could not reply. Please try again.",
        );
      }
      if (
        !response.headers.get("content-type")?.includes("application/x-ndjson")
      ) {
        const result = await response.json();
        update({ ...result, text: result.answer, pending: false });
        completed = true;
        return;
      }
      if (!response.body) throw new Error("The connection returned no reply.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      const event = (line: string) => {
        if (!line.trim()) return;
        const e = JSON.parse(line);
        if (e.type === "reasoning_delta") {
          reasoning += e.text;
          update({ reasoning });
        }
        if (e.type === "reasoning") {
          reasoning = e.text;
          update({ reasoning });
        }
        if (e.type === "answer") {
          answer = e.text;
          update({ text: answer, sourceLabel: undefined });
        }
        if (e.type === "error")
          throw new Error(
            e.message || "The reply could not be completed. Please try again.",
          );
        if (e.type === "done") {
          completed = true;
          answer = e.result.answer;
          update({ ...e.result, text: answer, reasoning, pending: false });
        }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += done
            ? decoder.decode()
            : decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            event(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
          if (done) {
            event(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!completed)
        throw new Error(
          "The connection stopped before the reply finished. Please try again.",
        );
    } catch (err) {
      const stopped = controller.signal.aborted;
      update({
        text: stopped
          ? answer
            ? `${answer}\n\nReply stopped before completion.`
            : "Reply stopped. Send another message when you're ready."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
        reasoning,
        error: !stopped,
        pending: false,
        sourceLabel: undefined,
        quotes: [],
      });
    } finally {
      clearTimeout(timer);
      if (active.current === controller) active.current = null;
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
        <button
          className="icon-btn"
          onClick={onClose}
          aria-label="Close assistant"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="chat-body" aria-busy={busy}>
        {!messages.length ? (
          <div className="chat-welcome">
            <Orb size={64} />
            <h2>A little help, a little clarity.</h2>
            <p>Answers come from your own reviews and records.</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="suggestion"
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="chat-message">
              {m.reasoning ? (
                <details className="chat-reasoning">
                  <summary>
                    {m.pending && !m.text ? "Thinking…" : "Reasoning"}
                  </summary>
                  <div>{m.reasoning}</div>
                </details>
              ) : null}
              {m.text ? (
                <div
                  className={`bubble${m.role === "user" ? " user" : ""}${m.error ? " chat-error" : ""}`}
                  role={m.error ? "alert" : undefined}
                >
                  {m.text}
                </div>
              ) : m.pending ? (
                <p className="chat-progress" role="status">
                  {m.reasoning
                    ? "Preparing your reply…"
                    : "Connecting to your AI provider…"}
                </p>
              ) : null}
              {m.pending && m.text ? (
                <p className="chat-progress" role="status">
                  Replying… · citations checked when complete
                </p>
              ) : null}
              {m.sourceLabel ? (
                <details className="chat-sources">
                  <summary>
                    {m.sourceLabel}
                    {m.droppedQuotes
                      ? ` · ${m.droppedQuotes} unverified quote(s) omitted`
                      : ""}
                  </summary>
                  {m.quotes?.map((q, j) => (
                    <blockquote key={j}>{q.quote}</blockquote>
                  ))}
                </details>
              ) : null}
              {m.draftId ? (
                <a className="chat-draft-link" href={`/messages/${m.draftId}`}>
                  Open draft in Messages — needs your approval
                </a>
              ) : null}
            </div>
          ))
        )}
        <div ref={bottom} />
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
            maxLength={2000}
            aria-label="Message the assistant"
          />
          {busy ? (
            <button
              type="button"
              aria-label="Stop reply"
              onClick={() => active.current?.abort()}
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <button aria-label="Send message" disabled={!input.trim()}>
              <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
        <p className="chat-note">Drafts always need your approval.</p>
      </form>
    </section>
  );
}
