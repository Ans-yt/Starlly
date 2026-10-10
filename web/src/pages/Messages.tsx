// Messages (design.md §7): draft list + editor with the full control path:
// Edit → Preview → Check policy → Send test to me → Approve → Send.
// The approval state is the server's truth; editing an approved draft visibly
// reverts it to Draft (GLOSSARY: any edit invalidates approval).
import EmailStudio, {
  EmailPreview,
  type EmailDesign,
} from "../components/EmailStudio.js";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type DraftRow, type SendResponse } from "../lib/api.js";
import {
  EmptyState,
  ErrorBanner,
  Modal,
  OkBanner,
  Spinner,
} from "../components/ui.js";

interface PolicyIssue {
  rule: string;
  message: string;
  excerpt?: string;
}

export default function MessagesPage() {
  const { draftId } = useParams<{ draftId?: string }>();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [selected, setSelected] = useState<DraftRow | null>(null);
  const [subject, setSubject] = useState("");
  const [emailDesign, setEmailDesign] = useState<EmailDesign | null>(null);
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [policyIssues, setPolicyIssues] = useState<PolicyIssue[] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState<SendResponse | null>(null);
  const [ambiguousJobId, setAmbiguousJobId] = useState<string | null>(null);

  const loadDrafts = async () => {
    try {
      const res = await api.get<{ drafts: DraftRow[] }>("/api/drafts");
      setDrafts(res.drafts);
      if (!selected && res.drafts.length > 0 && !draftId) {
        selectDraft(res.drafts[0]);
      }
      if (draftId) {
        const found = res.drafts.find((d) => d.id === draftId);
        if (found) selectDraft(found);
      }
    } catch {
      setError("Could not load drafts.");
    }
  };

  const selectDraft = (d: DraftRow) => {
    setSelected(d);
    setSubject(d.subject);
    setBody(d.body);
    setEmailDesign(d.emailDesign);
    setDirty(false);
    setPolicyIssues(null);
    setNote(null);
    setError(null);
    navigate(`/messages/${d.id}`, { replace: true });
  };

  useEffect(() => {
    void loadDrafts();
  }, []);

  const refreshDrafts = async () => {
    try {
      const res = await api.get<{ drafts: DraftRow[] }>("/api/drafts");
      setDrafts(res.drafts);
      // Refresh the selected draft in place WITHOUT wiping notes/edits —
      // the approval confirmation must survive the list reload.
      if (draftId) {
        const found = res.drafts.find((d) => d.id === draftId);
        if (found) {
          setSelected(found);
          if (!dirty) {
            setSubject(found.subject);
            setBody(found.body);
            setEmailDesign(found.emailDesign);
          }
        }
      }
    } catch {
      setError("Could not load drafts.");
    }
  };

  const saveEdit = async (manageBusy = true) => {
    if (!selected) return false;
    if (manageBusy) setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{
        status: string;
        approvalInvalidated: boolean;
      }>(`/api/drafts/${selected.id}`, {
        subject,
        body,
        emailDesign,
      });
      setDirty(false);
      if (res.approvalInvalidated) {
        setNote(
          "Edited after approval — the approval was removed. Approve again before sending.",
        );
      }
      await loadDrafts();
      if (res.approvalInvalidated)
        setNote(
          "Edited after approval — the approval was removed. Approve again before sending.",
        );
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
      return false;
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const runPolicy = async () => {
    if (!selected) return;
    if (dirty && !(await saveEdit())) return;
    try {
      const res = await api.post<{ issues: PolicyIssue[] }>(
        `/api/drafts/${selected.id}/policy`,
      );
      setPolicyIssues(res.issues);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not check policy.",
      );
    }
  };

  const testSend = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (dirty && !(await saveEdit(false))) return;
      const res = await api.post<{ outcome: string }>(
        `/api/drafts/${selected.id}/test-send`,
      );
      setNote(
        res.outcome === "accepted"
          ? "Test email sent to you."
          : `Test send: ${res.outcome}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test send failed.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (dirty && !(await saveEdit(false))) return;
      await api.post(`/api/drafts/${selected.id}/approve`);
      await refreshDrafts();
      setNote("Approved. Sending is now enabled.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<SendResponse>(
        `/api/drafts/${selected.id}/send`,
      );
      await refreshDrafts();
      if (res.outcome === "accepted") {
        if (res.copyText) {
          setCopyOpen(res);
        } else {
          setNote("Sent.");
        }
      } else if (res.outcome === "duplicate") {
        setNote("This draft was already sent.");
      } else if (res.outcome === "ambiguous") {
        setAmbiguousJobId(res.job.id);
        setError(
          res.job.lastError ??
            "The provider timed out. The message may or may not have been sent — decide below.",
        );
      } else {
        setError(res.job.lastError ?? "Send failed.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "policy_failed") {
        setPolicyIssues(err.body.issues);
        setError("Policy check failed — fix the issues before sending.");
      } else if (err instanceof ApiError) {
        setError(err.body?.message ?? err.message);
      } else {
        setError("Send failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const resolveAmbiguous = async (decision: "sent" | "failed") => {
    if (!ambiguousJobId) return;
    setBusy(true);
    await api.post(`/api/send-jobs/${ambiguousJobId}/resolve`, { decision });
    setAmbiguousJobId(null);
    await refreshDrafts();
    setNote(
      decision === "sent"
        ? "Marked as sent."
        : "Marked as not delivered — you can retry from the draft.",
    );
    setBusy(false);
  };

  if (drafts === null) return <Spinner />;

  const isApproved = selected?.status === "approved";
  const isSent = selected?.status === "sent";

  return (
    <div className="messages-layout">
      <aside className="card" style={{ padding: 12, gap: 8 }}>
        <strong style={{ fontSize: "0.85rem" }}>Drafts</strong>
        {drafts.length === 0 ? (
          <span className="card-sub">
            No drafts yet — create one from Customers → Send request.
          </span>
        ) : (
          drafts.map((d) => (
            <button
              key={d.id}
              className="btn"
              style={{
                justifyContent: "flex-start",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                background:
                  selected?.id === d.id
                    ? "var(--color-primary-soft)"
                    : undefined,
                borderColor:
                  selected?.id === d.id ? "var(--color-primary)" : undefined,
                textAlign: "left",
              }}
              onClick={() => selectDraft(d)}
            >
              <strong style={{ fontSize: "0.8rem" }}>
                {d.subject.slice(0, 40) || "(no subject)"}
              </strong>
              <span className="card-sub">
                {d.kind.replace("_", " ")} ·{" "}
                <span className={`badge badge-${d.status}`}>{d.status}</span>
              </span>
            </button>
          ))
        )}
      </aside>

      <section className="card">
        {!selected ? (
          <EmptyState
            title="No draft selected"
            hint="Pick a draft on the left, or send a request from the Customers page."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <h2 className="card-title" style={{ margin: 0 }}>
                {selected.kind.replace("_", " ")}
              </h2>
              <span className={`badge badge-${selected.status}`}>
                {selected.status}
              </span>
            </div>
            {note ? <OkBanner message={note} /> : null}
            {error ? <ErrorBanner message={error} /> : null}

            <div className="field">
              <label htmlFor="m-subject">Subject</label>
              <input
                id="m-subject"
                value={subject}
                disabled={isSent}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="m-body">
                Body — use {"{{link}}"} where the customer page link goes
              </label>
              <textarea
                id="m-body"
                rows={3}
                value={body}
                disabled={isSent}
                onChange={(e) => {
                  setBody(e.target.value);
                  setDirty(true);
                }}
              />
            </div>

            <div
              className="email-send-actions"
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <button
                className="btn"
                disabled={!dirty || isSent || busy}
                onClick={() => void saveEdit()}
              >
                Save edit
              </button>
              <button
                className="btn"
                disabled={isSent}
                onClick={() => setPreviewOpen(true)}
              >
                Preview
              </button>
              <button
                className="btn"
                disabled={isSent || busy}
                onClick={runPolicy}
              >
                Check policy
              </button>
              <button
                className="btn"
                disabled={isSent || busy}
                onClick={testSend}
              >
                Send test to me
              </button>
              <button
                className="btn"
                disabled={isSent || dirty || busy}
                onClick={approve}
              >
                {isApproved ? "Approved ✓" : "Approve"}
              </button>
              <button
                className="btn btn-primary"
                disabled={!isApproved || dirty || busy}
                onClick={send}
              >
                Approve and send →
              </button>
            </div>
            <EmailStudio
              draftId={selected.id}
              body={body}
              design={emailDesign}
              disabled={!!isSent || busy}
              onChange={(d) => {
                setEmailDesign(d);
                setDirty(true);
                setPolicyIssues(null);
              }}
            />
            <span className="card-sub">
              Every customer gets the same Google link.
            </span>

            {policyIssues ? (
              policyIssues.length === 0 ? (
                <OkBanner message="Policy check passed." />
              ) : (
                <div className="error-banner">
                  <strong>Policy issues:</strong>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {policyIssues.map((i, idx) => (
                      <li key={idx}>
                        {i.message} {i.excerpt ? <em>({i.excerpt})</em> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : null}

            {ambiguousJobId ? (
              <div
                className="card"
                style={{ background: "var(--color-warn-soft)", border: "none" }}
              >
                <strong>Timeout — the provider outcome is unknown.</strong>
                <p className="card-sub" style={{ marginTop: 4 }}>
                  The message may or may not have been sent. Decide what
                  happened — this is never retried automatically.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void resolveAmbiguous("sent")}
                  >
                    It was sent — mark as sent
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => void resolveAmbiguous("failed")}
                  >
                    It failed — allow retry
                  </button>
                </div>
              </div>
            ) : null}

            {selected.sendJob ? (
              <span className="card-sub">
                Last send: {selected.sendJob.status}
                {selected.sendJob.providerMessageId
                  ? ` · message id ${selected.sendJob.providerMessageId}`
                  : ""}
                {selected.sendJob.lastError
                  ? ` · ${selected.sendJob.lastError}`
                  : ""}
              </span>
            ) : null}
          </div>
        )}
      </section>

      {previewOpen && selected ? (
        <Modal title="Preview" onClose={() => setPreviewOpen(false)}>
          <strong>{subject}</strong>
          <EmailPreview
            draftId={selected.id}
            body={body}
            design={emailDesign}
          />
        </Modal>
      ) : null}

      {copyOpen ? (
        <Modal title="Copy your email" onClose={() => setCopyOpen(null)}>
          <p className="card-sub">
            Copy only mode — nothing was dispatched. Copy this text into your
            email app:
          </p>
          <textarea
            readOnly
            rows={10}
            value={copyOpen.copyText ?? ""}
            style={{ width: "100%" }}
          />
          <p className="card-sub">
            Customer page link: <code>{copyOpen.link}</code>
          </p>
          {copyOpen.copyHtml && (
            <button
              className="btn"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([copyOpen.copyHtml!], { type: "text/html" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "customer-email.html";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download HTML email
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              void navigator.clipboard.writeText(copyOpen.copyText ?? "");
              setCopyOpen(null);
            }}
          >
            Copy text
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
