export const SOURCE_IDS = ["codex", "claude", "opencode"] as const;

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
    ],
    patterns: ["*.json", "*.jsonl"],
  },
];

export function getSourceDefinition(source: string) {
  return SOURCE_REGISTRY.find((item) => item.id === source);
}
