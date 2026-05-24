export type SortDirection = "asc" | "desc";

export type SortSearchParams = Record<string, string | string[] | undefined>;

export interface SortState<T extends string> {
  field: T;
  direction: SortDirection;
}

export async function resolveSearchParams(
  searchParams?: SortSearchParams | Promise<SortSearchParams>,
) {
  return (await searchParams) ?? {};
}

export function readSort<T extends string>(
  params: SortSearchParams,
  allowedFields: readonly T[],
  defaultField: T,
  defaultDirection: SortDirection,
): SortState<T> {
  const requestedField = firstParam(params.sort);
  const requestedDirection = firstParam(params.dir);
  const field = allowedFields.includes(requestedField as T)
    ? (requestedField as T)
    : defaultField;
  const direction =
    requestedDirection === "asc" || requestedDirection === "desc"
      ? requestedDirection
      : defaultDirection;

  return { field, direction };
}

export function sortMultiplier(direction: SortDirection) {
  return direction === "asc" ? 1 : -1;
}

export function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
