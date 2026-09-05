"use client";

import { useState, useTransition } from "react";
import {
  Download,
  Eye,
  FileUp,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { clientApiFetch } from "../lib/client-api";
import type { VaultExportRecord } from "../lib/vault-ui";
import { normalizeVaultExports, summarizeVaultPreview } from "../lib/vault-ui";

export function VaultConsole({
  initialExports,
  username,
  available,
}: {
  initialExports: VaultExportRecord[];
  username: string;
  available: boolean;
}) {
  const [exports, setExports] = useState(initialExports);
  const [includePublicCache, setIncludePublicCache] = useState(true);
  const [includeReceipts, setIncludeReceipts] = useState(true);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [bannerTone, setBannerTone] = useState<"good" | "warn" | "stop">(
    available ? "good" : "warn",
  );
  const [message, setMessage] = useState(
    available
      ? "Private Usage Vault is ready for portable encrypted metrics-only backup and restore."
      : "Vault API is unavailable for this session. Check API health or sign in again before creating exports.",
  );
  const [previewInput, setPreviewInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewLines, setPreviewLines] = useState<string[]>([
    "No import preview has been run yet.",
  ]);
  const [previewRaw, setPreviewRaw] = useState(
    JSON.stringify(
      {
        format: "toksync-vault-v1",
        mode: "preview-only",
        includeContent: false,
      },
      null,
      2,
    ),
  );
  const [previewTab, setPreviewTab] = useState<"summary" | "json">("summary");
  const [isPending, startTransition] = useTransition();

  const latestExport = exports[0];

  function setNotice(
    tone: "good" | "warn" | "stop",
    text: string,
    previewPayload?: unknown,
  ) {
    setBannerTone(tone);
    setMessage(text);
    if (previewPayload !== undefined) {
      setPreviewLines(summarizeVaultPreview(previewPayload));
      setPreviewRaw(JSON.stringify(previewPayload, null, 2));
    }
  }

  async function refreshExports() {
    startTransition(async () => {
      try {
        const response = await clientApiFetch(
          "/v1/vault/exports",
          { cache: "no-store" },
          username,
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setNotice(
            response.status === 404 || response.status === 501
              ? "warn"
              : "stop",
            `Vault export ledger returned ${response.status}.`,
          );
          return;
        }

        const rows = normalizeVaultExports(payload);
        setExports(rows);
        setNotice(
          "good",
          rows.length > 0
            ? `Loaded ${rows.length} vault export record${rows.length === 1 ? "" : "s"}.`
            : "Vault export ledger is empty. Create the first encrypted backup when ready.",
        );
      } catch {
        setNotice(
          "stop",
          "Vault export ledger refresh failed. Check API availability.",
        );
      }
    });
  }

  async function createExport() {
    if (recoveryPassphrase.length < 12) {
      setNotice(
        "warn",
        "Use a recovery passphrase of at least 12 characters before creating a portable vault export.",
      );
      return;
    }

    startTransition(async () => {
      try {
        const response = await clientApiFetch(
          "/v1/vault/exports",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              format: "toksync-vault-v1",
              includePublicCache,
              includeReceipts,
              includeContent: false,
              recoveryPassphrase,
            }),
          },
          username,
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setNotice(
            response.status === 404 || response.status === 501
              ? "warn"
              : "stop",
            `Vault export creation returned ${response.status}.`,
            payload,
          );
          return;
        }

        await refreshExports();
        setNotice(
          "good",
          "Encrypted metrics-only export created. Keep the recovery passphrase with the downloaded artifact.",
          payload,
        );
      } catch {
        setNotice(
          "stop",
          "Vault export creation failed. Check API availability.",
        );
      }
    });
  }

  async function loadVaultPayload() {
    if (!selectedFile && !previewInput.trim()) {
      setNotice(
        "warn",
        "Provide a vault file or paste vault payload text before running the import lane.",
      );
      return null;
    }

    const rawPayload = selectedFile
      ? await selectedFile.text()
      : previewInput.trim();
    return JSON.parse(rawPayload);
  }

  async function previewImport() {
    if (importPassphrase.length < 12) {
      setNotice(
        "warn",
        "Enter the recovery passphrase before previewing a vault import.",
      );
      return;
    }

    startTransition(async () => {
      try {
        const vaultPayload = await loadVaultPayload();
        if (!vaultPayload) return;

        const response = await clientApiFetch(
          "/v1/vault/imports/preview",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: vaultPayload,
              recoveryPassphrase: importPassphrase,
            }),
          },
          username,
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setNotice(
            response.status === 404 || response.status === 501
              ? "warn"
              : "stop",
            `Vault import preview returned ${response.status}.`,
            payload,
          );
          return;
        }

        setNotice(
          "good",
          "Import preview completed without mutating current private data.",
          payload,
        );
      } catch {
        setNotice(
          "stop",
          "Import preview failed. Check API availability and ensure the selected payload is valid vault JSON.",
        );
      }
    });
  }

  async function restoreImport() {
    if (importPassphrase.length < 12) {
      setNotice(
        "warn",
        "Enter the recovery passphrase before restoring vault metrics.",
      );
      return;
    }

    const confirmed = window.confirm(
      "Restore importable metrics from this vault? Existing matching events will be skipped, but new private usage rows and aggregates may be added.",
    );
    if (!confirmed) {
      setNotice("warn", "Vault restore cancelled; no data was changed.");
      return;
    }

    startTransition(async () => {
      try {
        const vaultPayload = await loadVaultPayload();
        if (!vaultPayload) return;

        const response = await clientApiFetch(
          "/v1/vault/imports",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: vaultPayload,
              recoveryPassphrase: importPassphrase,
            }),
          },
          username,
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setNotice(
            response.status === 404 || response.status === 501
              ? "warn"
              : "stop",
            `Vault import returned ${response.status}.`,
            payload,
          );
          return;
        }

        await refreshExports();
        setNotice(
          "good",
          "Vault restore completed with idempotent duplicate handling.",
          payload,
        );
      } catch {
        setNotice(
          "stop",
          "Vault restore failed. Check API availability, passphrase, and vault JSON.",
        );
      }
    });
  }

  async function downloadExport(entry: VaultExportRecord) {
    startTransition(async () => {
      try {
        const response = await clientApiFetch(
          `/v1/vault/exports/${entry.id}`,
          { cache: "no-store" },
          username,
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setNotice(
            response.status === 404 || response.status === 501
              ? "warn"
              : "stop",
            `Vault artifact fetch returned ${response.status}.`,
            payload,
          );
          return;
        }
        const artifact = payload?.payload ?? payload;
        const blob = new Blob([JSON.stringify(artifact, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${entry.id}.toksync-vault.json`;
        link.click();
        URL.revokeObjectURL(url);
        setNotice(
          "good",
          "Vault artifact downloaded as encrypted JSON.",
          payload,
        );
      } catch {
        setNotice(
          "stop",
          "Vault artifact download failed. Check API availability.",
        );
      }
    });
  }

  return (
    <>
      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Export lane</h2>
              <p className="muted">
                Generate encrypted metrics-only snapshots for migration, offline
                backup, and self-host recovery drills.
              </p>
            </div>
            <span
              className={`pill ${
                available ? "good" : bannerTone === "stop" ? "stop" : "warn"
              }`}
            >
              {available ? "contract live" : "contract pending"}
            </span>
          </div>
          <div className={`notice-strip ${bannerTone}`}>
            <LockKeyhole size={16} />
            <span>{message}</span>
          </div>
          <div className="field-grid" style={{ marginTop: 16 }}>
            <label className="switch-line">
              <div>
                <strong>Include public cache</strong>
                <span>
                  Keep opt-in public aggregates in the encrypted snapshot.
                </span>
              </div>
              <input
                checked={includePublicCache}
                onChange={(event) =>
                  setIncludePublicCache(event.target.checked)
                }
                type="checkbox"
              />
            </label>
            <label className="switch-line">
              <div>
                <strong>Include receipts</strong>
                <span>Preserve digest and upload-boundary receipts.</span>
              </div>
              <input
                checked={includeReceipts}
                onChange={(event) => setIncludeReceipts(event.target.checked)}
                type="checkbox"
              />
            </label>
            <div className="switch-line">
              <div>
                <strong>Include content</strong>
                <span>
                  Locked off. Vault exports stay metrics-only and never include
                  prompt or tool payloads.
                </span>
              </div>
              <span className="pill warn">false</span>
            </div>
            <label className="field">
              <span className="field-label">Recovery passphrase</span>
              <input
                className="input"
                onChange={(event) => setRecoveryPassphrase(event.target.value)}
                placeholder="Required for cross-instance restore"
                type="password"
                value={recoveryPassphrase}
              />
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              disabled={isPending}
              onClick={createExport}
              type="button"
            >
              <KeyRound size={16} />
              Create encrypted export
            </button>
            <button
              className="btn"
              disabled={isPending}
              onClick={refreshExports}
              type="button"
            >
              <RefreshCw size={16} />
              Refresh ledger
            </button>
          </div>
          <div className="integrity-list" style={{ marginTop: 16 }}>
            <div className="integrity-row">
              <div>
                <strong>Latest export</strong>
                <span>
                  {latestExport?.createdAt ?? "No vault export recorded yet."}
                </span>
              </div>
              <span className="pill">
                {latestExport?.status ?? "empty ledger"}
              </span>
            </div>
            <div className="integrity-row">
              <div>
                <strong>Scope</strong>
                <span>{latestExport?.scope ?? "metrics-only / receipts"}</span>
              </div>
              <span className="pill">
                {latestExport?.format ?? "toksync-vault-v1"}
              </span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Export ledger</h2>
              <p className="muted">
                Audit the private backup queue without surfacing raw device
                tokens, paths, prompts, or tool output.
              </p>
            </div>
            <span className="pill">{exports.length} exports</span>
          </div>
          {exports.length === 0 ? (
            <div className="empty-state">
              No vault exports yet. Create one to inspect size, digest, and
              restore metadata.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.createdAt ?? entry.id}</td>
                      <td>{entry.scope}</td>
                      <td>{entry.status}</td>
                      <td>
                        <div className="metric-inline">
                          <span className="metric-value">
                            {entry.eventCount ?? 0} events
                          </span>
                          <span className="metric-value">
                            {entry.sourceCount ?? 0} sources
                          </span>
                          <span className="metric-value">
                            {entry.receiptCount ?? 0} receipts
                          </span>
                          <button
                            className="btn"
                            disabled={isPending}
                            onClick={() => downloadExport(entry)}
                            type="button"
                          >
                            <Download size={14} />
                            Download
                          </button>
                        </div>
                        {entry.digest ? (
                          <div className="table-subtle">{entry.digest}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Import preview</h2>
              <p className="muted">
                Preview, then restore metrics into the current account with
                replay-safe duplicate handling.
              </p>
            </div>
            <span className="pill good">restore ready</span>
          </div>
          <div className="field-grid">
            <label className="field">
              <span className="field-label">Recovery passphrase</span>
              <input
                className="input"
                onChange={(event) => setImportPassphrase(event.target.value)}
                placeholder="Passphrase used when the artifact was exported"
                type="password"
                value={importPassphrase}
              />
            </label>
            <label className="field">
              <span className="field-label">Vault payload text</span>
              <textarea
                className="input textarea"
                onChange={(event) => setPreviewInput(event.target.value)}
                placeholder='Paste a "toksync-vault-v1" payload for dry-run validation.'
                value={previewInput}
              />
            </label>
            <label className="field">
              <span className="field-label">Vault file</span>
              <input
                className="input"
                onChange={(event) =>
                  setSelectedFile(event.target.files?.[0] ?? null)
                }
                type="file"
              />
            </label>
            <div className="notice-strip">
              <FileUp size={16} />
              <span>
                Selected file: {selectedFile?.name ?? "none"}. Preview is
                non-destructive; restore inserts only importable metrics and
                skips duplicates.
              </span>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              disabled={isPending}
              onClick={previewImport}
              type="button"
            >
              <Eye size={16} />
              Run import preview
            </button>
            <button
              className="btn"
              disabled={isPending}
              onClick={restoreImport}
              type="button"
            >
              <FileUp size={16} />
              Restore metrics
            </button>
            <button
              className="btn"
              disabled={isPending}
              onClick={() => {
                setPreviewInput("");
                setSelectedFile(null);
              }}
              type="button"
            >
              <RotateCw size={16} />
              Reset input
            </button>
          </div>
        </div>
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Preview output</h2>
              <p className="muted">
                Summary view stays dense for operators; raw JSON remains
                available for exact diffing.
              </p>
            </div>
          </div>
          <div className="toolbar">
            <button
              className={`segmented ${previewTab === "summary" ? "active" : ""}`}
              onClick={() => setPreviewTab("summary")}
              type="button"
            >
              <Eye size={14} />
              Summary
            </button>
            <button
              className={`segmented ${previewTab === "json" ? "active" : ""}`}
              onClick={() => setPreviewTab("json")}
              type="button"
            >
              <LockKeyhole size={14} />
              Raw JSON
            </button>
          </div>
          <pre className="code-viewer">
            {previewTab === "summary" ? previewLines.join("\n") : previewRaw}
          </pre>
        </div>
      </section>
    </>
  );
}
