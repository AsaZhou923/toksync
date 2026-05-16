"use client";

import { useState } from "react";
import { CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function DeviceAuthorizeForm() {
  const [userCode, setUserCode] = useState("");
  const [username, setUsername] = useState("demo");
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/v1/auth/device/authorize`, {
      method: "POST",
      body: JSON.stringify({ userCode, username }),
      headers: { "Content-Type": "application/json" },
    });
    setStatus(
      response.ok
        ? "Device authorized. Return to the CLI."
        : "Code not found or expired.",
    );
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
          value={userCode}
          onChange={(event) => setUserCode(event.target.value)}
          placeholder="TS-1234"
        />
      </label>
      <label className="form-grid">
        <span>Username</span>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <button className="btn primary" type="submit">
        <CheckCircle size={16} />
        Authorize
      </button>
      {status ? <p className="muted">{status}</p> : null}
    </form>
  );
}
