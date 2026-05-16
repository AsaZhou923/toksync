import { apiGet } from "../../../lib/api";
import { DeviceActions } from "../../../components/DeviceActions";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const data = await apiGet<any>("/v1/devices");
  const devices = data?.devices ?? [];
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">connected machines</p>
          <h1>Devices</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Platform</th>
              <th>Last seen</th>
              <th>Events</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device: any) => (
              <tr key={device.id}>
                <td>{device.name}</td>
                <td>{device.platform}</td>
                <td>
                  {device.lastSeenAt
                    ? new Date(device.lastSeenAt).toLocaleString()
                    : "never"}
                </td>
                <td>{device.eventCount}</td>
                <td>
                  <span className="pill">
                    <span
                      className={
                        device.revokedAt ? "status-dot off" : "status-dot"
                      }
                    />
                    {device.revokedAt ? "revoked" : "active"}
                  </span>
                </td>
                <td>
                  <DeviceActions deviceId={device.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
