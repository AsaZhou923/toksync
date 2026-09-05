"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const DEV_AUTH_ENABLED = /^(1|true|yes)$/i.test(
  process.env.NEXT_PUBLIC_TOKSYNC_DEV_AUTH || "",
);
const DEV_AUTH_USER = process.env.NEXT_PUBLIC_TOKSYNC_DEV_USER || "demo";

type SubmitStatus =
  | { tone: "success"; message: string; nextStep: string }
  | { tone: "warning"; message: string; nextStep: string }
  | { tone: "error"; message: string; nextStep: string };

export function DeviceAuthorizeForm() {
  const [userCode, setUserCode] = useState("");
  const [username, setUsername] = useState(DEV_AUTH_USER);
  const [status, setStatus] = useState<SubmitStatus | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const body: { userCode: string; username?: string } = {
      userCode: userCode.trim(),
    };
    if (DEV_AUTH_ENABLED) body.username = username.trim();

    setPending(true);
    setStatus({
      tone: "warning",
      message: "Authorizing device...",
      nextStep: "Keep this page open.",
    });
    try {
      const response = await fetch(`${API_URL}/v1/auth/device/authorize`, {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        setStatus({
          tone: "success",
          message: "Device authorized.",
          nextStep: "Return to the CLI; login will finish automatically.",
        });
        return;
      }
      if (response.status === 401) {
        setStatus({
          tone: "error",
          message: "Sign-in required.",
          nextStep: "Sign in with GitHub, then authorize this code again.",
        });
        return;
      }
      setStatus({
        tone: "warning",
        message: "Device code expired or was not found.",
        nextStep: "Run pnpm agent login again for a fresh code.",
      });
    } catch {
      setStatus({
        tone: "error",
        message: "Authorization failed.",
        nextStep: "Check your connection and try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <div className="metric-row">
        <h2 className="section-title">Device code</h2>
        <span className="pill">
          <span className="status-dot warn" />
          pending
        </span>
      </div>
      <label className="form-grid">
        <span>User code</span>
        <input
          className="input"
          disabled={pending}
          value={userCode}
          onChange={(event) => setUserCode(event.target.value)}
          placeholder="TS-1234"
        />
      </label>
      {DEV_AUTH_ENABLED ? (
        <label className="form-grid">
          <span>Development username</span>
          <input
            className="input"
            disabled={pending}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
      ) : null}
      <button className="btn primary" type="submit" disabled={pending}>
        <CheckCircle size={16} />
        {pending ? "Authorizing..." : "Authorize"}
      </button>
      {status ? (
        <p
          className={`pill ${
            status.tone === "success"
              ? "good"
              : status.tone === "error"
                ? "stop"
                : "warn"
          }`}
          role="status"
        >
          {status.message} {status.nextStep}
        </p>
      ) : null}
    </form>
  );
}
