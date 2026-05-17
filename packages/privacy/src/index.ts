import { createHash, createHmac } from "node:crypto";
import path from "node:path";

const DEV_WORKSPACE_HASH_SECRET = "dev-workspace-hash-change-me";

export function hashWorkspacePath(
  workspacePath: string,
  secret = defaultWorkspaceHashSecret(),
) {
  const normalized = workspacePath.replaceAll("\\", "/").trim().toLowerCase();
  const digest = createHmac("sha256", secret).update(normalized).digest("hex");
  return `sha256:${digest}`;
}

export function hashOpaqueValue(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function sha256Base64Url(value: string | Buffer) {
  return createHash("sha256").update(value).digest("base64url");
}

export function workspaceLabelFromPath(workspacePath: string) {
  const label = path.basename(workspacePath.replaceAll("\\", "/"));
  return sanitizeWorkspaceLabel(label);
}

export function sanitizeWorkspaceLabel(label: string) {
  return label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "workspace";
}

export const FORBIDDEN_CONTENT_KEYS = [
  "prompt",
  "systemPrompt",
  "userPrompt",
  "developerPrompt",
  "text",
  "content",
  "message",
  "messages",
  "response",
  "completion",
  "assistantResponse",
  "toolArguments",
  "toolArgs",
  "toolInput",
  "toolOutput",
  "fileContent",
  "filePath",
  "file_path",
  "filename",
  "diff",
  "patch",
  "error",
  "cwd",
  "path",
  "projectPath",
  "rawProjectPath",
];

export interface MetricsOnlyAssertOptions {
  forbiddenKeys?: string[];
}

export function assertMetricsOnlyPayload(
  payload: unknown,
  options: MetricsOnlyAssertOptions = {},
) {
  const forbiddenKeys = new Set(
    [...FORBIDDEN_CONTENT_KEYS, ...(options.forbiddenKeys ?? [])].map(
      normalizeKey,
    ),
  );
  const seen = new WeakSet<object>();

  function visit(value: unknown, keyPath: string[]) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }

    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (forbiddenKeys.has(normalizeKey(key))) {
        throw new Error(
          `Metrics-only payload contains forbidden field ${[...keyPath, key].join(".")}`,
        );
      }
      visit(child, [...keyPath, key]);
    }
  }

  visit(payload, []);
}

function defaultWorkspaceHashSecret() {
  const secret =
    process.env.TOKSYNC_WORKSPACE_HASH_SECRET ||
    process.env.DEVICE_FINGERPRINT_PEPPER;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "TOKSYNC_WORKSPACE_HASH_SECRET or DEVICE_FINGERPRINT_PEPPER must be set in production",
    );
  }
  return DEV_WORKSPACE_HASH_SECRET;
}

function normalizeKey(key: string) {
  return key.replace(/[\s_-]/g, "").toLowerCase();
}
