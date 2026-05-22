import path from "node:path";
import {
  clampTokens,
  parseTimestamp,
  tokenTotal,
  usageEventFromCandidate,
} from "./candidate";
import {
  inferProvider,
  numberValue,
  optionalString,
  type SourceParseContext,
} from "./shared";

export function parseCursorCsv(raw: string, ctx: SourceParseContext) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines.shift();
  if (!header) return [];

  const headers = parseCsvLine(header).map((value) =>
    value.trim().replace(/^"|"$/g, ""),
  );
  if (!headers.includes("Date") || !headers.includes("Model")) return [];

  const index = (name: string) => headers.findIndex((item) => item === name);
  const dateIndex = index("Date");
  const modelIndex = index("Model");
  const inputWithCacheIndex = index("Input (w/ Cache Write)");
  const inputWithoutCacheIndex = index("Input (w/o Cache Write)");
  const cacheReadIndex = index("Cache Read");
  const outputIndex = index("Output Tokens");
  const costIndex = index("Cost");
  const cloudAgentIndex = index("Cloud Agent ID");
  const automationIndex = index("Automation ID");
  const kindIndex = index("Kind");
  if (
    [
      dateIndex,
      modelIndex,
      inputWithCacheIndex,
      inputWithoutCacheIndex,
      cacheReadIndex,
      outputIndex,
    ].some((item) => item < 0)
  ) {
    return [];
  }

  const accountId = cursorAccountIdFromPath(ctx.file);
  return lines
    .map((line, lineIndex) => {
      const fields = parseCsvLine(line).map((value) =>
        value.trim().replace(/^"|"$/g, ""),
      );
      const date = fields[dateIndex] ?? "";
      const modelId = fields[modelIndex] ?? "";
      const timestampMs = parseTimestamp(date);
      if (!date || !modelId || timestampMs === undefined) return null;

      const inputWithCache = numberValue(fields[inputWithCacheIndex]) ?? 0;
      const inputWithoutCache =
        numberValue(fields[inputWithoutCacheIndex]) ?? 0;
      const cacheRead = numberValue(fields[cacheReadIndex]) ?? 0;
      const output = numberValue(fields[outputIndex]) ?? 0;
      const costUsd =
        costIndex >= 0 ? parseCursorCost(fields[costIndex] ?? "") : undefined;
      const sourceMessageId =
        optionalString(fields[cloudAgentIndex], fields[automationIndex]) ??
        `${date}:${modelId}:${lineIndex + 1}`;
      const tokens = clampTokens({
        input: inputWithoutCache,
        output,
        cacheRead,
        cacheWrite: Math.max(inputWithCache - inputWithoutCache, 0),
        reasoning: 0,
      });
      if (tokenTotal(tokens) <= 0) return null;
      return usageEventFromCandidate(ctx, {
        sourceSessionId: `cursor-${accountId}`,
        sourceMessageId,
        modelId,
        providerId: inferProvider(modelId, "cursor"),
        timestampMs,
        tokens,
        costUsd,
        agent: optionalString(fields[kindIndex]),
      });
    })
    .filter((event): event is ReturnType<typeof usageEventFromCandidate> =>
      Boolean(event),
    );
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function cursorAccountIdFromPath(file: string) {
  const name = path.basename(file);
  if (name === "usage.csv") return "active";
  const matched = /^usage\.(.+)\.csv$/i.exec(name);
  return matched?.[1]?.replace(/[^A-Za-z0-9._-]/g, "-") || "unknown";
}

function parseCursorCost(value: string) {
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (
    !cleaned ||
    cleaned === "-" ||
    /^included$/i.test(cleaned) ||
    /^nan$/i.test(cleaned)
  ) {
    return 0;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
