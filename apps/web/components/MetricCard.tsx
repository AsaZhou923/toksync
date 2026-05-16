import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "green" | "cyan" | "amber" | "violet";
}) {
  return (
    <div className="card metric">
      <div className="metric-row">
        <span className="muted">{label}</span>
        <span className="metric-icon" data-tone={tone}>
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : <small>ready</small>}
    </div>
  );
}
