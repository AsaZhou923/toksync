"use client";

import { useState } from "react";
import { Eye, RotateCcw, Save } from "lucide-react";
import { clientApiFetch } from "../lib/client-api";

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
  variant = "full",
}: {
  initial: PublicProfileState;
  username: string;
  viewPath?: string;
  onSaved?: (next: PublicProfileState) => void;
  variant?: "full" | "profile-only";
}) {
  const [state, setState] = useState(initial);
  const [savedState, setSavedState] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = JSON.stringify(state) !== JSON.stringify(savedState);

  async function save() {
    if (pending) return;
    setPending(true);
    setMessage("Saving…");
    try {
      const response = await clientApiFetch(
        "/v1/public-profile",
        {
          method: "POST",
          body: JSON.stringify(state),
          headers: {
            "Content-Type": "application/json",
          },
        },
        username,
      );
      if (!response.ok) throw new Error(String(response.status));
      setSavedState(state);
      setMessage("Saved");
      onSaved?.(state);
    } catch {
      setMessage("Save failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  function update(key: keyof typeof state, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function cancel() {
    setState(savedState);
    setMessage("Changes discarded");
  }

  return (
    <div className="card form-grid">
      <div className="metric-row">
        <h2 className="section-title">
          {variant === "profile-only" ? "Public profile" : "Public cache"}
        </h2>
        <span className="pill">
          <span className={state.enabled ? "status-dot" : "status-dot off"} />
          {state.enabled ? "enabled" : "private"}
        </span>
      </div>
      <label className="switch-line">
        <span>Public profile</span>
        <input
          type="checkbox"
          disabled={pending}
          checked={state.enabled}
          onChange={(event) => update("enabled", event.target.checked)}
        />
      </label>
      {variant === "full" ? (
        <>
          <label className="switch-line">
            <span>Show cost</span>
            <input
              type="checkbox"
              disabled={pending}
              checked={state.showCost}
              onChange={(event) => update("showCost", event.target.checked)}
            />
          </label>
          <label className="switch-line">
            <span>Show source breakdown</span>
            <input
              type="checkbox"
              disabled={pending}
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
              disabled={pending}
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
              disabled={pending}
              checked={state.showWorkspaceBreakdown}
              onChange={(event) =>
                update("showWorkspaceBreakdown", event.target.checked)
              }
            />
          </label>
        </>
      ) : (
        <p className="muted">
          Public output uses aggregate metrics only. Cost and breakdown options
          stay in Settings.
        </p>
      )}
      <div className="toolbar">
        <button
          className="btn primary"
          type="button"
          disabled={!dirty || pending}
          onClick={save}
        >
          <Save size={16} />
          Save
        </button>
        <button
          className="btn"
          type="button"
          disabled={!dirty || pending}
          onClick={cancel}
        >
          <RotateCcw size={16} />
          Cancel
        </button>
        {variant === "full" ? (
          <a
            className="btn"
            href={viewPath ?? `/u/${encodeURIComponent(username)}`}
          >
            <Eye size={16} />
            View
          </a>
        ) : null}
      </div>
      {message ? (
        <span className="pill" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
