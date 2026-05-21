import { describe, expect, it } from "vitest";
import { SOURCE_IDS, SOURCE_REGISTRY } from "./source-registry";

describe("SOURCE_REGISTRY", () => {
  it("locks v0.4 source parity to real local formats", () => {
    const byId = new Map(SOURCE_REGISTRY.map((source) => [source.id, source]));

    expect(SOURCE_REGISTRY.map((source) => source.id)).toEqual([...SOURCE_IDS]);
    expect(byId.get("cursor")).toMatchObject({
      defaultRelativePaths: [".config/tokscale/cursor-cache"],
      patterns: ["usage*.csv"],
    });
    expect(byId.get("copilot")).toMatchObject({
      defaultRelativePaths: [".copilot/otel"],
      patterns: ["*.jsonl"],
    });
    expect(byId.get("gemini")).toMatchObject({
      defaultRelativePaths: [".gemini/tmp"],
      patterns: ["*.json", "*.jsonl"],
    });
    expect(byId.get("openclaw")).toMatchObject({
      defaultRelativePaths: [
        ".openclaw/agents",
        ".clawdbot",
        ".moltbot",
        ".moldbot",
      ],
      patterns: ["*.json", "*.jsonl"],
    });
  });
});
