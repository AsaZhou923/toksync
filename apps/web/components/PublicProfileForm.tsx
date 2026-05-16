"use client";

import { useState } from "react";
import { Eye, RefreshCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function PublicProfileForm({
  initial,
}: {
  initial: {
    enabled: boolean;
    showCost: boolean;
    showSourceBreakdown: boolean;
    showModelBreakdown: boolean;
  };
}) {
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function save(next = state) {
    const response = await fetch(`${API_URL}/v1/public-profile`, {
      method: "POST",
      body: JSON.stringify(next),
      headers: { "Content-Type": "application/json", "X-TokSync-User": "demo" },
    });
    setMessage(response.ok ? "Saved" : "Save failed");
  }

  function update(key: keyof typeof state, value: boolean) {
    const next = { ...state, [key]: value };
    setState(next);
    void save(next);
  }

  return (
    <div className="card form-grid">
      <div className="metric-row">
        <h2 className="section-title">Public cache</h2>
        <span className="pill">
          <span className={state.enabled ? "status-dot" : "status-dot off"} />
          {state.enabled ? "enabled" : "private"}
        </span>
      </div>
      <label className="switch-line">
        <span>Public profile</span>
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => update("enabled", event.target.checked)}
        />
      </label>
      <label className="switch-line">
        <span>Show cost</span>
        <input
          type="checkbox"
          checked={state.showCost}
          onChange={(event) => update("showCost", event.target.checked)}
        />
      </label>
      <label className="switch-line">
        <span>Show source breakdown</span>
        <input
          type="checkbox"
          checked={state.showSourceBreakdown}
          onChange={(event) =>
            update("showSourceBreakdown", event.target.checked)
          }
        />
      </label>
      <label className="switch-line">
        <span>Show model breakdown</span>
        <input
          type="checkbox"
          checked={state.showModelBreakdown}
          onChange={(event) =>
            update("showModelBreakdown", event.target.checked)
          }
        />
      </label>
      <div className="toolbar">
        <button className="btn primary" type="button" onClick={() => save()}>
          <RefreshCw size={16} />
          Save
        </button>
        <a className="btn" href="/u/demo">
          <Eye size={16} />
          View
        </a>
      </div>
      {message ? <span className="pill">{message}</span> : null}
    </div>
  );
}
