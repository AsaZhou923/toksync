import {
  apiGet,
  USER,
  type DevicesResponse,
  type PublicProfileState,
} from "../../../lib/api";
import { ApiTokenCard } from "../../../components/ApiTokenCard";
import { DeviceActions } from "../../../components/DeviceActions";
import { PublicProfileForm } from "../../../components/PublicProfileForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = (await apiGet<PublicProfileState>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
  };
  const devices = (await apiGet<DevicesResponse>("/v1/devices"))?.devices ?? [];

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">account controls</p>
          <h1>Settings</h1>
          <p className="lede">
            Keep public sharing opt-in, manage live device data deletion, and
            manage v0.2 API token metadata without exposing secrets.
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Privacy boundary</h2>
          <div className="stack-list">
            <span>Public profile is off by default.</span>
            <span>README embeds read from public aggregate cache only.</span>
            <span>
              No raw path, message text, tool args, or tool output enters this
              settings surface.
            </span>
          </div>
        </div>
        <ApiTokenCard username={USER} />
      </section>
      <section className="grid grid-2">
        <PublicProfileForm
          initial={profile}
          username={USER}
          viewPath={profile.url ?? `/u/${encodeURIComponent(USER)}`}
        />
        <div className="card">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Data deletion</h2>
              <p className="muted">
                Device-level revoke and data deletion are live. Account-wide
                submitted public data deletion is available through the token
                card control above.
              </p>
            </div>
            <span className="pill warn">device-first</span>
          </div>
          <div className="device-stack">
            {devices.length === 0 ? (
              <div className="empty-state">
                No connected devices yet. Authorize a local agent before testing
                deletion flows.
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
                  <DeviceActions deviceId={device.id} username={USER} />
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
