"use client";

import { useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";

export function LocalDataWorkbench({
  snapshot,
  csv,
  receiptDigest,
  syncHealthSummary,
}: {
  snapshot: string;
  csv: string;
  receiptDigest: string;
  syncHealthSummary: string[];
}) {
  const [tab, setTab] = useState<"json" | "csv" | "health" | "receipt">("json");
  const preview = useMemo(() => {
    switch (tab) {
      case "csv":
        return csv;
      case "health":
        return syncHealthSummary.join("\n");
      case "receipt":
        return `digest=${receiptDigest}\nshareable=true\nscope=aggregate-only`;
      case "json":
      default:
        return snapshot;
    }
  }, [csv, receiptDigest, snapshot, syncHealthSummary, tab]);

  function download(filename: string, contents: string, type: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="grid">
      <div className="toolbar">
        <button
          className={`segmented ${tab === "json" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("json")}
        >
          <FileJson size={14} />
          Local JSON viewer
        </button>
        <button
          className={`segmented ${tab === "csv" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("csv")}
        >
          <FileSpreadsheet size={14} />
          CSV export
        </button>
        <button
          className={`segmented ${tab === "health" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("health")}
        >
          <Eye size={14} />
          Sync health
        </button>
        <button
          className={`segmented ${tab === "receipt" ? "active" : ""}`}
          type="button"
          onClick={() => setTab("receipt")}
        >
          <ShieldCheck size={14} />
          Receipt digest
        </button>
      </div>
      <div className="toolbar">
        <button
          className="btn primary"
          type="button"
          onClick={() =>
            download(
              "toksync-local-snapshot.json",
              snapshot,
              "application/json",
            )
          }
        >
          <Download size={16} />
          Download JSON
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            download("toksync-usage-daily.csv", csv, "text/csv;charset=utf-8")
          }
        >
          <Download size={16} />
          Download CSV
        </button>
      </div>
      <pre className="code-viewer">{preview}</pre>
    </section>
  );
}
