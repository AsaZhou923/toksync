import fs from "node:fs/promises";
import type { BuiltInSourceId } from "@toksync/shared";

export interface SourceParseContext {
  source: BuiltInSourceId;
  file: string;
  deviceId: string;
  includeRawWorkspacePath: boolean;
  workspaceHashSecret?: string;
}

export interface JsonFileShape {
  root: unknown;
  records: unknown[];
  jsonl: boolean;
}

export async function readJsonFileShape(file: string): Promise<JsonFileShape> {
  const raw = await fs.readFile(file, "utf8");
  if (isJsonlFile(file)) {
    const records: unknown[] = [];
    for (const line of raw
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const parsed = safeJsonParseLine(line);
      if (parsed !== undefined) records.push(parsed);
    }
    return { root: records, records, jsonl: true };
  }
  const root = safeJsonParse(raw);
  const records = Array.isArray(root)
    ? root
    : isRecord(root) && Array.isArray(root.events)
      ? root.events
      : isRecord(root) && Array.isArray(root.messages)
        ? root.messages
        : [root];
  return { root, records, jsonl: false };
}

function isJsonlFile(file: string) {
  const lower = file.toLowerCase();
  return (
    lower.endsWith(".jsonl") ||
    lower.includes(".jsonl.deleted.") ||
    lower.includes(".jsonl.reset.")
  );
}

function safeJsonParse(raw: string) {
  return JSON.parse(raw, (key, value) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`Unsafe JSON key rejected: ${key}`);
    }
    return value;
  });
}

function safeJsonParseLine(raw: string) {
  try {
    return safeJsonParse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
