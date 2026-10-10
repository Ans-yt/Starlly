// Settings (design.md §9): business profile with source labels, email/AI
// providers with test buttons, Places/Exa keys, demo data load/remove,
// backup/export/import, delete my data. Secrets are masked by the server;
// the form sends only changed values.
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Business, type Settings } from "../lib/api.js";
import { ErrorBanner, Modal, OkBanner, Spinner } from "../components/ui.js";
import { StatusChip } from "./Onboarding.js";

type ConnectionTestResult = { ok: boolean; note?: string; error?: { message: string } };

export default function SettingsPage() {
  const [business, setBusiness] = useState<Business | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [aiTestResult, setAiTestResult] = useState<ConnectionTestResult | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [adapterConfigDraft, setAdapterConfigDraft] = useState<Record<string, string>>({});
  const [aiDraft, setAiDraft] = useState({ style: "", baseUrl: "", model: "", apiKey: "" });
  const [placesDraft, setPlacesDraft] = useState("");
  const [exaDraft, setExaDraft] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoConfirmOverwrite, setDemoConfirmOverwrite] = useState(false);
  const demoFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const importRef = useRef<HTMLInputElement | null>(null);

  const sampleLoaded = settings?.sampleLoaded === true;

  const load = async () => {
    setError(null);
    try {
      const [b, s] = await Promise.all([api.get<Business>("/api/business"), api.get<Settings>("/api/settings")]);
      setBusiness(b);
      setSettings(s);
      setAiDraft({ style: s.aiStyle ?? "", baseUrl: s.aiBaseUrl ?? "", model: s.aiModel ?? "", apiKey: "" });
    } catch {
      setError("Could not load settings.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!business || !settings) return <Spinner />;

  const adapter = settings.emailAdapters.find((a) => a.id === settings.emailAdapterId);

  const saveAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/business", {
        name: business.name,
        ownerName: business.ownerName,
        ownerEmail: business.ownerEmail,
        city: business.city,
        sinceDate: business.sinceDate,
        googleReviewUrl: business.googleReviewUrl,
        website: business.website,
      });
      const emailConfig: Record<string, string> = {};
      for (const [k, v] of Object.entries(adapterConfigDraft)) {
        if (v !== "") emailConfig[k] = v;
      }
      await api.put("/api/settings", {
        emailAdapterId: settings.emailAdapterId,
        emailConfig: Object.keys(emailConfig).length > 0 ? emailConfig : undefined,
        aiStyle: aiDraft.style === "" ? null : aiDraft.style,
        aiBaseUrl: aiDraft.baseUrl,
        aiModel: aiDraft.model,
        ...(aiDraft.apiKey ? { aiApiKey: aiDraft.apiKey } : {}),
      });
      setAdapterConfigDraft({});
      setNote("Saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const testEmail = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const emailConfig: Record<string, string> = {};
      for (const [k, v] of Object.entries(adapterConfigDraft)) if (v !== "") emailConfig[k] = v;
      if (Object.keys(emailConfig).length > 0) await api.put("/api/settings", { emailConfig });
      setAdapterConfigDraft({});
      setTestResult(await api.post("/api/settings/test-email"));
    } catch (err) {
      setTestResult({ ok: false, error: { message: err instanceof Error ? err.message : "Test failed." } });
    } finally {
      setBusy(false);
    }
  };

  const testAi = async () => {
    setBusy(true);
    setAiTesting(true);
    setAiTestResult(null);
    setTestResult(null);
    setError(null);
    setNote(null);
    try {
      // Test the values in the form, not a previously saved provider.
      await api.put("/api/settings", {
        aiStyle: aiDraft.style === "" ? null : aiDraft.style,
        aiBaseUrl: aiDraft.baseUrl.trim(),
        aiModel: aiDraft.model.trim(),
        ...(aiDraft.apiKey.trim() ? { aiApiKey: aiDraft.apiKey.trim() } : {}),
      });
      setAiDraft(draft => ({ ...draft, apiKey: "" }));
      setAiTestResult(await api.post<ConnectionTestResult>("/api/settings/test-ai"));
    } catch (err) {
      setAiTestResult({ ok: false, error: { message: err instanceof Error ? err.message : "Connection test failed. Try again." } });
    } finally {
      // Refresh the verified status without discarding unrelated form edits.
      try { setSettings(await api.get<Settings>("/api/settings")); } catch { /* Keep the test result visible. */ }
      setAiTesting(false);
      setBusy(false);
    }
  };

  const exportData = async () => {
    const snapshot = await api.get("/api/data/export");
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `starlly-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNote("Backup exported.");
  };

  const deleteAll = async () => {
    setBusy(true);
    try {
      await api.post("/api/data/delete");
      setDeleteOpen(false);
      setNote("All data deleted. The app is empty — you can import a backup or start fresh.");
      await load();
    } catch {
      setError("Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const importData = () => importRef.current?.click();

  const onImportFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text) as unknown;
      await api.post("/api/data/import", snapshot);
      setNote("Backup imported.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed — is it a JSON export from Starlly?");
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const loadDemoData = async () => {
    setBusy(true);
    setError(null);
    try {
      // Read the owner's demo files (fake-data shape) from the file inputs.
      const kinds = ["business", "customers", "reviews", "feedback", "requests", "themes", "trend_weekly"];
      const data: Record<string, unknown> = {};
      let found = 0;
      for (const kind of kinds) {
        const file = demoFileRefs.current[kind]?.files?.[0];
        if (file) {
          data[kind] = JSON.parse(await file.text());
          found++;
        }
      }
      if (found === 0) {
        setError("Choose the demo JSON files first (business, customers, reviews, feedback, requests, themes — trend_weekly is optional).");
        return;
      }
      await api.post("/api/sample-data/load", { data, confirmOverwrite: demoConfirmOverwrite });
      setDemoOpen(false);
      setDemoConfirmOverwrite(false);
      setNote("Demo data loaded — it is labeled “Sample data” and removable at any time.");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "real_data_present") {
        setError(
          `You have real data (${err.body.customers ?? 0} customers, ${err.body.reviews ?? 0} reviews). Tick the confirmation box to overwrite anyway.`,
        );
      } else if (err instanceof ApiError && err.body?.errors) {
        setError(`Demo files rejected: ${(err.body.errors as string[]).slice(0, 3).join("; ")}`);
      } else {
        setError(err instanceof Error ? err.message : "Could not load demo data.");
      }
    } finally {
      setBusy(false);
    }
  };

  const removeDemoData = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ removed: Record<string, number>; restoredSnapshot: boolean }>("/api/sample-data/unload");
      setNote(
        result.restoredSnapshot
          ? "Demo data removed — your previous data was restored."
          : `Demo data removed (${result.removed.customers ?? 0} customers, ${result.removed.reviews ?? 0} reviews).`,
      );
      await load();
    } catch {
      setError("Could not remove demo data.");
    } finally {
      setBusy(false);
    }
  };

  const savePlacesKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/settings", { googlePlacesApiKey: placesDraft });
      setPlacesDraft("");
      setNote("Places key saved. Run a lookup from the setup flow or use it during onboarding to confirm your listing.");
      await load();
    } catch {
      setError("Could not save the Places key.");
    } finally {
      setBusy(false);
    }
  };

  const saveExaKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/settings", { exaApiKey: exaDraft });
      setExaDraft("");
      setNote("Exa key saved.");
      await load();
    } catch {
      setError("Could not save the Exa key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <h1 className="card-title">Settings</h1>
      {error ? <ErrorBanner message={error} /> : null}
      {note ? <OkBanner message={note} /> : null}
      {testResult ? (
        testResult.ok ? (
          <OkBanner message={testResult.note ?? "Connection works."} />
        ) : (
          <ErrorBanner message={testResult.error?.message ?? "Test failed."} />
        )
      ) : null}

      <section className="card">
        <h2 className="card-title">Business profile</h2>
        <div className="field">
          <label htmlFor="s-name">Company name {business.fieldSources?.name ? `(source: ${business.fieldSources.name})` : ""}</label>
          <input id="s-name" value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="s-owner">Owner</label>
            <input id="s-owner" value={business.ownerName} onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-email">Your email (test sends)</label>
            <input id="s-email" type="email" value={business.ownerEmail} onChange={(e) => setBusiness({ ...business, ownerEmail: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-city">City / address</label>
            <input id="s-city" value={business.city} onChange={(e) => setBusiness({ ...business, city: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-since">Since</label>
            <input id="s-since" placeholder="2020" value={business.sinceDate ?? ""} onChange={(e) => setBusiness({ ...business, sinceDate: e.target.value || null })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-glink">Google review link (same for every customer)</label>
          <input id="s-glink" type="url" value={business.googleReviewUrl} onChange={(e) => setBusiness({ ...business, googleReviewUrl: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-glink">Google review link (same for every customer)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="s-glink" type="url" value={business.googleReviewUrl} onChange={(e) => setBusiness({ ...business, googleReviewUrl: e.target.value })} />
            <button className="btn" type="button" onClick={() => window.open(business.googleReviewUrl, "_blank", "noopener")} disabled={!business.googleReviewUrl.trim()}>
              Open link
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="s-website">Website</label>
            <input id="s-website" type="url" value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-ig">Instagram</label>
            <input
              id="s-ig"
              type="url"
              placeholder="https://instagram.com/…"
              value={business.socialLinks?.instagram ?? ""}
              onChange={(e) => setBusiness({ ...business, socialLinks: { ...business.socialLinks, instagram: e.target.value } })}
            />
          </div>
          <div className="field">
            <label htmlFor="s-discord">Discord / other</label>
            <input
              id="s-discord"
              type="url"
              placeholder="https://discord.gg/…"
              value={business.socialLinks?.discord ?? ""}
              onChange={(e) => setBusiness({ ...business, socialLinks: { ...business.socialLinks, discord: e.target.value } })}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Email provider</h2>
        <div className="field">
          <label htmlFor="s-adapter">Provider</label>
          <select
            id="s-adapter"
            value={settings.emailAdapterId}
            onChange={async (e) => {
              await api.put("/api/settings", { emailAdapterId: e.target.value });
              await load();
              setNote("Email provider changed.");
            }}
          >
            {settings.emailAdapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        {adapter?.configFields.map((f) => {
          const existing = settings.emailConfig[f.key];
          return (
            <div className="field" key={f.key}>
              <label htmlFor={`s-${f.key}`}>
                {f.label} {existing?.set ? <em className="card-sub">(set: {existing.masked})</em> : f.required ? "" : " (optional)"}
              </label>
              <input
                id={`s-${f.key}`}
                type={f.type === "password" ? "password" : "text"}
                placeholder={f.placeholder ?? "unchanged"}
                value={adapterConfigDraft[f.key] ?? ""}
                onChange={(e) => setAdapterConfigDraft((c) => ({ ...c, [f.key]: e.target.value }))}
              />
              {f.docsUrl ? (
                <a className="card-sub" href={f.docsUrl} target="_blank" rel="noreferrer">
                  Where do I get this?
                </a>
              ) : null}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={testEmail} disabled={busy}>
            Test connection
          </button>
          {settings.emailAdapterId !== "copy-only" ? (
            <StatusChip
              item={{
                done: false,
                status: settings.emailLastTestAt ? "connected" : settings.emailAdapterId ? "saved" : "not_set",
                lastTestAt: settings.emailLastTestAt,
              }}
            />
          ) : (
            <span className="setup-chip connected">No keys needed</span>
          )}
        </div>
        <span className="card-sub">
          {/* Honesty per owner decision: only plain-text sending is confirmed by a
              live test; HTML/reply-to support is documented but unverified. */}
          Capabilities: plain text ✓ ·{" "}
          {adapter?.capabilities.html ? "HTML documented, unverified" : "no HTML"} ·{" "}
          {adapter?.capabilities.replyTo ? "reply-to documented, unverified" : "no reply-to"} · stored only on this computer.
        </span>
      </section>

      <section className="card">
        <h2 className="card-title">AI provider</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label htmlFor="s-aistyle">Style</label>
            <select id="s-aistyle" value={aiDraft.style} onChange={(e) => setAiDraft({ ...aiDraft, style: e.target.value })}>
              <option value="">Not set</option>
              <option value="openai">OpenAI-style Chat Completions</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="s-aimodel">Model ID</label>
            <input id="s-aimodel" value={aiDraft.model} onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-aibase">Base URL</label>
          <input id="s-aibase" value={aiDraft.baseUrl} onChange={(e) => setAiDraft({ ...aiDraft, baseUrl: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-aikey">
            API key {settings.aiApiKey.set ? <em className="card-sub">(set: {settings.aiApiKey.masked})</em> : ""}
          </label>
          <input id="s-aikey" type="password" placeholder="unchanged" value={aiDraft.apiKey} onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })} />
        </div>
        <button className="btn" onClick={testAi} disabled={busy}>
          {aiTesting ? "Testing…" : "Test connection"}
        </button>
        {aiTestResult ? (
          aiTestResult.ok ? <OkBanner message={aiTestResult.note ?? "Connection works."} />
            : <ErrorBanner message={aiTestResult.error?.message ?? "Connection test failed. Try again."} />
        ) : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StatusChip
            item={{
              done: false,
              status: settings.aiLastTestAt ? "connected" : settings.aiStyle ? "saved" : "not_set",
              lastTestAt: settings.aiLastTestAt,
            }}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Google Places & Exa</h2>
        <div className="field">
          <label htmlFor="s-places">
            Google Places API key{" "}
            {settings.googlePlacesApiKey.set ? <em className="card-sub">(set: {settings.googlePlacesApiKey.masked})</em> : "(not set)"}
          </label>
          <input
            id="s-places"
            type="password"
            placeholder="unchanged"
            value={placesDraft}
            onChange={(e) => setPlacesDraft(e.target.value)}
          />
          <a className="card-sub" href="https://developers.google.com/maps/documentation/places/web-service/get-api-key" target="_blank" rel="noreferrer">
            Where do I get this?
          </a>
          <span className="card-sub">Used for your rating and review count only. Prefer not to? Paste or import your reviews instead.</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={savePlacesKey} disabled={busy || !placesDraft.trim()}>
            Save Places key
          </button>
          {business.placeId ? <span className="setup-chip connected">Listing confirmed</span> : <span className="setup-chip">No listing confirmed yet</span>}
        </div>
        <div className="field">
          <label htmlFor="s-exa">
            Exa API key (optional — also works keyless on a rate-limited free plan){" "}
            {settings.exaApiKey.set ? <em className="card-sub">(set: {settings.exaApiKey.masked})</em> : "(not set)"}
          </label>
          <input id="s-exa" type="password" placeholder="unchanged" value={exaDraft} onChange={(e) => setExaDraft(e.target.value)} />
          <a className="card-sub" href="https://dashboard.exa.ai/api-keys" target="_blank" rel="noreferrer">
            Where do I get this?
          </a>
        </div>
        <button className="btn" onClick={saveExaKey} disabled={busy || !exaDraft.trim()}>
          Save Exa key
        </button>
      </section>

      <section className="card">
        <h2 className="card-title">Customer links</h2>
        <p className="card-sub">
          Public base URL: <code>{settings.publicBaseUrl ?? "not set — links use localhost preview URLs"}</code>
        </p>
        <p className="card-sub">
          Set <code>PUBLIC_BASE_URL</code> in <code>.env</code> to your HTTPS address (deploy or tunnel). A locally hosted instance must stay online for customer links to work.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Backups & data</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={exportData}>
            Export data
          </button>
          <button className="btn" onClick={importData}>
            Import backup
          </button>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            Delete my data
          </button>
        </div>
        <span className="card-sub">Export writes a JSON snapshot you can re-import. Delete wipes all business data — your login stays.</span>
      </section>

      <section className="card">
        <h2 className="card-title">Demo data</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={() => setDemoOpen(true)}>
            Load demo data
          </button>
          <button className="btn btn-danger" onClick={removeDemoData} disabled={!sampleLoaded}>
            Remove demo data
          </button>
          {sampleLoaded ? <span className="sample-tag"><span className="dot" /> Sample data is loaded</span> : null}
        </div>
        <span className="card-sub">
          Loads the demo dataset (separate JSON files, owner-supplied) into the local store, labeled "Sample data" everywhere.
          It never touches real records without your explicit confirmation. Remove demo data restores what was there before.
        </span>
      </section>

      <button className="btn btn-primary btn-big" style={{ maxWidth: 200 }} onClick={saveAll} disabled={busy}>
        Save
      </button>

      {deleteOpen ? (
        <Modal title="Delete all data?" onClose={() => setDeleteOpen(false)}>
          <p className="card-sub">
            This permanently deletes all customers, requests, events, reviews, drafts, and send jobs. Your login and provider
            settings stay. Type <strong>DELETE</strong> to confirm.
          </p>
          <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} aria-label="Type DELETE to confirm" />
          <button className="btn btn-danger" disabled={deleteConfirm !== "DELETE" || busy} onClick={deleteAll}>
            Delete everything
          </button>
        </Modal>
      ) : null}

      {demoOpen ? (
        <Modal title="Load demo data?" onClose={() => setDemoOpen(false)}>
          <p className="card-sub">
            Pick the demo JSON files (they load as <strong>Sample data</strong>, labeled everywhere and removable as a unit):
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["business", "customers", "reviews", "feedback", "requests", "themes", "trend_weekly"].map((kind) => (
              <label key={kind} className="field">
                <span>{kind}.json{kind === "trend_weekly" ? " (optional)" : ""}</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  ref={(el) => {
                    demoFileRefs.current[kind] = el;
                  }}
                />
              </label>
            ))}
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
            <input type="checkbox" checked={demoConfirmOverwrite} onChange={(e) => setDemoConfirmOverwrite(e.target.checked)} />
            <span>
              I have real data and I confirm demo data may overwrite it. (Unticked, the load is refused while real data exists.)
            </span>
          </label>
          <button className="btn btn-primary" onClick={loadDemoData} disabled={busy}>
            Load demo data
          </button>
        </Modal>
      ) : null}

      <input
        type="file"
        accept=".json,application/json"
        ref={importRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportFile(file);
        }}
        aria-hidden="true"
      />
    </div>
  );
}
