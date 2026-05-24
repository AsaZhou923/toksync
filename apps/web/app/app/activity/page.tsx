import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { SortableTableHeader } from "../../../components/SortableTableHeader";
import { apiGet, type UsageDailyResponse } from "../../../lib/api";
import {
  compareText,
  readSort,
  resolveSearchParams,
  sortMultiplier,
  type SortSearchParams,
} from "../../../lib/sort";

export const dynamic = "force-dynamic";

const ACTIVITY_SORT_FIELDS = ["date", "tokens", "cost", "breakdown"] as const;
type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number];

export default async function ActivityPage({
  searchParams,
}: {
  searchParams?: Promise<SortSearchParams>;
}) {
  const daily = await apiGet<UsageDailyResponse>("/v1/dashboard/usage-daily");
  const sort = readSort<ActivitySortField>(
    await resolveSearchParams(searchParams),
    ACTIVITY_SORT_FIELDS,
    "date",
    "desc",
  );
  const rows = (daily?.days ?? [])
    .map((day) => ({
      ...day,
      breakdownLabel: formatSourceBreakdown(day.sourceBreakdown),
    }))
    .sort((left, right) => compareActivityRows(left, right, sort));

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">usage over time</p>
          <h1>Activity</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="date"
              >
                Date
              </SortableTableHeader>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="tokens"
              >
                Tokens
              </SortableTableHeader>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="cost"
              >
                Cost
              </SortableTableHeader>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="breakdown"
              >
                Breakdown
              </SortableTableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{formatCompactNumber(day.tokens)}</td>
                <td>{formatUsd(day.costUsd)}</td>
                <td>{day.breakdownLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatSourceBreakdown(
  sourceBreakdown: Record<string, { tokens: number; costUsd: number }>,
) {
  return Object.entries(sourceBreakdown)
    .sort(([, left], [, right]) => right.tokens - left.tokens)
    .map(([source, value]) => `${source}: ${formatCompactNumber(value.tokens)}`)
    .join(" | ");
}

function compareActivityRows(
  left: {
    date: string;
    tokens: number;
    costUsd: number;
    breakdownLabel: string;
  },
  right: {
    date: string;
    tokens: number;
    costUsd: number;
    breakdownLabel: string;
  },
  sort: { field: ActivitySortField; direction: "asc" | "desc" },
) {
  const multiplier = sortMultiplier(sort.direction);
  switch (sort.field) {
    case "tokens":
      return (left.tokens - right.tokens) * multiplier;
    case "cost":
      return (left.costUsd - right.costUsd) * multiplier;
    case "breakdown":
      return (
        compareText(left.breakdownLabel, right.breakdownLabel) * multiplier
      );
    case "date":
    default:
      return compareText(left.date, right.date) * multiplier;
  }
}
