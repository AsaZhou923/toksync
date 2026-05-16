import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectUsageEvents, summarizeEvents } from "./index";

const root = path.resolve("packages/test-fixtures");

describe("collector-core fixtures", () => {
  it.each(["codex/basic", "claude/basic", "opencode/basic"])(
    "normalizes %s",
    async (fixture) => {
      const result = await collectUsageEvents({
        deviceId: "device-1",
        fixture: path.join(root, fixture),
      });

      expect(result.errors).toEqual([]);
      expect(result.events).toHaveLength(2);
      expect(result.events[0]?.workspaceKeyHash).toMatch(/^sha256:/);
      expect(JSON.stringify(result.events)).not.toContain(
        "SECRET_PROMPT_SHOULD_NOT_UPLOAD",
      );
      expect(summarizeEvents(result.events).tokens).toBeGreaterThan(0);
      expect(
        result.events.map((event) => ({
          source: event.source,
          sourceSessionId: event.sourceSessionId,
          sourceMessageId: event.sourceMessageId,
          dedupKey: event.dedupKey,
          timestampMs: event.timestampMs,
          tokens: event.tokens,
          modelId: event.modelId,
          providerId: event.providerId,
          costUsd: event.costUsd,
        })),
      ).toMatchSnapshot();
    },
  );

  it.each(["codex", "claude", "opencode"])(
    "covers minimal, missing model/provider and cache tokens for %s",
    async (source) => {
      const fixture = writeFixture(source, [
        {
          sessionId: `${source}-minimal`,
          messageId: "m1",
          timestampMs: 1770000000000,
          workspacePath: `C:/Users/demo/${source}`,
          tokens: { input: 1, output: 2 },
        },
        {
          sessionId: `${source}-fallback`,
          messageId: "m2",
          timestampMs: 1770000001000,
          workspacePath: `C:/Users/demo/${source}`,
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            cache_read_tokens: 4,
            cache_write_tokens: 3,
            reasoning_tokens: 2,
          },
        },
      ]);

      const result = await collectUsageEvents({
        deviceId: "device-1",
        fixture,
      });

      expect(result.errors).toEqual([]);
      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toMatchObject({
        source,
        modelId: "unknown-model",
        providerId: "unknown",
        tokens: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
      });
      expect(result.events[1]?.tokens).toEqual({
        input: 10,
        output: 5,
        cacheRead: 4,
        cacheWrite: 3,
        reasoning: 2,
      });
    },
  );

  it("normalizes current Codex token usage records without content fields", async () => {
    const fixture = writeFixture("codex", [
      {
        timestamp: "2026-02-03T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-real-session",
          cwd: "C:/Users/demo/private-client/source",
          model: "gpt-5.4",
          model_provider: "openai",
          user_instructions: "SECRET_PROMPT_SHOULD_NOT_UPLOAD",
        },
      },
      {
        timestamp: "2026-02-03T00:01:00.000Z",
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              output_tokens: 30,
              cached_input_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 155,
            },
          },
        },
      },
    ]);

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "codex",
      sourceSessionId: "codex-real-session",
      sourceMessageId: "2026-02-03T00:01:00.000Z",
      modelId: "gpt-5.4",
      providerId: "openai",
      timestampMs: 1770076860000,
      localDate: "2026-02-03",
      workspaceLabel: "source",
      tokens: {
        input: 80,
        output: 30,
        cacheRead: 20,
        cacheWrite: 0,
        reasoning: 5,
      },
    });
    expect(result.events[0]?.workspaceKeyHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain("SECRET_PROMPT_SHOULD_NOT_UPLOAD");
    expect(serialized).not.toContain("private-client");
  });

  it("normalizes current Claude message usage records without content fields", async () => {
    const fixture = writeFixture("claude", [
      {
        uuid: "claude-real-entry",
        sessionId: "claude-real-session",
        timestamp: "2026-02-04T10:00:00.000Z",
        cwd: "/home/demo/private-client/source",
        message: {
          id: "msg_123",
          model: "claude-3-5-sonnet",
          content: [
            {
              type: "tool_use",
              input: {
                file_path: "/home/demo/private-client/source/secret.ts",
              },
            },
          ],
          usage: {
            input_tokens: 200,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 40,
          },
        },
      },
    ]);

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "claude",
      sourceSessionId: "claude-real-session",
      sourceMessageId: "msg_123",
      modelId: "claude-3-5-sonnet",
      providerId: "anthropic",
      timestampMs: 1770199200000,
      localDate: "2026-02-04",
      workspaceLabel: "source",
      tokens: {
        input: 200,
        output: 50,
        cacheRead: 40,
        cacheWrite: 10,
        reasoning: 0,
      },
    });
    expect(result.events[0]?.workspaceKeyHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain("secret.ts");
    expect(serialized).not.toContain("private-client");
  });

  it("reports malformed files and skips partial records with no usage", async () => {
    const malformed = writeFixture("codex", ["{not-json"]);
    const partial = writeFixture("codex", [
      { sessionId: "partial", messageId: "p1", model: "gpt-5.4" },
    ]);

    const badResult = await collectUsageEvents({
      deviceId: "device-1",
      fixture: malformed,
    });
    const partialResult = await collectUsageEvents({
      deviceId: "device-1",
      fixture: partial,
    });

    expect(badResult.events).toEqual([]);
    expect(badResult.errors[0]?.message).toMatch(/JSON|Unexpected|Expected/);
    expect(partialResult.events).toEqual([]);
    expect(partialResult.errors).toEqual([]);
  });

  it("does not upload raw absolute workspace labels", async () => {
    const rawPath = "C:\\Users\\alice\\private-client\\source";
    const fixture = writeFixture("codex", [
      {
        sessionId: "absolute-label",
        messageId: "m1",
        timestampMs: 1770000000000,
        workspaceLabel: rawPath,
        tokens: { input: 1, output: 1 },
      },
    ]);

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events[0]?.workspaceLabel).toBe("source");
    expect(result.events[0]?.workspaceKeyHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain(rawPath);
    expect(serialized).not.toContain("alice");
    expect(serialized).not.toContain("private-client");
  });

  it("produces stable dedup keys for duplicate replay records and sorted output", async () => {
    const fixture = writeFixture("codex", [
      replayRecord("later", 1770000002000),
      replayRecord("same", 1770000001000),
      replayRecord("same", 1770000001000),
    ]);

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });

    expect(result.errors).toEqual([]);
    expect(result.events.map((event) => event.sourceMessageId)).toEqual([
      "same",
      "same",
      "later",
    ]);
    expect(result.events[0]?.dedupKey).toBe(result.events[1]?.dedupKey);
    expect(result.events[0]?.dedupKey).toMatch(/^codex:/);
  });
});

function replayRecord(messageId: string, timestampMs: number) {
  return {
    source: "codex",
    sourceSessionId: "replay-session",
    sourceMessageId: messageId,
    modelId: "gpt-5.4",
    providerId: "openai",
    timestampMs,
    workspacePath: "C:/Users/demo/replay",
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 1 },
  };
}

function writeFixture(
  source: string,
  records: Array<Record<string, unknown>> | string[],
) {
  const dir = mkdtempSync(path.join(tmpdir(), `toksync-${source}-`));
  const fixture = path.join(dir, source, "case", "input");
  mkdirSync(fixture, { recursive: true });
  const file = path.join(
    fixture,
    source === "opencode" ? "events.json" : "events.jsonl",
  );
  if (source === "opencode" && typeof records[0] !== "string") {
    writeFileSync(file, JSON.stringify({ events: records }, null, 2));
  } else {
    writeFileSync(
      file,
      records
        .map((record) =>
          typeof record === "string" ? record : JSON.stringify(record),
        )
        .join("\n"),
    );
  }
  return path.dirname(fixture);
}
