export function totalTokens(tokens: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}) {
  return (
    tokens.input +
    tokens.output +
    tokens.cacheRead +
    tokens.cacheWrite +
    tokens.reasoning
  );
}

const UNAVAILABLE = "—";

export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return UNAVAILABLE;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatUsd(value: number) {
  if (!Number.isFinite(value)) return UNAVAILABLE;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function isoDateFromMs(timestampMs: number) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

// Calendar date in the runtime's local timezone, for UsageEventV1.localDate.
export function localDateFromMs(timestampMs: number) {
  const date = new Date(timestampMs);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username);
}
