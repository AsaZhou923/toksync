export const SOURCE_IDS = [
  "codex",
  "claude",
  "opencode",
  "cursor",
  "copilot",
  "gemini",
  "openclaw",
] as const;

export type BuiltInSourceId = (typeof SOURCE_IDS)[number];

export interface SourceDefinition {
  id: BuiltInSourceId;
  displayName: string;
  description: string;
  defaultRelativePaths: string[];
  patterns: string[];
}

export const SOURCE_REGISTRY: SourceDefinition[] = [
  {
    id: "codex",
    displayName: "Codex CLI",
    description: "OpenAI Codex CLI session JSONL metrics.",
    defaultRelativePaths: [".codex/sessions"],
    patterns: ["*.jsonl", "*.json"],
  },
  {
    id: "claude",
    displayName: "Claude Code",
    description: "Claude Code project transcript JSONL metrics.",
    defaultRelativePaths: [".claude/projects"],
    patterns: ["*.jsonl", "*.json"],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    description: "OpenCode usage exports and message JSON files.",
    defaultRelativePaths: [
      ".local/share/opencode/storage/message",
      "AppData/Roaming/opencode/storage/message",
      "Library/Application Support/opencode/storage/message",
      "Library/Application Support/opencode",
    ],
    patterns: ["*.json", "*.jsonl"],
  },
  {
    id: "cursor",
    displayName: "Cursor",
    description: "Cursor usage CSV cache synced from the Cursor usage API.",
    defaultRelativePaths: [".config/tokscale/cursor-cache"],
    patterns: ["usage*.csv"],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    description:
      "GitHub Copilot OpenTelemetry JSONL usage from local private logs.",
    defaultRelativePaths: [".copilot/otel"],
    patterns: ["*.jsonl"],
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    description: "Gemini CLI tmp chat JSON/JSONL session usage.",
    defaultRelativePaths: [".gemini/tmp"],
    patterns: ["*.json", "*.jsonl"],
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    description:
      "OpenClaw agent sessions.json indexes, transcript JSONL, and SDK usage logs.",
    defaultRelativePaths: [
      ".openclaw/agents",
      ".clawdbot",
      ".moltbot",
      ".moldbot",
    ],
    patterns: ["*.json", "*.jsonl"],
  },
];

export function getSourceDefinition(source: string) {
  return SOURCE_REGISTRY.find((item) => item.id === source);
}
