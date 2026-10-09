// Customers (design.md §6). Filter chips use GLOSSARY vocabulary:
// All / Waiting / Requested / Needs a call (never "Reviewed").
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type CustomerRow } from "../lib/api.js";
import { EmptyState, ErrorBanner, Modal, OkBanner, Spinner, derivedLabel, statusBadgeClass } from "../components/ui.js";
import { Icon } from "../components/icons.js";

type Filter = "all" | "waiting" | "requested" | "needs_call";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["waiting", "Waiting"],
  ["requested", "Requested"],
  ["needs_call", "Needs a call"],
];

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setError(null);
    try {
      const res = await api.get<{ customers: CustomerRow[] }>(`/api/customers?filter=${filter}`);
      setRows(res.customers);
    } catch {
      setError("Could not load customers.");
    }
  };

  useEffect(() => {
    void load();
  }, [filter]);

  const sendRequest = async (c: CustomerRow) => {
    if (!c.consent) {
      setError(`${c.name} hasn't confirmed consent — Starlly only messages customers who agreed to be contacted.`);
      return;
    }
    const business = await api.get<{ name: string; ownerName: string }>("/api/business");
    const draft = await api.post<{ id: string }>("/api/drafts", {
      kind: "review_request",
      customerId: c.id,
      subject: "How did we do?",
      body: `Hi {{customer}},\n\nThanks for choosing {{business}}! We'd love your feedback:\n\n{{link}}\n\n— ${business.ownerName || "the team"}`,
    });
    navigate(`/messages/${draft.id}`);
  };

  const markCalled = async (c: CustomerRow) => {
    await api.patch(`/api/customers/${c.id}`, { callResolvedAt: new Date().toISOString() });
    await api.post(`/api/customers/${c.id}/notes`, { text: "Called — marked as handled.", kind: "call_outcome" });
    setNote(`Marked ${c.name} as called.`);
    await load();
  };

  if (error && !rows) return <ErrorBanner message={error} onRetry={load} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 className="card-title">Customers</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            Add customer
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            Import list
          </button>
        </div>
      </div>
      {note ? <OkBanner message={note} /> : null}
      {error && rows ? <ErrorBanner message={error} /> : null}
      <div style={{ display: "flex", gap: 6 }}>
        {FILTERS.map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {!rows ? (
          <div style={{ padding: 32, display: "grid", placeItems: "center" }}>
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No customers yet"
            hint="Add customers manually or import a CSV list."
            action={
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
                  Add customer
                </button>
                <button className="btn" onClick={() => setImportOpen(true)}>
                  Import list
                </button>
              </div>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Service</th>
                <th>Last job</th>
                <th>Status</th>
                <th>Consent</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.contact}</td>
                  <td>{c.serviceType || "—"}</td>
                  <td>{c.lastJobDate ? new Date(c.lastJobDate).toLocaleDateString() : "—"}</td>
                  <td>
                    <span className={statusBadgeClass(c.derived)}>{derivedLabel(c.derived)}</span>
                  </td>
                  <td>{c.consent ? "✓" : "—"}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn" onClick={() => void sendRequest(c)}>
                      <Icon name="send" size={16} /> Send request
                    </button>
                    {c.derived === "needs_call" ? (
                      <button className="btn" onClick={() => void markCalled(c)}>
                        Mark as called
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen ? <AddCustomerModal onClose={() => setAddOpen(false)} onAdded={load} /> : null}
      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onImported={load} /> : null}
    </div>
  );
}

function AddCustomerModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", contact: "", serviceType: "", lastJobDate: "", consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/customers", {
        name: form.name,
        contact: form.contact,
        serviceType: form.serviceType || undefined,
        lastJobDate: form.lastJobDate || null,
        consent: form.consent,
      });
      await onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? "Check the fields — name, a valid email, and consent are required." : "Could not add the customer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add customer" onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="field">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-contact">Email</label>
        <input id="c-contact" type="email" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-service">Service type</label>
        <input id="c-service" value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-date">Last job date</label>
        <input id="c-date" type="date" value={form.lastJobDate} onChange={(e) => setForm({ ...form, lastJobDate: e.target.value })} />
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9rem" }}>
        <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
        This customer agreed to be contacted
      </label>
      <button className="btn btn-primary" disabled={busy || !form.name || !form.contact || !form.consent} onClick={submit}>
        Add customer
      </button>
      <span className="card-sub">Starlly only messages customers with confirmed consent.</span>
    </Modal>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { line: number; message: string }[] } | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      setResult(await api.post("/api/customers/import", { csv }));
      await onImported();
    } catch {
      setResult({ imported: 0, errors: [{ line: 0, message: "Import request failed." }] });
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File) => {
    setCsv(await file.text());
  };

  return (
    <Modal title="Import customers" onClose={onClose}>
      <p className="card-sub">
        CSV with header: <code>name, contact, serviceType, lastJobDate, consent</code> (consent: yes/no).
      </p>
      <div className="field">
        <label htmlFor="c-file">CSV file</label>
        <input id="c-file" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
      </div>
      <div className="field">
        <label htmlFor="c-csv">Or paste CSV</label>
        <textarea id="c-csv" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={busy || csv.trim().length === 0} onClick={submit}>
        Import
      </button>
      {result ? (
        result.errors.length === 0 ? (
          <OkBanner message={`Imported ${result.imported} customers.`} />
        ) : (
          <ErrorBanner
            message={`Imported ${result.imported}. Problems: ${result.errors
              .slice(0, 5)
              .map((e) => `line ${e.line}: ${e.message}`)
              .join("; ")}`}
          />
        )
      ) : null}
    </Modal>
  );
}
