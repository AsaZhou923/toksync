"use client";

import { useState } from "react";
import { KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { clientApiFetch } from "../lib/client-api";

export function ApiTokenCard({ username }: { username: string }) {
  const [tokens, setTokens] = useState<ApiTokenMetadata[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "checking" | "available" | "unavailable" | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Manage private API token metadata without exposing token material in the UI.",
  );
  const [tokenCount, setTokenCount] = useState(0);

  async function refreshTokens(options: RefreshTokenOptions = {}) {
    setStatus("checking");
    if (options.clearCopyOnce ?? true) setNewToken(null);
    try {
      const response = await clientApiFetch(
        "/v1/settings/tokens",
        { cache: "no-store" },
        username,
      );

      if (response.ok) {
        const payload = (await response.json()) as {
          tokens?: ApiTokenMetadata[];
        };
        const nextTokens = payload.tokens ?? [];
        setTokens(nextTokens);
        setTokenCount(nextTokens.length);
        setStatus("available");
        setMessage(
          options.message ??
            "Token metadata refreshed. Secret text is only available immediately after creation.",
        );
        return;
      }

      if (response.status === 404 || response.status === 501) {
        setStatus("unavailable");
        setMessage(
          "Current backend snapshot does not expose /v1/settings/tokens yet. The UI stays in fallback mode.",
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
      const response = await clientApiFetch(
        "/v1/settings/tokens",
        {
          method: "POST",
          body: JSON.stringify({ name: "Web-created sync token" }),
          headers: {
            "Content-Type": "application/json",
          },
        },
        username,
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as {
        token?: string;
        metadata?: ApiTokenMetadata;
      };
      setStatus("available");
      setNewToken(payload.token ?? null);
      await refreshTokens({
        clearCopyOnce: false,
        message: `Created token metadata ${payload.metadata?.id ?? "unknown"}. Copy the secret now; list refreshes will never return it again.`,
      });
    } catch {
      setStatus("error");
      setMessage("Token creation failed.");
    }
  }

  async function revokeToken(tokenId: string) {
    const confirmed = window.confirm(
      "Revoke this user API token? Future syncs using it will fail; existing private metrics stay unchanged.",
    );
    if (!confirmed) return;

    setStatus("checking");
    setNewToken(null);
    try {
      const response = await clientApiFetch(
        `/v1/settings/tokens/${tokenId}`,
        { method: "DELETE" },
        username,
      );
      if (!response.ok) throw new Error(String(response.status));
      setStatus("available");
      setMessage("Token revoked. Existing private metrics are unchanged.");
      await refreshTokens();
    } catch {
      setStatus("error");
      setMessage("Token revoke failed.");
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
      {newToken ? (
        <div className="notice-strip good">
          <strong>Copy-once token:</strong> <code>{newToken}</code>
        </div>
      ) : null}
      <div className="stack-list">
        {tokens.length === 0 ? (
          <span>No token metadata loaded yet.</span>
        ) : (
          tokens.map((token) => (
            <span key={token.id}>
              {token.name} / last used {token.lastUsedAt ?? "never"} /{" "}
              {token.revokedAt ? "revoked" : "active"}{" "}
              {!token.revokedAt ? (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => revokeToken(token.id)}
                >
                  revoke
                </button>
              ) : null}
            </span>
          ))
        )}
      </div>
      <div className="toolbar">
        <button className="btn primary" type="button" onClick={createToken}>
          <KeyRound size={16} />
          Create metadata
        </button>
        <button className="btn" type="button" onClick={() => refreshTokens()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
    </div>
  );
}

interface ApiTokenMetadata {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

interface RefreshTokenOptions {
  clearCopyOnce?: boolean;
  message?: string;
}
