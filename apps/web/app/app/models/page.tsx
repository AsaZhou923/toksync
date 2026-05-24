import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { SortableTableHeader } from "../../../components/SortableTableHeader";
import { apiGet, type DashboardBreakdowns } from "../../../lib/api";
import {
  compareText,
  readSort,
  resolveSearchParams,
  sortMultiplier,
  type SortSearchParams,
} from "../../../lib/sort";

export const dynamic = "force-dynamic";

const MODEL_SORT_FIELDS = ["model", "tokens", "cost", "messages"] as const;
type ModelSortField = (typeof MODEL_SORT_FIELDS)[number];

export default async function ModelsPage({
  searchParams,
}: {
  searchParams?: Promise<SortSearchParams>;
}) {
  const data = await apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns");
  const sort = readSort<ModelSortField>(
    await resolveSearchParams(searchParams),
    MODEL_SORT_FIELDS,
    "tokens",
    "desc",
  );
  const rows = [...(data?.models ?? [])].sort((left, right) =>
    compareBreakdownRows(left, right, sort),
  );

  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">provider mix</p>
          <h1>Models</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="model"
              >
                Model
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
                field="messages"
              >
                Messages
              </SortableTableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{formatCompactNumber(row.tokens)}</td>
                <td>{formatUsd(row.costUsd)}</td>
                <td>{row.messages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function compareBreakdownRows(
  left: { key: string; tokens: number; costUsd: number; messages: number },
  right: { key: string; tokens: number; costUsd: number; messages: number },
  sort: { field: ModelSortField; direction: "asc" | "desc" },
) {
  const multiplier = sortMultiplier(sort.direction);
  switch (sort.field) {
    case "model":
      return compareText(left.key, right.key) * multiplier;
    case "cost":
      return (left.costUsd - right.costUsd) * multiplier;
    case "messages":
      return (left.messages - right.messages) * multiplier;
    case "tokens":
    default:
      return (left.tokens - right.tokens) * multiplier;
  }
}
