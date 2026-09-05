import type { Route } from "next";

export type CompatSearchParams = Record<string, string | string[] | undefined>;
export type CompatRouteOverrides = Record<string, string | undefined>;
export type CompatRouteOptions = {
  omitKeys?: readonly string[];
};

const DEFAULT_OMIT_KEYS = new Set(["next", "redirect", "returnto", "url"]);

export function firstSearchParam(
  value: CompatSearchParams[string],
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function compatRoute(
  pathname: string,
  params: CompatSearchParams,
  overrides: CompatRouteOverrides,
  options: CompatRouteOptions = {},
): Route {
  const query = new URLSearchParams();
  const omittedKeys = new Set([
    ...DEFAULT_OMIT_KEYS,
    ...(options.omitKeys ?? []).map((key) => key.toLowerCase()),
  ]);
  for (const [key, value] of Object.entries(params)) {
    if (omittedKeys.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value) {
      query.set(key, value);
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      query.delete(key);
    } else {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return (serialized ? `${pathname}?${serialized}` : pathname) as Route;
}
