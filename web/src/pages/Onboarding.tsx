// First-run setup gate (spec §4.2 — blocking, ordered). Steps:
// 0 loading screen (hero video + intro wheel) → 1 business → 2 AI provider
// (Test connection REQUIRED) → 3 email provider (REQUIRED; Copy only passes
// keyless) → 4 Google Places (only skip: "I'll paste or import my reviews
// instead") → 5 Exa (optional) → 6 test email (skipped for Copy only) →
// 7 password + complete. There is no sample-data shortcut: the gate blocks
// until every mandatory item passes. Every step has a "Where do I get this?"
// link where relevant, and the server re-validates everything.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type AdapterDescription, type Settings } from "../lib/api.js";
import { ErrorBanner, OkBanner, Spinner } from "../components/ui.js";
import { IntroSequence, type IntroItem } from "../components/IntroSequence.js";
import { LogoMark } from "../components/LogoMark.js";
import { Icon } from "../components/icons.js";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface TestResult {
  ok: boolean;
  note?: string;
  error?: { kind: string; message: string };
}

export interface SetupItem {
  done: boolean;
  status: "not_set" | "saved" | "connected";
  lastTestAt: string | null;
  note?: string;
}

export interface SetupStatus {
  setupComplete: boolean;
  blocked: string[];
  items: {
    business: SetupItem;
    ai: SetupItem;
    email: SetupItem;
    places: SetupItem;
    exa: SetupItem;
    testEmail: SetupItem;
  };
  passwordConfigured: boolean;
}

function fetchSetupStatus(): Promise<SetupStatus> {
  return api.get<SetupStatus>("/api/setup/status");
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function StatusChip({ item }: { item: SetupItem | undefined }) {
  if (!item) return null;
  const connected = item.status === "connected";
  return (
    <span className={connected ? "setup-chip connected" : item.status === "saved" ? "setup-chip saved" : "setup-chip"}>
      {connected
        ? `Connected${item.lastTestAt ? ` · ${fmtTime(item.lastTestAt)}` : ""}`
        : item.status === "saved"
          ? "Saved, not tested"
          : "Not set"}
    </span>
  );
}

// Intro copy — EXACTLY as specified by the owner (no approval language).
const INTRO_HEADLINE = "Collect more Google reviews. Learn from every word of feedback.";
const INTRO_ITEMS: IntroItem[] = [
  {
    title: "Ask",
    body: "After each job, your customer gets a branded message with one link. No app, no account.",
    icon: "send",
  },
  {
    title: "Understand",
    body: "See your rating and what customers keep praising or complaining about, with the real reviews as proof.",
    icon: "chart",
  },
  {
    title: "Act",
    body: "A short list of what to fix first, who to call back, and who is due for another visit.",
    icon: "spark",
  },
];

const STEP_NAMES = ["Loading", "Business", "AI provider", "Email provider", "Google Places", "Exa", "Test email", "Done"];

export default function OnboardingPage({ onDone }: { onDone: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const navigateToDashboard = useCallback(() => navigate("/"), [navigate]);
  const [step, setStep] = useState<number | null>(null); // null = restoring state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const refreshStatus = useCallback(async (): Promise<SetupStatus> => {
    const s = await fetchSetupStatus();
    setStatus(s);
    return s;
  }, []);

  // Restore progress. First run (nothing done) → the loading screen; part-way
  // through → the first incomplete step; everything done → the finish line.
  useEffect(() => {
    void (async () => {
      try {
        const s = await refreshStatus();
        const { business, ai, email, places, testEmail } = s.items;
        if (!business.done) setStep(0);
        else if (!ai.done) setStep(2);
        else if (!email.done) setStep(3);
        else if (!places.done) setStep(4);
        else if (!testEmail.done) setStep(6);
        else setStep(7);
      } catch {
        setStep(0);
      }
    })();
  }, [refreshStatus]);

  // Business details
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [city, setCity] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [discord, setDiscord] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Providers
  const [settings, setSettings] = useState<Settings | null>(null);
  const [adapterId, setAdapterId] = useState("copy-only");
  const [adapterConfig, setAdapterConfig] = useState<Record<string, string>>({});
  const [emailTest, setEmailTest] = useState<TestResult | null>(null);
  const [aiDraft, setAiDraft] = useState({ style: "", baseUrl: "", model: "", apiKey: "" });
  const [aiTest, setAiTest] = useState<TestResult | null>(null);

  // Places
  const [placesKey, setPlacesKey] = useState("");
  const [placesLookup, setPlacesLookup] = useState<
    | { ok: true; places: { placeId: string; name: string; address: string; rating: number | null; reviewCount: number | null }[] }
    | { ok: false; message: string }
    | null
  >(null);

  // Test email + finish
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [finalPassword, setFinalPassword] = useState("");

  useEffect(() => {
    api
      .get<Settings>("/api/settings")
      .then((s) => {
        setSettings(s);
        setAdapterId(s.emailAdapterId);
        setAiDraft((d) => ({
          style: s.aiStyle ?? d.style,
          baseUrl: s.aiBaseUrl ?? d.baseUrl,
          model: s.aiModel ?? d.model,
          apiKey: "",
        }));
      })
      .catch(() => undefined);
  }, []);

  const adapter: AdapterDescription | undefined = settings?.emailAdapters.find((a) => a.id === adapterId);
  // ── Step 1: business (server re-validates; field errors come back mapped) ──
  const saveBusiness = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.put("/api/business", {
        name,
        ownerName,
        ownerEmail,
        city,
        googleReviewUrl,
        googleReviewUrlConfirmed: linkConfirmed,
        website,
        socialLinks: { ...(instagram ? { instagram } : {}), ...(discord ? { discord } : {}) },
        fieldSources: { name: "typed", ownerName: "typed", ownerEmail: "typed", city: "typed", googleReviewUrl: "typed" },
      });
      await refreshStatus();
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.body?.fieldErrors) {
        setFieldErrors(err.body.fieldErrors as Record<string, string>);
        const first = Object.values(err.body.fieldErrors as Record<string, string>)[0];
        setError(typeof first === "string" && first ? first : "Please fix the highlighted fields.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save your details.");
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: AI provider — Test connection must pass (S2) ──────────────────
  const testAi = async () => {
    setBusy(true);
    setAiTest(null);
    setError(null);
    try {
      await api.put("/api/settings", {
        aiStyle: aiDraft.style === "" ? null : aiDraft.style,
        aiBaseUrl: aiDraft.baseUrl,
        aiModel: aiDraft.model,
        ...(aiDraft.apiKey ? { aiApiKey: aiDraft.apiKey } : {}),
      });
      setAiTest(await api.post<TestResult>("/api/settings/test-ai"));
      await refreshStatus();
    } catch (err) {
      setAiTest({ ok: false, error: { kind: "error", message: err instanceof Error ? err.message : "Test failed." } });
    } finally {
      setBusy(false);
    }
  };

  // ── Step 3: email provider — Test connection must pass; Copy only passes ──
  const testEmailConnection = async () => {
    setBusy(true);
    setEmailTest(null);
    setError(null);
    try {
      await api.put("/api/settings", { emailAdapterId: adapterId, emailConfig: adapterConfig });
      setEmailTest(await api.post<TestResult>("/api/settings/test-email"));
      await refreshStatus();
    } catch (err) {
      setEmailTest({ ok: false, error: { kind: "error", message: err instanceof Error ? err.message : "Test failed." } });
    } finally {
      setBusy(false);
    }
  };

  // ── Step 4: Google Places — lookup, "Is this you?", or the explicit skip ──
  const lookupPlaces = async () => {
    setBusy(true);
    setPlacesLookup(null);
    setError(null);
    try {
      if (placesKey.trim()) await api.put("/api/settings", { googlePlacesApiKey: placesKey.trim() });
      const result = await api.post<{
        ok: boolean;
        places?: { placeId: string; name: string; address: string; rating: number | null; reviewCount: number | null }[];
        error?: { message: string };
      }>("/api/settings/places-lookup", {});
      if (result.ok && result.places) setPlacesLookup({ ok: true, places: result.places });
      else setPlacesLookup({ ok: false, message: result.error?.message ?? "Lookup failed." });
    } catch (err) {
      setPlacesLookup({ ok: false, message: err instanceof Error ? err.message : "Lookup failed." });
    } finally {
      setBusy(false);
    }
  };

  const confirmPlace = async (placeId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ ok: boolean; error?: { message: string } }>("/api/settings/places-confirm", { placeId });
      if (!result.ok) {
        setError(result.error?.message ?? "Could not confirm the listing.");
        return;
      }
      await refreshStatus();
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm the listing.");
    } finally {
      setBusy(false);
    }
  };

  const skipPlaces = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/setup/places-skip");
      await refreshStatus();
      setStep(5);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your choice.");
    } finally {
      setBusy(false);
    }
  };

  // ── Step 6: test email to the owner (skipped for Copy only) ───────────────
  const sendTestToMe = async () => {
    setBusy(true);
    setTestEmailResult(null);
    setError(null);
    try {
      const draft = await api.post<{ id: string }>("/api/drafts", {
        kind: "review_request",
        subject: `How did we do? (test from ${name || "your business"})`,
        body: "Hi {{customer}},\n\nThanks for choosing {{business}}! We'd love your feedback:\n\n{{link}}\n\n— {{owner}}",
      });
      const result = await api.post<{ outcome: string }>(`/api/drafts/${draft.id}/test-send`);
      if (result.outcome === "accepted") {
        setTestEmailResult({ ok: true, message: "Test email sent — check your inbox." });
        await refreshStatus();
      } else {
        setTestEmailResult({ ok: false, message: `Test send did not go through (${result.outcome}). Check your email provider settings.` });
      }
    } catch (err) {
      setTestEmailResult({ ok: false, message: err instanceof ApiError ? err.message : "Test send failed." });
    } finally {
      setBusy(false);
    }
  };

  // ── Step 7: password + complete ───────────────────────────────────────────
  const completeSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      if (status && !status.passwordConfigured) {
        await api.post("/api/auth/setup", { password: finalPassword });
      }
      const res = await fetch("/api/setup/complete", { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.blocked ? `Still missing: ${body.blocked.join(", ")}` : "Setup is not complete yet.");
        await refreshStatus();
        return;
      }
      await onDone();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete setup.");
    } finally {
      setBusy(false);
    }
  };

  if (step === null) {
    return (
      <div className="setup-boot">
        <Spinner />
      </div>
    );
  }

  const copyOnly = adapterId === "copy-only";
  const aiReady = status?.items.ai.done === true;
  const emailReady = status?.items.email.done === true;

  return (
    <div className="setup-page">
      {step === 0 ? (
        <LoadingScreen
          onProceed={() => (status?.setupComplete ? navigateToDashboard() : setStep(1))}
          buttonLabel={
            status?.setupComplete
              ? "Open dashboard"
              : status?.items.business.done
                ? "Continue setup"
                : "Start setup"
          }
        />
      ) : (
        <div className="setup-card card">
          <StepHeader step={step} status={status} onStep={(s) => setStep(s)} />
          {error ? <ErrorBanner message={error} /> : null}

          {step === 1 ? (
            <BusinessStep
              busy={busy}
              fieldErrors={fieldErrors}
              values={{ name, ownerName, ownerEmail, city, googleReviewUrl, website, instagram, discord }}
              setters={{ setName, setOwnerName, setOwnerEmail, setCity, setGoogleReviewUrl, setWebsite, setInstagram, setDiscord }}
              linkConfirmed={linkConfirmed}
              setLinkConfirmed={setLinkConfirmed}
              onSubmit={saveBusiness}
            />
          ) : null}

          {step === 2 && settings ? (
            <AiStep
              busy={busy}
              aiDraft={aiDraft}
              setAiDraft={setAiDraft}
              testResult={aiTest}
              onTest={testAi}
              canContinue={aiReady}
              onContinue={() => setStep(3)}
              status={status?.items.ai}
            />
          ) : null}

          {step === 3 && settings ? (
            <EmailStep
              busy={busy}
              settings={settings}
              adapterId={adapterId}
              setAdapterId={setAdapterId}
              adapterConfig={adapterConfig}
              setAdapterConfig={setAdapterConfig}
              testResult={emailTest}
              onTest={testEmailConnection}
              canContinue={emailReady}
              onContinue={() => setStep(4)}
              status={status?.items.email}
            />
          ) : null}

          {step === 4 ? (
            <PlacesStep
              busy={busy}
              placesKey={placesKey}
              setPlacesKey={setPlacesKey}
              lookup={placesLookup}
              onLookup={lookupPlaces}
              onConfirm={confirmPlace}
              onSkip={skipPlaces}
              status={status?.items.places}
            />
          ) : null}

          {step === 5 ? (
            <ExaStep
              busy={busy}
              onSaveKey={async (key) => {
                await api.put("/api/settings", key ? { exaApiKey: key } : {});
                await refreshStatus();
              }}
              onContinue={() => setStep(6)}
              status={status?.items.exa}
            />
          ) : null}

          {step === 6 ? (
            <TestEmailStep
              busy={busy}
              result={testEmailResult}
              onSend={sendTestToMe}
              onContinue={() => setStep(7)}
              skipped={copyOnly}
              status={status?.items.testEmail}
            />
          ) : null}

          {step === 7 ? (
            <DoneStep
              busy={busy}
              passwordConfigured={status?.passwordConfigured === true}
              finalPassword={finalPassword}
              setFinalPassword={setFinalPassword}
              onComplete={completeSetup}
            />
          ) : null}

          <p className="card-sub setup-footnote">
            Keys stay on this machine — the browser never sees them again after saving.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Loading screen: hero video full-bleed + intro card sequence ─────────────
// Phase timing lives in IntroSequence: 0–4 s video only, cards fly in from 4 s,
// controls fade in once they settle. The Start button's label follows setup
// progress: Start setup → Continue setup (partly done) → Open dashboard.

function LoadingScreen({ onProceed, buttonLabel }: { onProceed: () => void; buttonLabel: string }) {
  const reduced = prefersReducedMotion();
  return (
    <div className="loading-screen">
      {reduced ? (
        <div className="loading-bg-still" aria-hidden="true" />
      ) : (
        <video className="loading-bg" src="/starlly-hero.mp4" autoPlay muted loop playsInline poster="/orb-still.png" aria-hidden="true" />
      )}
      <div className="loading-scrim" aria-hidden="true" />
      <IntroSequence
        items={INTRO_ITEMS}
        headline={INTRO_HEADLINE}
        logo={<LogoMark className="intro-logo-mark" />}
        buttonLabel={buttonLabel}
        onStart={onProceed}
      />
    </div>
  );
}

function StepHeader({ step, status, onStep }: { step: number; status: SetupStatus | null; onStep: (s: number) => void }) {
  const items = status?.items;
  return (
    <div className="setup-head">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src="/logo-a-arc-orbit.svg" alt="" width={26} height={26} aria-hidden="true" />
        <h2 className="card-title" style={{ margin: 0 }}>{STEP_NAMES[step]}</h2>
        <span className="small muted">Step {step} of 7</span>
      </div>
      <div className="setup-progress" role="list" aria-label="Setup steps">
        {STEP_NAMES.slice(1).map((label, i) => {
          const idx = i + 1;
          const keys: (keyof NonNullable<typeof items>)[] = ["business", "ai", "email", "places", "exa", "testEmail"];
          const done = idx === 7 ? false : items ? items[keys[i]].done : false;
          return (
            <button
              key={label}
              type="button"
              role="listitem"
              className={idx === step ? "chip active" : done ? "chip chip-done" : "chip"}
              onClick={() => onStep(idx)}
              title={label}
            >
              {done ? "✓ " : ""}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FieldErrors {
  [key: string]: string;
}

function BusinessStep({
  busy,
  fieldErrors,
  values,
  setters,
  linkConfirmed,
  setLinkConfirmed,
  onSubmit,
}: {
  busy: boolean;
  fieldErrors: FieldErrors;
  values: { name: string; ownerName: string; ownerEmail: string; city: string; googleReviewUrl: string; website: string; instagram: string; discord: string };
  setters: {
    setName: (v: string) => void;
    setOwnerName: (v: string) => void;
    setOwnerEmail: (v: string) => void;
    setCity: (v: string) => void;
    setGoogleReviewUrl: (v: string) => void;
    setWebsite: (v: string) => void;
    setInstagram: (v: string) => void;
    setDiscord: (v: string) => void;
  };
  linkConfirmed: boolean;
  setLinkConfirmed: (v: boolean) => void;
  onSubmit: () => void;
}) {
  const err = (key: string) => fieldErrors[key] ?? null;
  const hasWarning = fieldErrors.googleReviewUrl?.includes("confirm") ?? false;
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="ob-name">Company name</label>
          <input id="ob-name" value={values.name} onChange={(e) => setters.setName(e.target.value)} required />
          {err("name") ? <span className="field-error">{err("name")}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="ob-owner">Owner</label>
          <input id="ob-owner" value={values.ownerName} onChange={(e) => setters.setOwnerName(e.target.value)} required />
          {err("ownerName") ? <span className="field-error">{err("ownerName")}</span> : null}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="ob-email">Your email (test emails go here)</label>
          <input id="ob-email" type="email" value={values.ownerEmail} onChange={(e) => setters.setOwnerEmail(e.target.value)} required />
          {err("ownerEmail") ? <span className="field-error">{err("ownerEmail")}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="ob-city">City / address</label>
          <input id="ob-city" value={values.city} onChange={(e) => setters.setCity(e.target.value)} required />
          {err("city") ? <span className="field-error">{err("city")}</span> : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ob-glink">Google review link — the same link every customer gets</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="ob-glink"
            type="url"
            placeholder="https://g.page/your-business/review"
            value={values.googleReviewUrl}
            onChange={(e) => {
              setLinkConfirmed(false);
              setters.setGoogleReviewUrl(e.target.value);
            }}
            required
          />
          <button
            type="button"
            className="btn"
            onClick={() => window.open(values.googleReviewUrl, "_blank", "noopener")}
            disabled={!values.googleReviewUrl.trim()}
            title="Open the link to check it shows your review page"
          >
            Open link
          </button>
        </div>
        <a className="card-sub" href="https://support.google.com/business/answer/9103648" target="_blank" rel="noreferrer">
          Where do I get this?
        </a>
        {err("googleReviewUrl") ? <span className="field-error">{err("googleReviewUrl")}</span> : null}
        {!err("googleReviewUrl") && values.googleReviewUrl.trim() && !/^https:\/\/(g\.page|maps\.app\.goo\.gl|goo\.gl|[^/]*\.google\.com)\//i.test(values.googleReviewUrl.trim()) ? (
          <span className="field-error">Heads up: that does not look like a Google host. This check is a heuristic — use “Open link” to be sure.</span>
        ) : null}
        {hasWarning ? (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={linkConfirmed} onChange={(e) => setLinkConfirmed(e.target.checked)} />
            <span>I opened the link and it shows my business's review page. This check is a heuristic, not proof.</span>
          </label>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="ob-website">Website (optional)</label>
          <input id="ob-website" type="url" placeholder="https://…" value={values.website} onChange={(e) => setters.setWebsite(e.target.value)} />
          {err("website") ? <span className="field-error">{err("website")}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="ob-ig">Instagram (optional)</label>
          <input id="ob-ig" type="url" placeholder="https://instagram.com/…" value={values.instagram} onChange={(e) => setters.setInstagram(e.target.value)} />
          {err("socialLinks.instagram") ? <span className="field-error">{err("socialLinks.instagram")}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="ob-discord">Discord or other link (optional)</label>
          <input id="ob-discord" type="url" placeholder="https://discord.gg/…" value={values.discord} onChange={(e) => setters.setDiscord(e.target.value)} />
          {err("socialLinks.discord") ? <span className="field-error">{err("socialLinks.discord")}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn btn-primary btn-big" disabled={busy} type="submit">
          Continue
        </button>
      </div>
    </form>
  );
}

function AiStep({
  busy,
  aiDraft,
  setAiDraft,
  testResult,
  onTest,
  canContinue,
  onContinue,
  status,
}: {
  busy: boolean;
  aiDraft: { style: string; baseUrl: string; model: string; apiKey: string };
  setAiDraft: (d: { style: string; baseUrl: string; model: string; apiKey: string }) => void;
  testResult: TestResult | null;
  onTest: () => void;
  canContinue: boolean;
  onContinue: () => void;
  status?: SetupItem;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusChip item={status} />
        <span className="card-sub">Required — drafting, themes and the assistant need a working AI provider.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="ob-ai-style">Style</label>
          <select
            id="ob-ai-style"
            value={aiDraft.style}
            onChange={(e) => setAiDraft({ ...aiDraft, style: e.target.value })}
            required
          >
            <option value="">Choose…</option>
            <option value="anthropic">Anthropic Messages</option>
            <option value="openai">OpenAI-style Chat Completions</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ob-ai-url">Base URL</label>
          <input
            id="ob-ai-url"
            type="url"
            placeholder={aiDraft.style === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
            value={aiDraft.baseUrl}
            onChange={(e) => setAiDraft({ ...aiDraft, baseUrl: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="ob-ai-model">Model ID</label>
          <input id="ob-ai-model" value={aiDraft.model} onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })} placeholder="e.g. claude-sonnet-4-5 or gpt-4o-mini" />
        </div>
        <div className="field">
          <label htmlFor="ob-ai-key">API key</label>
          <input id="ob-ai-key" type="password" value={aiDraft.apiKey} onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })} placeholder="unchanged" />
        </div>
      </div>
      <a className="card-sub" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
        Where do I get this? (Anthropic) · OpenAI: platform.openai.com/api-keys
      </a>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" onClick={onTest} disabled={busy} type="button">
          Test connection
        </button>
        <button className="btn btn-primary btn-big" onClick={onContinue} disabled={!canContinue || busy} type="button">
          {canContinue ? "Continue" : "Test connection must pass first"}
        </button>
      </div>
      {testResult ? (
        testResult.ok ? (
          <OkBanner message={testResult.note ?? "Connection works."} />
        ) : (
          <ErrorBanner message={testResult.error?.message ?? "Connection failed."} />
        )
      ) : null}
    </div>
  );
}

function EmailStep({
  busy,
  settings,
  adapterId,
  setAdapterId,
  adapterConfig,
  setAdapterConfig,
  testResult,
  onTest,
  canContinue,
  onContinue,
  status,
}: {
  busy: boolean;
  settings: Settings;
  adapterId: string;
  setAdapterId: (v: string) => void;
  adapterConfig: Record<string, string>;
  setAdapterConfig: (c: Record<string, string>) => void;
  testResult: TestResult | null;
  onTest: () => void;
  canContinue: boolean;
  onContinue: () => void;
  status?: SetupItem;
}) {
  const adapter = settings.emailAdapters.find((a) => a.id === adapterId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusChip item={status} />
        <span className="card-sub">Required — review requests have to reach your customers somehow.</span>
      </div>
      <div className="field">
        <label htmlFor="ob-adapter">Email provider</label>
        <select id="ob-adapter" value={adapterId} onChange={(e) => setAdapterId(e.target.value)}>
          {settings.emailAdapters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {adapterId === "copy-only" ? (
          <span className="card-sub">
            Copy only: Starlly writes the email, you copy and paste it. No keys, no sending — counts as complete.
          </span>
        ) : null}
      </div>
      {(adapter?.configFields ?? []).map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`ob-af-${f.key}`}>
            {f.label}
            {f.required ? " *" : ""}
          </label>
          <input
            id={`ob-af-${f.key}`}
            type={f.type}
            placeholder={f.placeholder ?? (f.type === "password" ? "unchanged" : "")}
            value={adapterConfig[f.key] ?? ""}
            onChange={(e) => setAdapterConfig({ ...adapterConfig, [f.key]: e.target.value })}
          />
          {f.docsUrl ? (
            <a className="card-sub" href={f.docsUrl} target="_blank" rel="noreferrer">
              Where do I get this?
            </a>
          ) : null}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" onClick={onTest} disabled={busy} type="button">
          Test connection
        </button>
        <button className="btn btn-primary btn-big" onClick={onContinue} disabled={!canContinue || busy} type="button">
          {canContinue ? "Continue" : "Test connection must pass first"}
        </button>
      </div>
      {testResult ? (
        testResult.ok ? (
          <OkBanner message={testResult.note ?? "Connection works."} />
        ) : (
          <ErrorBanner message={testResult.error?.message ?? "Connection failed."} />
        )
      ) : null}
    </div>
  );
}

function PlacesStep({
  busy,
  placesKey,
  setPlacesKey,
  lookup,
  onLookup,
  onConfirm,
  onSkip,
  status,
}: {
  busy: boolean;
  placesKey: string;
  setPlacesKey: (v: string) => void;
  lookup: { ok: true; places: { placeId: string; name: string; address: string; rating: number | null; reviewCount: number | null }[] } | { ok: false; message: string } | null;
  onLookup: () => void;
  onConfirm: (placeId: string) => void;
  onSkip: () => void;
  status?: SetupItem;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusChip item={status} />
        <span className="card-sub">Used for your rating and review count. It never touches the review corpus.</span>
      </div>
      <div className="field">
        <label htmlFor="ob-places-key">Google Places API key</label>
        <input id="ob-places-key" type="password" value={placesKey} onChange={(e) => setPlacesKey(e.target.value)} placeholder="unchanged" />
        <a className="card-sub" href="https://developers.google.com/maps/documentation/places/web-service/get-api-key" target="_blank" rel="noreferrer">
          Where do I get this?
        </a>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" onClick={onLookup} disabled={busy} type="button">
          Look up my listing
        </button>
      </div>
      {lookup ? (
        lookup.ok ? (
          lookup.places.length === 0 ? (
            <ErrorBanner message="No listing found for your business name and city. Check your Google Business Profile name." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="small muted">Is this you? Pick your listing to confirm.</span>
              {lookup.places.map((p) => (
                <button key={p.placeId} className="place-row" type="button" onClick={() => onConfirm(p.placeId)} disabled={busy}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <strong>{p.name || "(unnamed listing)"}</strong>
                    <span className="card-sub">{p.address}</span>
                  </span>
                  <span className="badge">
                    {p.rating != null ? `${p.rating.toFixed(1)} ★` : "No rating"}
                    {p.reviewCount != null ? ` · ${p.reviewCount} reviews` : ""}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <ErrorBanner message={lookup.message} />
        )
      ) : null}
      <div className="setup-skip-box">
        <strong>Don't want to use the Places API?</strong>
        <span className="card-sub">
          You can skip it — paste or import your reviews instead, and the dashboard computes from those.
        </span>
        <button className="btn" onClick={onSkip} disabled={busy} type="button">
          I'll paste or import my reviews instead
        </button>
      </div>
    </div>
  );
}

function ExaStep({
  busy,
  onSaveKey,
  onContinue,
  status,
}: {
  busy: boolean;
  onSaveKey: (key: string) => Promise<void>;
  onContinue: () => void;
  status?: SetupItem;
}) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusChip item={status} />
        <span className="card-sub">Optional — Enriches your business profile from the web. Exa also works keyless on a rate-limited free plan.</span>
      </div>
      <div className="field">
        <label htmlFor="ob-exa-key">Exa API key</label>
        <input id="ob-exa-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="unchanged" />
        <a className="card-sub" href="https://dashboard.exa.ai/api-keys" target="_blank" rel="noreferrer">
          Where do I get this?
        </a>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn"
          type="button"
          disabled={busy || saved}
          onClick={async () => {
            await onSaveKey(key);
            setSaved(true);
          }}
        >
          Save key
        </button>
        <button className="btn btn-primary btn-big" onClick={onContinue} disabled={busy} type="button">
          Continue
        </button>
      </div>
      {saved ? <OkBanner message="Exa key saved." /> : null}
    </div>
  );
}

function TestEmailStep({
  busy,
  result,
  onSend,
  onContinue,
  skipped,
  status,
}: {
  busy: boolean;
  result: { ok: boolean; message: string } | null;
  onSend: () => void;
  onContinue: () => void;
  skipped: boolean;
  status?: SetupItem;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusChip item={status} />
        <span className="card-sub">The last check: one test email to you, with a preview customer page.</span>
      </div>
      {skipped ? (
        <>
          <OkBanner message="Copy only is your email provider — nothing to send. This step is skipped." />
          <div>
            <button className="btn btn-primary btn-big" onClick={onContinue} disabled={busy} type="button">
              Continue
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={onSend} disabled={busy} type="button">
              Send a test email to me
            </button>
            <button className="btn btn-primary btn-big" onClick={onContinue} disabled={!result?.ok || busy} type="button">
              {result?.ok ? "Continue" : "Send the test first"}
            </button>
          </div>
          {result ? result.ok ? <OkBanner message={result.message} /> : <ErrorBanner message={result.message} /> : null}
        </>
      )}
    </div>
  );
}

function DoneStep({
  busy,
  passwordConfigured,
  finalPassword,
  setFinalPassword,
  onComplete,
}: {
  busy: boolean;
  passwordConfigured: boolean;
  finalPassword: string;
  setFinalPassword: (v: string) => void;
  onComplete: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <OkBanner message="Everything checks out. One last thing — protect your data." />
      {!passwordConfigured ? (
        <div className="field">
          <label htmlFor="ob-final-pass">Dashboard password (8+ characters)</label>
          <input
            id="ob-final-pass"
            type="password"
            value={finalPassword}
            onChange={(e) => setFinalPassword(e.target.value)}
            minLength={8}
            required
            autoFocus
          />
          <span className="card-sub">
            One password for this machine — it protects the owner dashboard. Your customers never need an account.
          </span>
        </div>
      ) : (
        <p className="card-sub">Your dashboard password is already set.</p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btn btn-primary btn-big"
          onClick={onComplete}
          disabled={busy || (!passwordConfigured && finalPassword.length < 8)}
          type="button"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}

