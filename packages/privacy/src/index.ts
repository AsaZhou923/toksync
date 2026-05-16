import { createHash, createHmac } from "node:crypto";
import path from "node:path";

export function hashWorkspacePath(
  workspacePath: string,
  secret = "toksync-workspace-v1",
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
  return label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "workspace";
}

export const FORBIDDEN_CONTENT_KEYS = [
  "prompt",
  "text",
  "content",
  "assistantResponse",
  "toolArguments",
  "toolOutput",
  "fileContent",
  "rawProjectPath",
];

export function assertMetricsOnlyPayload(payload: unknown) {
  const serialized = JSON.stringify(payload);
  for (const key of FORBIDDEN_CONTENT_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Metrics-only payload contains forbidden field ${key}`);
    }
  }
}
