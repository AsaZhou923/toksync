"use client";

import { useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function ApiTokenCard({ username }: { username: string }) {
  const [status, setStatus] = useState<
    "idle" | "checking" | "available" | "unavailable" | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Manage private API token metadata without exposing token material in the UI.",
  );
  const [tokenCount, setTokenCount] = useState(0);

  async function refreshTokens() {
    setStatus("checking");
    try {
      const response = await fetch(`${API_URL}/v1/settings/tokens`, {
        cache: "no-store",
        headers: { "X-TokSync-User": username },
      });

      if (response.ok) {
        const payload = await response.json();
        setTokenCount(payload.tokens?.length ?? 0);
        return;
      }

      if (response.status === 404 || response.status === 501) {
        setStatus("unavailable");
        setMessage(
          "Current backend snapshot does not expose /v1/user-api-token yet. The UI stays in fallback mode.",
        );
        return;
      }

      setStatus("error");
      setMessage(`Token route returned ${response.status}.`);
    } catch {
      setStatus("error");
      setMessage(
        "Token metadata refresh failed. Check local API availability.",
      );
    }
  }

  async function createToken() {
    setStatus("checking");
    try {
      const response = await fetch(`${API_URL}/v1/settings/tokens`, {
        method: "POST",
        body: JSON.stringify({ name: "Web-created sync token" }),
        headers: {
          "Content-Type": "application/json",
          "X-TokSync-User": username,
        },
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json();
      setStatus("available");
      setMessage(
        `Created token metadata ${payload.metadata?.id ?? "unknown"}. Secret text is intentionally not rendered here.`,
      );
      await refreshTokens();
    } catch {
      setStatus("error");
      setMessage("Token creation failed.");
    }
  }

  async function deleteSubmittedData() {
    setStatus("checking");
    try {
      const response = await fetch(`${API_URL}/v1/settings/submitted-data`, {
        method: "DELETE",
        headers: { "X-TokSync-User": username },
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus("available");
      setMessage(
        "Public submitted data cache cleared; private metrics remain.",
      );
    } catch {
      setStatus("error");
      setMessage("Submitted-data deletion failed.");
    }
  }

  const pillClass =
    status === "available"
      ? "pill good"
      : status === "unavailable" || status === "error"
        ? "pill warn"
        : "pill";

  return (
    <div className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">User API token</h2>
          <p className="muted">
            v0.2 account control surface for headless private sync.
          </p>
        </div>
        <span className={pillClass}>{status}</span>
      </div>
      <div className="token-scope-grid">
        <div className="token-scope">
          <KeyRound size={18} />
          <div>
            <strong>Expected scopes</strong>
            <span>usage write, export read</span>
          </div>
        </div>
        <div className="token-scope">
          <ShieldAlert size={18} />
          <div>
            <strong>Storage rule</strong>
            <span>
              Show only status and scope metadata. Never echo the secret after
              creation.
            </span>
          </div>
        </div>
      </div>
      <p className="muted">
        {message} Active metadata rows: {tokenCount}
      </p>
      <div className="toolbar">
        <button className="btn primary" type="button" onClick={createToken}>
          <KeyRound size={16} />
          Create metadata
        </button>
        <button className="btn" type="button" onClick={refreshTokens}>
          <RefreshCw size={16} />
          Refresh
        </button>
        <button className="btn" type="button" onClick={deleteSubmittedData}>
          <Trash2 size={16} />
          Clear public submitted data
        </button>
      </div>
    </div>
  );
}
