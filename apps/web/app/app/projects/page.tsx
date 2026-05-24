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

const PROJECT_SORT_FIELDS = ["project", "tokens", "cost", "messages"] as const;
type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<SortSearchParams>;
}) {
  const data = await apiGet<DashboardBreakdowns>("/v1/dashboard/breakdowns");
  const sort = readSort<ProjectSortField>(
    await resolveSearchParams(searchParams),
    PROJECT_SORT_FIELDS,
    "tokens",
    "desc",
  );
  const rows = [...(data?.workspaces ?? [])].sort((left, right) =>
    compareBreakdownRows(left, right, sort),
  );
  return <BreakdownTable rows={rows} sort={sort} title="Projects" />;
}

function BreakdownTable({
  title,
  rows,
  sort,
}: {
  title: string;
  rows: Array<{
    key: string;
    tokens: number;
    costUsd: number;
    messages: number;
  }>;
  sort: { field: ProjectSortField; direction: "asc" | "desc" };
}) {
  return (
    <div className="grid">
      <header className="page-head">
        <div>
          <p className="page-kicker">workspace labels</p>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <SortableTableHeader
                activeField={sort.field}
                direction={sort.direction}
                field="project"
              >
                Workspace label
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
  sort: { field: ProjectSortField; direction: "asc" | "desc" },
) {
  const multiplier = sortMultiplier(sort.direction);
  switch (sort.field) {
    case "project":
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
