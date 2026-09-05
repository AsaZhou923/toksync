"use client";

import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { clientApiFetch } from "../lib/client-api";

export function DeviceActions({
  deviceId,
  username,
}: {
  deviceId: string;
  username: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function call(path: string, method: "POST" | "DELETE") {
    if (pending) return;
    const confirmed =
      method === "DELETE"
        ? window.confirm(
            "Delete this device's private usage events and refresh aggregates?",
          )
        : window.confirm("Revoke this device from future syncs?");
    if (!confirmed) return;

    setPending(true);
    setStatus("Updating…");
    try {
      const response = await clientApiFetch(path, { method }, username);
      setStatus(
        response.ok
          ? "Updated. Refresh to see the latest totals."
          : "Request failed. Try again.",
      );
    } catch {
      setStatus("Request failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="toolbar">
      <button
        className="btn"
        disabled={pending}
        type="button"
        onClick={() => call(`/v1/devices/${deviceId}/revoke`, "POST")}
      >
        <RotateCcw size={16} />
        Revoke token
      </button>
      <button
        className="btn danger"
        disabled={pending}
        type="button"
        onClick={() => call(`/v1/devices/${deviceId}/data`, "DELETE")}
      >
        <Trash2 size={16} />
        Delete data
      </button>
      {status ? (
        <span className="pill" role="status">
          {status}
        </span>
      ) : null}
    </span>
  );
}
