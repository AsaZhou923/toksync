import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  sanitizeWorkspaceLabel,
  workspaceLabelFromPath,
} from "@toksync/privacy";
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

export function safeJsonParse(raw: string) {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}

export function stringValue(...values: unknown[]) {
  return optionalString(...values) ?? "";
}

export function optionalString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

export function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return undefined;
}

export function timestampValue(...values: unknown[]) {
  for (const value of values) {
    const numeric = numberValue(value);
    if (numeric !== undefined) return numeric;
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function fileId(file: string) {
  return path.basename(file).replace(/\.[^.]+$/, "");
}

export function safeWorkspaceLabel(label: string) {
  return looksLikePath(label)
    ? workspaceLabelFromPath(label)
    : sanitizeWorkspaceLabel(label);
}

export function looksLikePath(value: string) {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    value.includes("\\") ||
    value.includes("/")
  );
}

export function inferProvider(modelId: string, fallback = "unknown") {
  const lower = modelId.toLowerCase();
  if (lower.includes("claude")) return "anthropic";
  if (lower.includes("gemini")) return "google";
  if (lower.includes("gpt") || lower.includes("o3") || lower.includes("o4")) {
    return "openai";
  }
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("llama") || lower.includes("meta")) return "meta";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral";
  if (lower.includes("cohere") || lower.includes("command-r")) return "cohere";
  if (lower.includes("qwen")) return "alibaba";
  return fallback;
}

export function usageDedupKey({
  source,
  sourceSessionId,
  sourceMessageId,
  timestampMs,
  modelId,
}: {
  source: string;
  sourceSessionId: string;
  sourceMessageId?: string | undefined;
  timestampMs: number;
  modelId: string;
}) {
  const seed = [
    source,
    sourceSessionId,
    sourceMessageId,
    timestampMs,
    modelId,
  ].join(":");
  return `${source}:${createHash("sha256").update(seed).digest("hex")}`;
}
