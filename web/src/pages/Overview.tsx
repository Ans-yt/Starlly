// Overview — the owner's mock-up grid, ported and bound to real API data.
// Every number comes from /api/dashboard (never hardcoded). Long lists scroll
// inside their cards (D2) and the page never scrolls at or above 720p (D1).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Dashboard } from "../lib/api.js";
import { usePageContext } from "../App.js";
import { EmptyState, ErrorBanner, OkBanner } from "../components/ui.js";
import { Icon } from "../components/icons.js";

type ThemeFilter = "all" | "positive" | "negative";
type ReviewFilter = "all" | "reply" | "low";

function initials(name: string): string {
  return String(name ?? "").split(" ").slice(0, 2).map((s) => s[0] ?? "").join("").toUpperCase();
}

export default function OverviewPage() {
  const { period, setPeriod } = usePageContext();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<ThemeFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const navigate = useNavigate();

  const load = async () => {
    setError(null);
    try {
      setData(await api.get<Dashboard>(`/api/dashboard?days=${period}&feed=${reviewFilter}`));
    } catch {
      setError("Could not load the dashboard.");
    }
  };

  useEffect(() => {
    void load();
  }, [period, reviewFilter]);

  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <div className="spinner" />;

  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.count));
  const themes = [...data.themes].sort((a, b) => b.negative - a.negative || b.positive - a.negative - (a.positive - a.negative));
  const maxTheme = Math.max(1, ...themes.map((t) => t.positive + t.negative));
  const visibleThemes = themes.filter(
    (t) => themeFilter === "all" || (themeFilter === "positive" ? t.positive > 0 : t.negative > 0),
  );
  const monthCount = data.ratingTrend
    .filter((p) => new Date(p.date).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)
    .reduce((acc, p) => acc + p.count, 0);
  const topFix = themes.find((t) => t.negative > 0);
  const chartPoints = data.ratingTrend.map((p) => p.average).filter((v) => v > 0);

  return (
    <section className="view" id="view-overview" aria-label="Overview">
      {note ? <OkBanner message={note} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="dashboard">
        <article className="card hero">
          <div className="hero-content">
            <div className="row">
              <div className="business-icon">
                <Icon name="building" />
              </div>
              <div>
                <h2 className="business-name">{data.company.name || "Your business"}</h2>
                <p className="meta">
                  {data.company.city || "Add your city in Settings"}
                  {data.company.sinceDate ? ` · Est. ${data.company.sinceDate.slice(0, 4)}` : ""}
                </p>
              </div>
            </div>
            <div className="hero-rating">
              <span className="big-rating">{data.company.googleRating != null ? data.company.googleRating.toFixed(1) : "—"}</span>
              <div>
                <div className="stars" style={{ color: "#f0a91e" }} aria-label={data.company.googleRating ? `${data.company.googleRating} out of 5 stars` : "No Google rating yet"}>
                  {data.company.googleRating != null
                    ? "★★★★★".slice(0, Math.round(data.company.googleRating)) + "★★★★★".slice(Math.round(data.company.googleRating))
                    : "☆☆☆☆☆"}
                </div>
                <div className="small muted" style={{ fontSize: 10, marginTop: 4 }}>
                  {data.company.googleReviewCount != null ? `${data.company.googleReviewCount} reviews` : "Google rating not connected yet"}
                  {monthCount > 0 ? (
                    <span style={{ padding: "0 5px" }}> ·</span>
                  ) : null}
                  {monthCount > 0 ? (
                    <span style={{ color: "var(--green)" }}>↗ {monthCount} this month</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className="hero-bottom">
            {data.sampleLoaded ? (
              <span className="badge purple">
                <span className="dot" /> Sample data
              </span>
            ) : null}
            {data.company.emailConnected ? (
              // D7: this badge renders only when a Test connection actually passed —
              // the server sets emailConnected from the stored passing-test timestamp.
              <span
                className="badge green"
                title={data.company.emailConnectedAt ? `Last passing test: ${new Date(data.company.emailConnectedAt).toLocaleString()}` : undefined}
              >
                <Icon name="mail" size={11} /> Email connected ✓
              </span>
            ) : data.company.emailAdapter === "copy-only" ? (
              <span className="badge" title="Copy only: you copy and paste the email yourself — no connection to test">
                <Icon name="mail" size={11} /> Copy-only email
              </span>
            ) : (
              <span className="badge" title="Saved, not tested — run Test connection in Settings">
                <Icon name="mail" size={11} /> Email not tested
              </span>
            )}
          </div>
        </article>

        <article className="card action-card">
          <Icon name="spark" size={29} style={{ height: 29, width: 29 }} className="action-icon" />
          <h2>A good moment to ask.</h2>
          <p>
            <span>{data.waitingCount}</span> {data.waitingCount === 1 ? "customer" : "customers"} waiting for a request
          </p>
          <button className="btn" onClick={() => navigate("/customers")}>
            <span className="send-label">Send review requests</span>
            <Icon name="arrow" size={17} />
          </button>
        </article>

        <article className="card themes">
          <div className="card-title">
            <div>
              <h2>What customers say</h2>
              <p>The little things that matter.</p>
            </div>
            <Icon name="chart" size={16} style={{ color: "var(--muted)" }} />
          </div>
          <div className="segmented" role="group" aria-label="Theme filter">
            {(
              [
                ["all", "All themes"],
                ["positive", "Praise"],
                ["negative", "To improve"],
              ] as [ThemeFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={themeFilter === key ? "active" : ""}
                aria-pressed={themeFilter === key}
                onClick={() => setThemeFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scroll-fade grow">
            {visibleThemes.length === 0 ? (
              <EmptyState title="No themes yet" hint="Import or paste reviews, then tag them in Insights." />
            ) : (
              <div className="theme-list">
                {visibleThemes.map((t) => {
                  return (
                    <button
                      key={t.id}
                      className="theme-row"
                      onClick={() => navigate("/insights")}
                      aria-label={`${t.name}: ${t.positive} praise, ${t.negative} complaints`}
                    >
                      <span className={`theme-symbol${t.negative > 0 ? " negative" : ""}`}>{t.negative > 0 ? "−" : "+"}</span>
                      <span className="grow">
                        <span className="theme-name">{t.name}</span>
                        <span className="theme-sub">
                          {t.positive} praise · {t.negative} to improve
                        </span>
                        <span className="mini-track">
                          <span style={{ width: `${((t.positive + t.negative) / maxTheme) * 100}%` }} />
                        </span>
                      </span>
                      <span className="theme-count">{t.positive + t.negative}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="themes-footer">
            <button className="btn ghost" onClick={() => navigate("/insights")}>
              View source reviews <Icon name="arrow" size={15} />
            </button>
          </div>
        </article>

        <article className="card chart-card">
          <div className="card-title">
            <h2>Rating over time</h2>
            <div className="segmented" role="group" aria-label="Chart period">
              {[7, 30, 90].map((d) => (
                <button key={d} className={period === d ? "active" : ""} aria-pressed={period === d} onClick={() => setPeriod(d)}>
                  {d}D
                </button>
              ))}
            </div>
          </div>
          <div className="chart-summary">
            <span className="chart-number">
              {chartPoints.length > 0
                ? (chartPoints.reduce((a, b) => a + b, 0) / chartPoints.length).toFixed(1)
                : "—"}
            </span>
            <span className="trend-up">
              {chartPoints.length >= 2 && chartPoints[chartPoints.length - 1]! >= chartPoints[0]! ? "↗ " : "↘ "}
              {chartPoints.length >= 2
                ? Math.abs(chartPoints[chartPoints.length - 1]! - chartPoints[0]!).toFixed(1)
                : "—"}{" "}
              <span className="muted">vs. previous period</span>
            </span>
          </div>
          <div className="chart-wrap">
            {chartPoints.length === 0 ? (
              <EmptyState title="No ratings in this period" hint="Rated requests and imported reviews appear here." />
            ) : (
              <RatingChart points={data.ratingTrend.filter((p) => p.average > 0)} />
            )}
          </div>
        </article>

        <article className="card funnel">
          <div className="card-title">
            <div>
              <h2>From hello to feedback</h2>
              <p>Your review request journey.</p>
            </div>
            <Icon name="send" size={16} style={{ color: "var(--muted)" }} />
          </div>
          <div>
            {data.funnel.map((row) => (
              <div className="funnel-row" key={row.step}>
                <span>{row.label}</span>
                <span className="funnel-track" role="progressbar" aria-valuenow={row.count} aria-label={row.label}>
                  <span style={{ display: "block", height: "100%", width: `${(row.count / maxFunnel) * 100}%` }} />
                </span>
                <span className="funnel-value">{row.count}</span>
              </div>
            ))}
          </div>
          <p className="funnel-note">A Google click doesn't confirm a posted review.</p>
        </article>

        <article className="card reviews">
          <div className="card-title">
            <div>
              <h2>Recent reviews</h2>
              <p>A few words. A bigger picture.</p>
            </div>
            <button className="icon-btn" onClick={() => navigate("/insights")} aria-label="View all reviews">
              <Icon name="more" size={16} />
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Review filter">
            {(
              [
                ["all", "All"],
                ["reply", "Needs reply"],
                ["low", "1–3 ★"],
              ] as [ReviewFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={reviewFilter === key ? "active" : ""}
                aria-pressed={reviewFilter === key}
                onClick={() => setReviewFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scroll-fade grow">
            {data.recentReviews.length === 0 ? (
              <EmptyState
                title="No reviews yet"
                hint="Import or paste reviews — requests you send will bring feedback here."
                action={
                  <Link className="btn primary" to="/customers">
                    Send your first request
                  </Link>
                }
              />
            ) : (
              <div className="review-list">
                {data.recentReviews.map((r) => (
                  <article className="review" key={r.id}>
                    <div className="row" style={{ gap: 9 }}>
                      <span className="avatar">{initials(r.author)}</span>
                      <span className="grow">
                        <span className="review-name">{r.author || "Customer"}</span>
                        <span className="review-time" style={{ display: "block" }}>
                          {new Date(r.date).toLocaleDateString()}
                        </span>
                      </span>
                      {r.rating != null ? (
                        <span className="stars" style={{ color: "#f0a91e" }} aria-label={`${r.rating} of 5 stars`}>
                          {"★★★★★".slice(0, r.rating)}
                          <span style={{ color: "#e1d8ed" }}>{"★★★★★".slice(r.rating)}</span>
                        </span>
                      ) : null}
                    </div>
                    <p>{r.snippet}</p>
                    <div className="review-foot">
                      <span className="source-badge">{r.source === "google_import" ? "Google import" : "Private feedback"}</span>
                      <button
                        className="btn ghost"
                        onClick={async () => {
                          await api.post("/api/drafts", {
                            kind: "review_reply",
                            subject: `Reply to ${r.author || "review"}`,
                            body: `Thanks for the feedback${r.rating && r.rating <= 3 ? " — we're sorry it wasn't right, and we'd like to make it right" : ""}.\n\n— ${data.company.ownerName || "the team"}`,
                          });
                          setNote("Reply draft created — open Messages to review and copy it.");
                        }}
                      >
                        {r.replied ? "View reply" : "Draft a reply"} <Icon name="arrow" size={12} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="overview-bottom">
        <button className="insight-nudge" style={{ textAlign: "left" }} onClick={() => navigate("/insights")}>
          <span className="nudge-icon">
            <Icon name="spark" />
          </span>
          <span>
            <h3>Your next little improvement</h3>
            <p>
              {topFix
                ? `${topFix.name}: ${topFix.negative} customer${topFix.negative === 1 ? "" : "s"} mentioned it — worth a look first.`
                : "No complaints tagged yet — keep collecting feedback."}
            </p>
          </span>
          <Icon name="arrow" className="nudge-arrow" />
        </button>
        <button
          className="insight-nudge"
          style={{ background: "#f0f0f7", borderColor: "#e6e5ef", textAlign: "left" }}
          onClick={() => navigate("/insights")}
        >
          <span className="nudge-icon" style={{ background: "#e3e2ef", color: "#8b86a5" }}>
            <Icon name="phone" />
          </span>
          <span>
            <h3>
              <span>{data.needsCall.length}</span> conversation{data.needsCall.length === 1 ? "" : "s"} worth having
            </h3>
            <p>A small follow-up can make a big difference.</p>
          </span>
          <Icon name="arrow" className="nudge-arrow" />
        </button>
      </div>
    </section>
  );
}

/** The mock-up's chart, ported: grid lines at 3/4/5, gradient fill, path, dots. */
function RatingChart({ points }: { points: { date: string; average: number }[] }) {
  const W = 420;
  const H = 150;
  const x0 = 28;
  const x1 = 403;
  const y0 = 10;
  const y1 = 119;
  const values = points.map((p) => p.average);
  const pts = values.map((v, i) => [
    x0 + (i / Math.max(1, values.length - 1)) * (x1 - x0),
    y1 - ((v - 3) / 2) * (y1 - y0),
  ]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p.join(",")).join(" ");
  const shade = pts.map((p) => p.join(",")).join(" ");
  const labels = points
    .filter((_, i) => i === 0 || i === Math.floor(points.length / 2) || i === points.length - 1)
    .map((p) => new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average rating over the period, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)} out of 5`}>
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#b69adc" stopOpacity=".28" />
          <stop offset="1" stopColor="#b69adc" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[3, 4, 5].map((v) => {
        const y = y1 - ((v - 3) / 2) * (y1 - y0);
        return (
          <g key={v}>
            <line className="grid" x1="28" x2="405" y1={y} y2={y} />
            <text x="3" y={y + 4}>{v}.0</text>
          </g>
        );
      })}
      <polygon points={`${x0},${y1} ${shade} ${x1},${y1}`} fill="url(#chartGradient)" />
      <path d={path} stroke="#9974cc" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4 : 2.5} fill="#9672c9" stroke="white" strokeWidth={2} />
      ))}
      {labels.map((l, i) => (
        <text
          key={l}
          x={x0 + (i / Math.max(1, labels.length - 1)) * (x1 - x0)}
          y="145"
          textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
        >
          {l}
        </text>
      ))}
    </svg>
  );
}
