"use client";

import { useState } from "react";
import { Eye, RefreshCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export interface PublicProfileState {
  enabled: boolean;
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  showWorkspaceBreakdown: boolean;
}

export function PublicProfileForm({
  initial,
  username,
  viewPath,
  onSaved,
}: {
  initial: PublicProfileState;
  username: string;
  viewPath?: string;
  onSaved?: (next: PublicProfileState) => void;
}) {
  const [state, setState] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function save(next = state) {
    const response = await fetch(`${API_URL}/v1/public-profile`, {
      method: "POST",
      body: JSON.stringify(next),
      headers: {
        "Content-Type": "application/json",
        "X-TokSync-User": username,
      },
    });
    if (response.ok) {
      setMessage("Saved");
      onSaved?.(next);
    } else {
      setMessage("Save failed");
    }
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
      <label className="switch-line">
        <span>Show project labels</span>
        <input
          type="checkbox"
          checked={state.showWorkspaceBreakdown}
          onChange={(event) =>
            update("showWorkspaceBreakdown", event.target.checked)
          }
        />
      </label>
      <div className="toolbar">
        <button className="btn primary" type="button" onClick={() => save()}>
          <RefreshCw size={16} />
          Save
        </button>
        <a
          className="btn"
          href={viewPath ?? `/u/${encodeURIComponent(username)}`}
        >
          <Eye size={16} />
          View
        </a>
      </div>
      {message ? <span className="pill">{message}</span> : null}
    </div>
  );
}
