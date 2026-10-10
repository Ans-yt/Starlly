import { useState } from "react";
import { api, ApiError } from "../lib/api.js";
import { ErrorBanner } from "../components/ui.js";
import { Orb } from "../components/icons.js";

export default function LoginPage({ onLogin }: { onLogin: () => Promise<unknown> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { password });
      await onLogin();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? "Wrong password. Try again." : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <form onSubmit={submit} className="card" style={{ width: 360, gap: 12 }} aria-label="Log in">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Orb size={34} />
          <h1 className="card-title" style={{ margin: 0 }}>
            Starlly
          </h1>
        </div>
        <p className="card-sub">Log in to your business dashboard.</p>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            minLength={1}
          />
        </div>
        <button className="btn btn-primary btn-big" disabled={busy || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
