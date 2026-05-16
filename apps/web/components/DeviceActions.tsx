"use client";

import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function DeviceActions({
  deviceId,
  username,
}: {
  deviceId: string;
  username: string;
}) {
  const [status, setStatus] = useState<string | null>(null);

  async function call(path: string, method: "POST" | "DELETE") {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "X-TokSync-User": username },
    });
    setStatus(
      response.ok
        ? "Updated. Refresh to see the latest totals."
        : "Request failed.",
    );
  }

  return (
    <span className="toolbar">
      <button
        className="btn"
        type="button"
        onClick={() => call(`/v1/devices/${deviceId}/revoke`, "POST")}
      >
        <RotateCcw size={16} />
        Revoke
      </button>
      <button
        className="btn danger"
        type="button"
        onClick={() => call(`/v1/devices/${deviceId}/data`, "DELETE")}
      >
        <Trash2 size={16} />
        Delete data
      </button>
      {status ? <span className="pill">{status}</span> : null}
    </span>
  );
}
