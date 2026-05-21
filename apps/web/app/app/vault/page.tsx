import { Download, ShieldCheck } from "lucide-react";
import { USER, apiGet, type VaultExportsResponse } from "../../../lib/api";
import { VaultConsole } from "../../../components/VaultConsole";
import { normalizeVaultExports } from "../../../lib/vault-ui";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const result = await loadVaultExports();

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">private restore lane</p>
          <h1>Private Usage Vault</h1>
          <p className="lede">
            Create encrypted metrics-only vault exports, inspect backup ledger
            metadata, download portable artifacts, and restore private metrics
            with idempotent duplicate handling.
          </p>
        </div>
      </header>
      <div className="notice-strip good">
        <ShieldCheck size={16} />
        <span>
          Vault exports must stay metrics-only: no prompt text, assistant
          replies, tool output, raw paths, API secrets, or device tokens.
        </span>
      </div>
      <section className="grid grid-2">
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Private vault lane</h2>
              <p className="muted">
                Encrypted backup and restore for private metrics history,
                passphrase-protected artifacts, import preview, and idempotent
                recovery.
              </p>
            </div>
            <span className="pill good">v0.4</span>
          </div>
        </div>
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Local viewer lane</h2>
              <p className="muted">
                Aggregate-only JSON and CSV inspection lives in the lightweight
                export surface. It does not create encrypted artifacts or
                restore data.
              </p>
            </div>
            <a className="btn" href="/app/exports">
              <Download size={16} />
              Open local viewer
            </a>
          </div>
        </div>
      </section>
      <VaultConsole
        available={result.available}
        initialExports={result.exports}
        username={USER}
      />
    </div>
  );
}

async function loadVaultExports(): Promise<{
  available: boolean;
  exports: ReturnType<typeof normalizeVaultExports>;
}> {
  try {
    const payload = await apiGet<VaultExportsResponse>("/v1/vault/exports", {
      notFoundAsNull: false,
    });
    return { available: true, exports: normalizeVaultExports(payload) };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 404 || error.status === 501)
    ) {
      return { available: false, exports: [] };
    }
    throw error;
  }
}
