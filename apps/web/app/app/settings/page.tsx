import {
  apiGet,
  type AuthSessionResponse,
  type DashboardBreakdowns,
  type DashboardSummary,
  type DevicesResponse,
  type PublicProfileState,
  type SyncRunsResponse,
  type UsageDailyResponse,
  type VaultExportsResponse,
} from "../../../lib/api";
import { ApiTokenCard } from "../../../components/ApiTokenCard";
import { DeviceActions } from "../../../components/DeviceActions";
import { LocalDataWorkbench } from "../../../components/LocalDataWorkbench";
import { PublicProfileForm } from "../../../components/PublicProfileForm";
import { SubmittedDataDeletionCard } from "../../../components/SubmittedDataDeletionCard";
import { VaultConsole } from "../../../components/VaultConsole";
import { normalizeVaultExports } from "../../../lib/vault-ui";
import {
  compatRoute,
  firstSearchParam,
  type CompatSearchParams,
} from "../../../lib/compat-route";
import {
  buildPrivacyReceipt,
  formatSourceSummary,
  toDailyCsv,
} from "../../../lib/v02";

export const dynamic = "force-dynamic";

type SearchParams = CompatSearchParams;
type SettingsTab = "account" | "privacy" | "data" | "developer";
type DataView = "overview" | "exports" | "vault";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "account", label: "Account" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Data" },
  { id: "developer", label: "Developer" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const activeTab = resolveTab(firstSearchParam(params.tab));
  const activeDataView = resolveDataView(firstSearchParam(params.view));
  const profile = (await apiGet<PublicProfileState>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
    showWorkspaceBreakdown: false,
  };
  const devices = (await apiGet<DevicesResponse>("/v1/devices"))?.devices ?? [];
  const session = await apiGet<AuthSessionResponse>("/v1/auth/session");
  if (!session) {
    throw new Error("TokSync account session is required");
  }
  const username = session.user.username;
  const dataView =
    activeTab === "data" && activeDataView === "exports"
      ? await ExportView()
      : activeTab === "data" && activeDataView === "vault"
        ? await VaultView(username)
        : null;

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">account controls</p>
          <h1>Settings</h1>
          <p className="lede">
            Review account identity, privacy toggles, data deletion scope, and
            developer token metadata from separate settings groups.
          </p>
        </div>
      </header>

      <nav className="toolbar" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <a
            className={`segmented ${activeTab === tab.id ? "active" : ""}`}
            href={settingsTabHref(params, tab.id)}
            key={tab.id}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {activeTab === "account" ? (
        <section className="settings-section">
          <h2 className="section-title">Account</h2>
          <div className="card">
            <div className="metric-row">
              <div>
                <h2 className="section-title">Account session</h2>
                <p className="muted">
                  GitHub-linked accounts show provider metadata; local dev
                  sessions stay marked as development.
                </p>
              </div>
              <span className="pill good">
                {session?.user.authProvider ?? "development"}
              </span>
            </div>
            <div className="stack-list">
              <span>@{username}</span>
              <span>{session?.user.email ?? "No email on this session"}</span>
              <span>
                Public profile {profile.enabled ? "enabled" : "disabled"} /
                leaderboard{" "}
                {profile.leaderboardOptIn ? "opted in" : "not participating"}
              </span>
            </div>
          </div>
        </section>
      ) : null}
      {activeTab === "privacy" ? (
        <section className="settings-section">
          <h2 className="section-title">Privacy</h2>
          <PublicProfileForm
            initial={profile}
            username={username}
            viewPath={profile.url ?? `/u/${encodeURIComponent(username)}`}
          />
        </section>
      ) : null}
      {activeTab === "data" ? (
        <section className="settings-section">
          <h2 className="section-title">Data</h2>
          <nav className="toolbar" aria-label="Data views">
            <a
              className={`segmented ${activeDataView === "overview" ? "active" : ""}`}
              href="/app/settings?tab=data"
            >
              Overview
            </a>
            <a
              className={`segmented ${activeDataView === "exports" ? "active" : ""}`}
              href="/app/settings?tab=data&view=exports"
            >
              Export
            </a>
            <a
              className={`segmented ${activeDataView === "vault" ? "active" : ""}`}
              href="/app/settings?tab=data&view=vault"
            >
              Vault
            </a>
          </nav>
          <div className="grid grid-2">
            <div className="card">
              <div className="metric-row">
                <div>
                  <h2 className="section-title">Export and vault</h2>
                  <p className="muted">
                    Aggregate JSON/CSV export and encrypted metrics-only vault
                    are grouped under data controls.
                  </p>
                </div>
              </div>
              <div className="toolbar">
                <a className="btn" href="/app/settings?tab=data&view=exports">
                  Local viewer
                </a>
                <a className="btn" href="/app/settings?tab=data&view=vault">
                  Private Usage Vault
                </a>
              </div>
            </div>
            <SubmittedDataDeletionCard username={username} />
            <div className="card">
              <div className="metric-row">
                <div>
                  <h2 className="section-title">Device data deletion</h2>
                  <p className="muted">
                    Device-level revoke and data deletion are live. These
                    actions are separate from submitted public data deletion.
                  </p>
                </div>
                <span className="pill warn">device scoped</span>
              </div>
              <div className="device-stack">
                {devices.length === 0 ? (
                  <div className="empty-state">
                    No connected devices yet. Authorize a local agent before
                    testing deletion flows.
                  </div>
                ) : (
                  devices.map((device) => (
                    <div className="device-card" key={device.id}>
                      <div className="metric-row">
                        <div>
                          <strong>{device.name}</strong>
                          <div className="muted">
                            {device.platform} / {device.eventCount} events
                          </div>
                        </div>
                        <span className="pill">
                          {device.revokedAt ? "revoked" : "active"}
                        </span>
                      </div>
                      <DeviceActions deviceId={device.id} username={username} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          {dataView}
        </section>
      ) : null}
      {activeTab === "developer" ? (
        <section className="settings-section">
          <h2 className="section-title">Developer</h2>
          <ApiTokenCard username={username} />
        </section>
      ) : null}
    </div>
  );
}

async function ExportView() {
  const [summary, daily, breakdowns, syncRuns, publicProfile] =
    await Promise.all([
      apiGet<DashboardSummary>("/v1/dashboard/summary"),
      apiGet<UsageDailyResponse>("/v1/dashboard/usage-daily"),
      apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns"),
      apiGet<SyncRunsResponse>("/v1/sync-runs"),
      apiGet<PublicProfileState>("/v1/public-profile"),
    ]);
  const latestRun = syncRuns?.runs?.[0];
  const receipt = buildPrivacyReceipt({ summary, latestRun });
  const snapshot = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope: "aggregate-only local viewer",
      receiptDigest: receipt.digest,
      summary,
      daily,
      breakdowns,
      publicProfile: {
        enabled: publicProfile?.enabled ?? false,
        showCost: publicProfile?.showCost ?? false,
        showSourceBreakdown: publicProfile?.showSourceBreakdown ?? false,
        showModelBreakdown: publicProfile?.showModelBreakdown ?? false,
        showWorkspaceBreakdown: publicProfile?.showWorkspaceBreakdown ?? false,
      },
      latestRun: latestRun
        ? {
            clientRunId: latestRun.clientRunId,
            mode: latestRun.mode,
            status: latestRun.status,
            sourceSummary: latestRun.sourceSummary,
          }
        : null,
    },
    null,
    2,
  );
  const healthLines = [
    `latestRun=${latestRun?.clientRunId ?? "none"}`,
    `runStatus=${latestRun?.status ?? "idle"}`,
    `sourceSummary=${formatSourceSummary(latestRun?.sourceSummary)}`,
    `receiptDigest=${receipt.digest}`,
    `publicProfile=${publicProfile?.enabled ? "enabled" : "private"}`,
  ];

  return (
    <section className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Aggregate export</h2>
          <p className="muted">
            JSON/CSV export uses dashboard aggregates and sync metadata only.
          </p>
        </div>
        <span className="pill good">aggregate-only</span>
      </div>
      <LocalDataWorkbench
        snapshot={snapshot}
        csv={toDailyCsv(daily?.days ?? [])}
        receiptDigest={receipt.digest}
        syncHealthSummary={healthLines}
      />
    </section>
  );
}

async function VaultView(username: string) {
  const result = await loadVaultExports();

  return (
    <section className="card">
      <div className="metric-row">
        <div>
          <h2 className="section-title">Private Usage Vault</h2>
          <p className="muted">
            Encrypted metrics-only backup, artifact download, preview, and
            restore stay grouped under data controls.
          </p>
        </div>
        <span className="pill good">metrics-only</span>
      </div>
      <VaultConsole
        available={result.available}
        initialExports={result.exports}
        username={username}
      />
    </section>
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

function resolveTab(value: string | undefined): SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === value)
    ? (value as SettingsTab)
    : "account";
}

function resolveDataView(value: string | undefined): DataView {
  return value === "exports" || value === "vault" ? value : "overview";
}

function settingsTabHref(params: SearchParams, tab: SettingsTab) {
  return compatRoute("/app/settings", params, { tab }, { omitKeys: ["view"] });
}
