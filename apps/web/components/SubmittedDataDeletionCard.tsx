"use client";

import { useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { clientApiFetch } from "../lib/client-api";

export function SubmittedDataDeletionCard({ username }: { username: string }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "deleting" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState(
    "Deletes submitted public data only. Private metrics, device data, and vault exports stay outside this scope.",
  );

  async function deleteSubmittedData() {
    if (!acknowledged) {
      setMessage("Confirm the submitted-data scope before deleting.");
      return;
    }

    setStatus("deleting");
    try {
      const response = await clientApiFetch(
        "/v1/settings/submitted-data",
        { method: "DELETE" },
        username,
      );
      if (!response.ok) throw new Error(String(response.status));
      setStatus("done");
      setMessage(
        "Submitted public data cleared. Private metrics and device data are unchanged.",
      );
    } catch {
      setStatus("error");
      setMessage("Submitted-data deletion failed.");
    }
  }

  return (
    <div className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Submitted public data</h2>
          <p className="muted">
            Separate from device deletion and private vault recovery data.
          </p>
        </div>
        <span className={status === "error" ? "pill stop" : "pill warn"}>
          {status}
        </span>
      </div>
      <div className="notice-strip warn">
        <ShieldAlert size={16} />
        <span>{message}</span>
      </div>
      <label className="switch-line">
        <span>I understand this clears submitted public data only.</span>
        <input
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          type="checkbox"
        />
      </label>
      <button
        className="btn danger"
        disabled={!acknowledged || status === "deleting"}
        onClick={deleteSubmittedData}
        type="button"
      >
        <Trash2 size={16} />
        Delete submitted data
      </button>
    </div>
  );
}
