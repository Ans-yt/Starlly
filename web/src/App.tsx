import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api, type AuthStatus, type Business } from "./lib/api.js";
import { Icon, Orb } from "./components/icons.js";
import ChatPanel from "./components/ChatPanel.js";
import LoginPage from "./pages/Login.js";
import OnboardingPage from "./pages/Onboarding.js";
import OverviewPage from "./pages/Overview.js";
import CustomersPage from "./pages/Customers.js";
import MessagesPage from "./pages/Messages.js";
import InsightsPage from "./pages/Insights.js";
import SettingsPage from "./pages/Settings.js";
import CustomerPage from "./pages/CustomerPage.js";

const AuthContext = createContext<{
  status: AuthStatus | null;
  refresh: () => Promise<AuthStatus>;
}>({ status: null, refresh: async () => ({ configured: false, authenticated: false }) });

export const useAuth = () => useContext(AuthContext);

/** Shared with the Overview via Outlet context (period select lives in the page head). */
export function usePageContext() {
  return useOutletContext<{ period: number; setPeriod: (n: number) => void }>();
}

const HEADS: Record<string, [string, string, string]> = {
  "/": ["A little clarity. A lot of possibility.", "Your business, at a glance.", "Every conversation is a chance to shine."],
  "/customers": ["People, not just a list.", "Good relationships start here.", "A little care makes every customer feel remembered."],
  "/messages": ["Thoughtful words go a long way.", "Make every message matter.", "Write, refine, and approve. You're always in control."],
  "/insights": ["Listen closely. Grow thoughtfully.", "Your next bright idea.", "Turn a few words into a meaningful next step."],
  "/settings": ["Make yourself at home.", "A workspace that feels like you.", "Your business, your connections, your preferences."],
};

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((s) => s[0] ?? "").join("").toUpperCase();
}

function Shell() {
  const [compact, setCompact] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState(30);
  const [business, setBusiness] = useState<Business | null>(null);
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const head = HEADS[location.pathname] ?? HEADS["/"]!;

  useEffect(() => {
    api.get<Business>("/api/business").then(setBusiness).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const exportData = async () => {
    const snapshot = await api.get("/api/data/export");
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `starlly-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  return (
    <>
      <header className="topbar">
        <div className="row">
          <button
            className="icon-btn"
            onClick={() => setCompact((v) => !v)}
            aria-label="Toggle navigation labels"
            aria-expanded={!compact}
          >
            <Icon name="menu" />
          </button>
          <button className="brand" onClick={() => navigate("/")} aria-label="Starlly overview">
            <img className="brand-logo" src="/logo-a-arc-orbit.svg" alt="" width={29} height={29} aria-hidden="true" />
            starlly<span style={{ color: "#af9aca", marginLeft: "-8px" }}>.</span>
          </button>
          {business?.isSample ? (
            <span className="sample-tag" title="Demo data loaded in Settings — remove it any time">
              <span className="dot" /> Sample data
            </span>
          ) : null}
        </div>
        <button className="assistant-trigger" onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen} aria-controls="chatPanel">
          <Orb size={34} />
          <span>Ask Starlly anything…</span>
          <span className="kbd">⌘ K</span>
          <span className="sr-only">Open assistant</span>
        </button>
        <div className="row">
          <button className="icon-btn notification" aria-label="View notifications" title="No new notifications">
            <Icon name="bell" />
          </button>
          <button className="row profile" onClick={() => setMenuOpen((v) => !v)} aria-label="Open profile menu" aria-expanded={menuOpen}>
            <span className="avatar">{initials(business?.ownerName || "Starlly owner")}</span>
            <span className="profile-text">
              <span style={{ fontSize: 11, fontWeight: 600, display: "block" }}>{business?.ownerName || "Business owner"}</span>
              <span className="small muted">Business owner</span>
            </span>
            <Icon name="chevron" size={14} style={{ width: 14 }} />
          </button>
          {menuOpen ? (
            <div className="float-menu">
              <button onClick={() => { setMenuOpen(false); navigate("/settings"); }}>
                <Icon name="settings" size={16} /> Settings
              </button>
              <button onClick={() => { setMenuOpen(false); navigate("/c/preview"); }}>
                <Icon name="eye" size={16} /> Customer preview
              </button>
              <button onClick={() => void exportData()}>
                <Icon name="download" size={16} /> Export data
              </button>
              <button onClick={async () => { await api.post("/api/auth/logout"); window.location.href = "/login"; }}>
                <Icon name="close" size={16} /> Log out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <div className="shell">
        <nav className={compact ? "rail compact" : "rail"} aria-label="Main navigation">
          <NavBtn to="/" label="Overview" icon="grid" end />
          <NavBtn to="/customers" label="Customers" icon="users" />
          <NavBtn to="/messages" label="Messages" icon="mail" />
          <NavBtn to="/insights" label="Insights" icon="chart" />
          <NavBtn to="/settings" label="Settings" icon="settings" />
          <button className="nav-btn rail-bottom" onClick={() => setChatOpen(true)}>
            <Icon name="help" />
            <span>Help & tips</span>
          </button>
        </nav>
        <main className="main">
          <div className="page-head between">
            <div>
              <div className="eyebrow">{head[0]}</div>
              <h1>{head[1]}</h1>
              <p>{head[2]}</p>
            </div>
            {location.pathname === "/" ? (
              <div className="row head-actions">
                <label className="period-select">
                  <Icon name="calendar" size={15} />
                  <span className="sr-only">Dashboard period</span>
                  <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                    <option value={30}>Last 30 days</option>
                    <option value={7}>Last 7 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                </label>
                <button className="btn" onClick={() => navigate("/c/preview")}>
                  <Icon name="eye" size={15} /> Customer preview
                </button>
              </div>
            ) : null}
          </div>
          <Outlet context={{ period, setPeriod }} />
          <footer className="page-footer">
            <span className="row">
              <Icon name="shield" size={11} /> A little more clarity, every day.
            </span>
            <span>Starlly · Your business, a little brighter</span>
          </footer>
        </main>
      </div>
      {chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : null}
    </>
  );
}

function NavBtn({ to, label, icon, end = false }: { to: string; label: string; icon: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}>
      <Icon name={icon} size={21} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const s = await api.get<AuthStatus>("/api/auth/status");
    setStatus(s);
    return s;
  };

  // Setup gate (S1): every route redirects to /setup until setup is complete.
  // The status endpoint is public-but-secretless, so it is safe pre-login.
  const refreshSetup = useCallback(async () => {
    const s = await api.get<{ setupComplete: boolean }>("/api/setup/status");
    setSetupComplete(s.setupComplete);
    return s;
  }, []);

  useEffect(() => {
    Promise.all([refresh().catch(() => ({ configured: false, authenticated: false })), refreshSetup()])
      .then(([auth]) => setStatus(auth))
      .finally(() => setLoading(false));
  }, []);

  if (loading || setupComplete === null) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh" }}>
        <div className="spinner" />
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const authenticated = status?.authenticated ?? false;

  return (
    <AuthContext.Provider value={{ status, refresh }}>
      <BrowserRouter>
        <Routes>
          {/* Public customer page: no shell, no auth, never gated by setup */}
          <Route path="/c/:token" element={<CustomerPage />} />
          <Route path="/c/preview" element={<CustomerPage preview />} />

          {!setupComplete ? (
            // Setup gate is the whole app until the owner finishes (no sample-data shortcut).
            <Route path="*" element={<OnboardingPage onDone={refresh} />} />
          ) : !configured ? (
            <Route path="*" element={<OnboardingPage onDone={refresh} />} />
          ) : !authenticated ? (
            <Route path="*" element={<LoginPage onLogin={refresh} />} />
          ) : (
            <>
              <Route path="/" element={<Shell />}>
                <Route index element={<OverviewPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="messages" element={<MessagesPage />} />
                <Route path="messages/:draftId" element={<MessagesPage />} />
                <Route path="insights" element={<InsightsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Shell />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
