// Insights (design.md §8): themes with counts and source links, needs-a-call
// with call outcomes, and honest empty states for the tickets not yet landed
// (rebooking baseline, alerts) rather than fake data.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Dashboard } from "../lib/api.js";
import { EmptyState, ErrorBanner, OkBanner, Spinner } from "../components/ui.js";

interface RebookingRecommendation {
  customerId: string;
  name: string;
  contact: string;
  serviceType: string;
  lastJobDate: string | null;
  dueInDays: number | null;
  overdueDays: number;
  intervalMonths: number;
  reasons: string[];
  source: string;
}

interface RebookingResponse {
  recommendations: RebookingRecommendation[];
  learnedModel: { enabled: boolean; requiredHistory: number; note: string };
}

interface TrendAlert {
  kind: string;
  text: string;
}

interface DuplicatesResponse {
  pairs: { aId: string; aText: string; bId: string; bText: string; similarity: number }[];
  threshold: number;
  note: string;
}

export default function InsightsPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [rebooking, setRebooking] = useState<RebookingResponse | null>(null);
  const [alerts, setAlerts] = useState<TrendAlert[] | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setError(null);
    try {
      setData(await api.get<Dashboard>("/api/dashboard"));
      setRebooking(await api.get<RebookingResponse>("/api/rebooking"));
      const alertsRes = await api.get<{ alerts: TrendAlert[] }>("/api/insights/alerts");
      setAlerts(alertsRes.alerts);
    } catch {
      setError("Could not load insights.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const ranked = [...data.themes].sort((a, b) => b.negative - a.negative);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <h1 className="card-title">Insights</h1>
      {note ? <OkBanner message={note} /> : null}

      <section className="card">
        <h2 className="card-title">What to fix first</h2>
        {ranked.length === 0 ? (
          <EmptyState title="Nothing to rank yet" hint="Import reviews and collect private feedback — every item here links to its source reviews." />
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {ranked
              .filter((t) => t.negative > 0)
              .map((t, i) => (
                <li key={t.id}>
                  <strong>{t.name}</strong>
                  <span className="card-sub"> — {t.negative} complaint{t.negative > 1 ? "s" : ""} in recent feedback</span>
                  <span className="card-sub"> · evidence: {t.negative + t.positive} tagged reviews</span>
                </li>
              ))}
            {ranked.every((t) => t.negative === 0) ? (
              <li className="card-sub">No complaints tagged yet — only praise so far.</li>
            ) : null}
          </ol>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">What customers say</h2>
        {data.themes.length === 0 ? (
          <EmptyState title="No themes yet" hint="The theme tagger runs on your review corpus once reviews are imported." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {data.themes.map((t) => (
              <li key={t.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  {t.negative > 0 ? <strong>−</strong> : <strong>+</strong>} {t.name}
                </span>
                <span className="card-sub">
                  {t.negative > 0 ? `−${t.negative}` : ""} {t.positive > 0 ? `+${t.positive}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Needs a call</h2>
        {data.needsCall.length === 0 ? (
          <EmptyState title="Nobody needs a call right now" hint="Low ratings, private feedback, and call requests appear here." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.needsCall.map((c) => (
              <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>
                  <strong>{c.name}</strong> <span className="card-sub">{c.contact}</span>
                </span>
                <button
                  className="btn"
                  onClick={async () => {
                    await api.patch(`/api/customers/${c.id}`, { callResolvedAt: new Date().toISOString() });
                    await api.post(`/api/customers/${c.id}/notes`, { text: "Called — marked as resolved." });
                    setNote(`Marked ${c.name} as resolved.`);
                    await load();
                  }}
                >
                  Mark resolved
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Who to contact this week</h2>
        {!rebooking ? (
          <Spinner />
        ) : rebooking.recommendations.length === 0 ? (
          <EmptyState
            title="Nobody is due right now"
            hint="Customers whose last service approaches its typical interval appear here."
          />
        ) : (
          <>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {rebooking.recommendations.map((r) => (
                <li key={r.customerId} style={{ display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--color-border)", paddingBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span>
                      <strong>{r.name}</strong> <span className="card-sub">{r.contact}</span>
                      {r.overdueDays > 0 ? <span className="badge badge-needs-call" style={{ marginLeft: 8 }}>{r.overdueDays}d overdue</span> : null}
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn"
                        onClick={async () => {
                          const draft = await api.post<{ id: string }>("/api/drafts", {
                            kind: "follow_up",
                            customerId: r.customerId,
                            subject: "Time for your next service?",
                            body: `Hi {{customer}},\n\nIt's been a while since your last ${r.serviceType || "service"} — we'd love to help again when it's time.\n\n{{link}}\n\n— {{owner}}`,
                          });
                          navigate(`/messages/${draft.id}`);
                        }}
                      >
                        Draft email
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          const until = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
                          await api.patch(`/api/customers/${r.customerId}`, { rebookingSnoozedUntil: until });
                          setNote(`Snoozed ${r.name} for 90 days.`);
                          await load();
                        }}
                      >
                        Snooze
                      </button>
                    </span>
                  </div>
                  <span className="card-sub">
                    {r.reasons.join(" ")} · <em>Rule-based recommendation</em>
                  </span>
                </li>
              ))}
            </ul>
            {!rebooking.learnedModel.enabled ? (
              <span className="card-sub">{rebooking.learnedModel.note}</span>
            ) : null}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Alerts</h2>
        {alerts === null ? (
          <Spinner />
        ) : alerts.length === 0 ? (
          <EmptyState title="No trend alerts" hint="Weekly rating averages and theme counts are watched; changes beyond a statistical threshold appear here with the numbers." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => (
              <li key={i} className={a.kind === "rating_drop" ? "error-banner" : "ok-banner"} style={{ listStyle: "none" }}>
                {a.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Similar reviews</h2>
        <p className="card-sub">
          Flags unusually similar reviews for you to look at — a similarity score never proves a review is fake.
        </p>
        <button className="btn" onClick={async () => setDuplicates(await api.post("/api/insights/duplicates"))}>
          Check for similar reviews
        </button>
        {duplicates ? (
          duplicates.pairs.length === 0 ? (
            <OkBanner message="No unusually similar review pairs found." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {duplicates.pairs.map((p, i) => (
                <li key={i} className="error-banner">
                  <strong>Similarity {p.similarity}</strong>
                  <div>"{p.aText}"</div>
                  <div>"{p.bText}"</div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
