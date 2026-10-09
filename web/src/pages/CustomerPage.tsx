// The public customer page (design.md §5). Compliance rules are structural:
// the Google button is rendered BEFORE any rating and never changes size,
// position, or link; low ratings only ADD options below it (spec §5.2, ADR-0005).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api.js";
import { ErrorBanner, Spinner, StarsDisplay } from "../components/ui.js";
import { Icon } from "../components/icons.js";

interface PageData {
  businessName: string;
  question: string;
  googleReviewUrl: string;
  state: { rating: number | null; feedbackSubmitted: boolean; callRequested: boolean };
}

export default function CustomerPage({ preview = false }: { preview?: boolean }) {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackThanks, setFeedbackThanks] = useState(false);
  const [hover, setHover] = useState(0);

  const load = async () => {
    setError(null);
    try {
      const d = await api.get<PageData>(`/api/public/requests/${token ?? ""}`);
      setData(d);
      setFeedbackThanks(d.state.feedbackSubmitted);
    } catch (err) {
      setError(err instanceof ApiError ? err.body?.message ?? "This link is not available." : "Could not open this page.");
    }
  };

  useEffect(() => {
    if (preview) {
      setData({
        businessName: "Your business (preview)",
        question: "How did we do?",
        googleReviewUrl: "https://g.page/your-business/review",
        state: { rating: null, feedbackSubmitted: false, callRequested: false },
      });
      return;
    }
    if (token) void load();
  }, [token]);

  if (preview) {
    return (
      <div className="customer-page">
        {data ? (
          <CustomerPageBody
            data={data}
            preview
            hover={0}
            setHover={() => undefined}
            feedbackText=""
            setFeedbackText={() => undefined}
            feedbackThanks={false}
          />
        ) : (
          <Spinner />
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="customer-page">
        <h1>This link isn't available</h1>
        <p className="card-sub">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="customer-page">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="customer-page">
      {preview ? (
        <div className="ok-banner" style={{ width: "100%" }}>
          Preview — this is what your customers see. No events are recorded.
        </div>
      ) : null}
      <CustomerPageBody
        data={data}
        onRate={async (rating) => {
          setBusy(true);
          await api.post(`/api/public/requests/${token}/rate`, { rating });
          await load();
          setBusy(false);
        }}
        onGoogleClick={async () => {
          await api.post(`/api/public/requests/${token}/google-click`);
        }}
        onFeedback={async () => {
          setBusy(true);
          await api.post(`/api/public/requests/${token}/feedback`, { text: feedbackText });
          setFeedbackThanks(true);
          await load();
          setBusy(false);
        }}
        onCallRequest={async () => {
          setBusy(true);
          await api.post(`/api/public/requests/${token}/call-request`);
          await load();
          setBusy(false);
        }}
        busy={busy}
        hover={hover}
        setHover={setHover}
        feedbackText={feedbackText}
        setFeedbackText={setFeedbackText}
        feedbackThanks={feedbackThanks}
      />
    </div>
  );
}

function CustomerPageBody({
  data,
  onRate,
  onGoogleClick,
  onFeedback,
  onCallRequest,
  busy,
  hover,
  setHover,
  feedbackText,
  setFeedbackText,
  feedbackThanks,
  preview = false,
}: {
  data: PageData;
  onRate?: (rating: number) => Promise<void>;
  onGoogleClick?: () => Promise<void>;
  onFeedback?: () => Promise<void>;
  onCallRequest?: () => Promise<void>;
  busy?: boolean;
  hover: number;
  setHover: (n: number) => void;
  feedbackText: string;
  setFeedbackText: (s: string) => void;
  feedbackThanks: boolean;
  preview?: boolean;
}) {
  const rating = data.state.rating;
  const isLow = rating != null && rating <= 3;
  // Structurally identical for every rating: stars, then the Google button,
  // then (only for 1–3★) an extra block below. Nothing hides, shrinks, or moves.
  return (
    <>
      <span className="business-name">{data.businessName}</span>
      <h1>{data.question}</h1>
      <div className="stars" role="radiogroup" aria-label="Rate us from 1 to 5 stars">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className="star-btn"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
            disabled={busy}
            onClick={() => void onRate?.(value)}
            onMouseEnter={() => setHover(value)}
            onMouseLeave={() => setHover(0)}
          >
            <Icon
              name="star"
              size={34}
              style={{
                fill: value <= (hover || rating || 0) ? "#f0a91e" : "none",
                stroke: value <= (hover || rating || 0) ? "#f0a91e" : "currentColor",
              }}
            />
          </button>
        ))}
      </div>

      {/* Always visible, from the start, same size and link for every rating. */}
      <a
        className="google-btn"
        href={data.googleReviewUrl}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => void onGoogleClick?.()}
      >
        <Icon name="star" size={22} style={{ fill: "#f0a91e" }} />
        Leave a Google review
      </a>

      {isLow ? (
        <div className="low-rating-extra">
          <p className="card-sub" style={{ margin: 0 }}>
            Sorry it wasn't right. We'd like to make it right.
          </p>
          {!data.state.callRequested ? (
            <button className="btn" disabled={busy} onClick={() => void onCallRequest?.()}>
              Request a call
            </button>
          ) : (
            <span className="ok-banner">We'll call you soon.</span>
          )}
          {!feedbackThanks ? (
            <>
              <button
                className="btn"
                disabled={busy}
                onClick={() => document.getElementById("feedback-form")?.scrollIntoView({ behavior: "smooth" })}
              >
                Send private feedback
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {rating != null && !isLow ? (
        <p className="card-sub">Thank you! Your feedback helps us a lot.</p>
      ) : null}

      <div id="feedback-form" style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 8 }}>
        {feedbackThanks ? (
          <div className="ok-banner">Thanks — we got your feedback.</div>
        ) : (
          <>
            <label htmlFor="feedback" className="card-sub" style={{ textAlign: "left" }}>
              Private feedback (only the business sees this)
            </label>
            <textarea
              id="feedback"
              rows={4}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Tell us what happened…"
            />
            <button className="btn btn-primary" disabled={busy || feedbackText.trim().length === 0} onClick={() => void onFeedback?.()}>
              Submit feedback
            </button>
          </>
        )}
      </div>
      <StarsDisplay rating={rating} />
    </>
  );
}
