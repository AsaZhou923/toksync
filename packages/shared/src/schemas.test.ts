import { describe, expect, it } from "vitest";
import { totalTokens, usageBatchV1Schema, usageEventV1Schema } from "./index";

describe("UsageEventV1 schema", () => {
  it("accepts metrics-only usage events", () => {
    const event = usageEventV1Schema.parse({
      schemaVersion: 1,
      source: "codex",
      sourceSessionId: "session-1",
      dedupKey: "codex:session-1:message-1",
      deviceId: "device-1",
      modelId: "gpt-5.4",
      providerId: "openai",
      timestampMs: 1770000000000,
      localDate: "2026-02-03",
      tokens: {
        input: 100,
        output: 40,
        cacheRead: 5,
        cacheWrite: 2,
        reasoning: 10,
      },
      messageCount: 1,
    });

    expect(totalTokens(event.tokens)).toBe(157);
  });

  it("applies defaults and rejects non-metrics event shapes", () => {
    const event = usageEventV1Schema.parse({
      schemaVersion: 1,
      source: "claude",
      sourceSessionId: "session-2",
      dedupKey: "claude:session-2:message-1",
      deviceId: "device-1",
      modelId: "claude-3-5-sonnet",
      timestampMs: 1770000000000,
      localDate: "2026-02-03",
      tokens: {
        input: 1,
        output: 2,
      },
    });

    expect(event.tokens).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(event.messageCount).toBe(1);
    expect(
      usageEventV1Schema.safeParse({
        ...event,
        tokens: { input: -1, output: 2 },
      }).success,
    ).toBe(false);
  });

  it("validates the agent/API batch contract", () => {
    const parsed = usageBatchV1Schema.parse({
      schemaVersion: 1,
      runId: "run-1",
      device: {
        id: "device-1",
        name: "Laptop",
        platform: "windows",
        agentVersion: "0.1.0",
      },
      mode: "sync",
      events: [],
    });

    expect(parsed.sourceVersions).toEqual({});
    expect(
      usageBatchV1Schema.safeParse({
        ...parsed,
        device: { ...parsed.device, platform: "android" },
      }).success,
    ).toBe(false);
  });
});
