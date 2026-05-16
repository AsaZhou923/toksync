import { apiGet } from "../../../lib/api";
import { PublicProfileForm } from "../../../components/PublicProfileForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = (await apiGet<any>("/v1/public-profile")) ?? {
    enabled: false,
    showCost: false,
    showSourceBreakdown: false,
    showModelBreakdown: false,
  };
  return (
    <div className="grid">
      <h1>Settings</h1>
      <PublicProfileForm initial={profile} />
    </div>
  );
}
