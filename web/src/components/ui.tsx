// Small shared UI pieces (mock-up tokens; states per design.md §10).
import { type ReactNode } from "react";
import { Icon } from "./icons.js";

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <span className="small muted">{hint}</span> : null}
      {action}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <div>{message}</div>
      {onRetry ? (
        <div>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OkBanner({ message }: { message: string }) {
  return <div className="ok-banner">{message}</div>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Stars display (read-only, e.g., review rows) — the sprite star at row size. */
export function StarsDisplay({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="small muted">no rating</span>;
  return (
    <span className="stars" style={{ color: "#f0a91e" }} aria-label={`${rating} of 5 stars`}>
      {Array.from({ length: rating }, (_, i) => (
        <Icon key={i} name="star" size={13} style={{ fill: "#f0a91e" }} />
      ))}
      {Array.from({ length: 5 - rating }, (_, i) => (
        <Icon key={`e${i}`} name="star" size={13} style={{ color: "#e1d8ed" }} />
      ))}
    </span>
  );
}

export function statusBadgeClass(derived: string | null): string {
  switch (derived) {
    case "waiting":
      return "badge purple";
    case "requested":
      return "badge green";
    case "needs_call":
      return "badge rose";
    default:
      return "badge";
  }
}

export function derivedLabel(derived: string | null): string {
  switch (derived) {
    case "waiting":
      return "Waiting";
    case "requested":
      return "Requested"; // GLOSSARY: never "Reviewed" — we cannot observe posted reviews
    case "needs_call":
      return "Needs a call";
    default:
      return "Not eligible"; // no consent / do-not-contact
  }
}
