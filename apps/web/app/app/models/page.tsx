import { formatCompactNumber, formatUsd } from "@toksync/shared";
import { SortableTableHeader } from "../../../components/SortableTableHeader";
import {
  apiGet,
  type DashboardBreakdowns,
  type PricingModelsResponse,
} from "../../../lib/api";
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
  const pricing = await apiGet<PricingModelsResponse>("/v1/pricing/models");
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
      <section className="grid grid-2">
        <div className="card">
          <h2 className="section-title">Pricing lookup</h2>
          <div className="stack-list">
            <span>Costs are estimates, not provider billing truth.</span>
            <span>
              Unknown models stay at $
              {(pricing?.unknownModelsDefaultCostUsd ?? 0).toFixed(0)} until a
              first-party price source is added.
            </span>
            <span>
              Aliases normalize to canonical model IDs before estimates are
              calculated.
            </span>
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Unknown review queue</h2>
          <div className="stack-list">
            {(pricing?.models ?? []).filter((row) => !row.known).length ===
            0 ? (
              <span>
                No unknown pricing rows in the current private rollup.
              </span>
            ) : (
              (pricing?.models ?? [])
                .filter((row) => !row.known)
                .slice(0, 5)
                .map((row) => (
                  <span key={row.modelId}>
                    {row.modelId} / {formatCompactNumber(row.tokens)} tokens
                  </span>
                ))
            )}
          </div>
        </div>
      </section>
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
              <th>Pricing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pricingRow = pricing?.models.find(
                (item) => item.modelId === row.key,
              );
              return (
                <tr key={row.key}>
                  <td>{row.key}</td>
                  <td>{formatCompactNumber(row.tokens)}</td>
                  <td>{formatUsd(row.costUsd)}</td>
                  <td>{row.messages}</td>
                  <td>
                    <div className="stack-list compact">
                      <span
                        className={`pill ${pricingRow?.known ? "good" : "warn"}`}
                      >
                        {pricingRow?.known ? "known" : "unknown"}
                      </span>
                      <span className="table-subtle">
                        {pricingRow?.canonicalModelId ?? "review required"}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
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
