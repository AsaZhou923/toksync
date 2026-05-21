export interface VaultExportRecord {
  id: string;
  status: string;
  format: string;
  createdAt?: string | undefined;
  expiresAt?: string | undefined;
  digest?: string | undefined;
  downloadUrl?: string | undefined;
  byteLength?: number | undefined;
  sourceCount?: number | undefined;
  eventCount?: number | undefined;
  receiptCount?: number | undefined;
  includesPublicCache: boolean;
  includesReceipts: boolean;
  includesContent: boolean;
  scope: string;
}

export function normalizeVaultExports(payload: unknown): VaultExportRecord[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const exports = Array.isArray((payload as { exports?: unknown[] }).exports)
    ? (payload as { exports: unknown[] }).exports
    : [];

  return exports.map((entry, index) => normalizeVaultExport(entry, index));
}

export function summarizeVaultPreview(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return ["Preview returned no structured payload."];
  }

  const record = payload as Record<string, unknown>;
  const lines: string[] = [];
  const compatible = pickBoolean(record, ["compatible", "isCompatible"]);
  if (compatible !== undefined) {
    lines.push(`compatible=${compatible ? "yes" : "no"}`);
  }

  const format = pickString(record, ["format", "schemaVersion", "version"]);
  if (format) {
    lines.push(`format=${format}`);
  }

  const digest = pickString(record, [
    "payloadDigest",
    "artifactDigest",
    "digest",
  ]);
  if (digest) {
    lines.push(`digest=${digest}`);
  }

  const eventCount = pickNumber(record, [
    "eventCount",
    "events",
    "restorableEventCount",
  ]);
  if (eventCount !== undefined) {
    lines.push(`events=${eventCount}`);
  }

  const importableEvents = pickNumber(record, [
    "importableEvents",
    "importedEvents",
  ]);
  if (importableEvents !== undefined) {
    lines.push(`importable=${importableEvents}`);
  }

  const duplicateEvents = pickNumber(record, ["duplicateEvents"]);
  if (duplicateEvents !== undefined) {
    lines.push(`duplicates=${duplicateEvents}`);
  }

  const deviceCount = pickNumber(record, ["deviceCount", "devices"]);
  if (deviceCount !== undefined) {
    lines.push(`devices=${deviceCount}`);
  }

  const receiptCount = pickNumber(record, ["receiptCount", "receipts"]);
  if (receiptCount !== undefined) {
    lines.push(`receipts=${receiptCount}`);
  }

  const warningCount = pickListCount(record, ["warnings", "issues"]);
  if (warningCount !== undefined) {
    lines.push(`warnings=${warningCount}`);
  }

  const blockingCount = pickListCount(record, ["blockingIssues", "errors"]);
  if (blockingCount !== undefined) {
    lines.push(`blocking=${blockingCount}`);
  }

  const includes = pickObject(record, ["includes"]);
  if (includes) {
    const scope = buildVaultScopeLabel({
      includesPublicCache:
        pickBoolean(includes, ["publicCache", "includePublicCache"]) ?? false,
      includesReceipts:
        pickBoolean(includes, ["receipts", "includeReceipts"]) ?? false,
      includesContent:
        pickBoolean(includes, ["includeContent", "content"]) ?? false,
    });
    lines.push(`scope=${scope}`);
  }

  const sourceSummary = pickObject(record, ["sourceSummary"]);
  if (sourceSummary) {
    const summary = Object.entries(sourceSummary)
      .filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      )
      .map(([source, count]) => `${source}:${count}`);
    if (summary.length > 0) {
      lines.push(`sources=${summary.join(",")}`);
    }
  }

  const totals = pickObject(record, ["totals"]);
  if (totals) {
    const totalTokens = pickNumber(totals, ["tokens"]);
    const totalCost = pickNumber(totals, ["costUsd"]);
    const totalMessages = pickNumber(totals, ["messageCount", "messages"]);
    const totalParts = [
      totalTokens !== undefined ? `${totalTokens} tokens` : null,
      totalCost !== undefined ? `$${totalCost.toFixed(4)}` : null,
      totalMessages !== undefined ? `${totalMessages} messages` : null,
    ].filter((part): part is string => Boolean(part));
    if (totalParts.length > 0) {
      lines.push(`totals=${totalParts.join(" / ")}`);
    }
  }

  const note = pickString(record, ["summary", "message", "detail"]);
  if (note) {
    lines.push(note);
  }

  return lines.length > 0
    ? lines
    : ["Preview returned JSON, but no standard summary fields were detected."];
}

function normalizeVaultExport(
  value: unknown,
  index: number,
): VaultExportRecord {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const includesPublicCache =
    pickBoolean(record, ["includesPublicCache", "includePublicCache"]) ?? false;
  const includesReceipts =
    pickBoolean(record, ["includesReceipts", "includeReceipts"]) ?? false;
  const includesContent =
    pickBoolean(record, ["includesContent", "includeContent"]) ?? false;
  const sources = Array.isArray(record.sources)
    ? record.sources.filter((item): item is string => typeof item === "string")
    : [];
  const sourceCount =
    pickNumber(record, ["sourceCount"]) ??
    (sources.length > 0 ? sources.length : undefined);

  return {
    id: pickString(record, ["id", "exportId"]) ?? `vault-export-${index + 1}`,
    status: pickString(record, ["status"]) ?? "ready",
    format:
      pickString(record, ["format", "schemaVersion"]) ?? "toksync-vault-v1",
    createdAt: pickString(record, ["createdAt", "updatedAt"]),
    expiresAt: pickString(record, ["expiresAt"]),
    digest: pickString(record, [
      "digest",
      "payloadDigest",
      "artifactDigest",
      "checksum",
    ]),
    downloadUrl: pickString(record, ["downloadUrl", "url"]),
    byteLength: pickNumber(record, [
      "byteLength",
      "artifactByteSize",
      "bytes",
      "sizeBytes",
    ]),
    sourceCount,
    eventCount: pickNumber(record, ["eventCount", "events", "usageEventCount"]),
    receiptCount: pickNumber(record, ["receiptCount", "receipts"]),
    includesPublicCache,
    includesReceipts,
    includesContent,
    scope:
      pickString(record, ["scope", "scopeLabel"]) ??
      buildVaultScopeLabel({
        includesPublicCache,
        includesReceipts,
        includesContent,
      }),
  };
}

function buildVaultScopeLabel({
  includesPublicCache,
  includesReceipts,
  includesContent,
}: {
  includesPublicCache: boolean;
  includesReceipts: boolean;
  includesContent: boolean;
}) {
  const scopes = ["metrics-only"];
  if (includesPublicCache) scopes.push("public-cache");
  if (includesReceipts) scopes.push("receipts");
  if (includesContent) scopes.push("content");
  return scopes.join(" / ");
}

function pickString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }
  return undefined;
}

function pickObject(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    if (
      typeof record[key] === "object" &&
      record[key] !== null &&
      !Array.isArray(record[key])
    ) {
      return record[key] as Record<string, unknown>;
    }
  }
  return undefined;
}

function pickBoolean(
  record: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key] as boolean;
    }
  }
  return undefined;
}

function pickNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) {
      return record[key] as number;
    }
  }
  return undefined;
}

function pickListCount(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key].length;
    }
  }
  return undefined;
}
