import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectUsageEvents, discoverSources, summarizeEvents } from "./index";

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
        costUsd: undefined,
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

  it("clamps Codex cache reads to input before subtracting inclusive cache tokens", async () => {
    const fixture = writeFixture("codex", [
      {
        timestamp: "2026-02-03T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-clamped-cache-session",
          cwd: "C:/Users/demo/project",
          model: "gpt-5.4",
          model_provider: "openai",
        },
      },
      {
        timestamp: "2026-02-03T00:01:00.000Z",
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 50,
              output_tokens: 30,
              cached_input_tokens: 100,
              reasoning_output_tokens: 5,
            },
          },
        },
      },
    ]);

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.tokens).toEqual({
      input: 0,
      output: 30,
      cacheRead: 50,
      cacheWrite: 0,
      reasoning: 5,
    });
    expect(summarizeEvents(result.events).tokens).toBe(85);
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

  it("discovers configured source roots and rejects unsafe JSON keys", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "toksync-codex-home-"));
    const sessions = path.join(codexHome, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "event.jsonl"), "{}\n");
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const locations = await discoverSources(["codex"]);
      expect(locations).toHaveLength(1);
      expect(locations[0]).toMatchObject({
        source: "codex",
        exists: true,
        fileCount: 1,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previous;
      }
    }

    const unsafe = writeFixture("codex", [
      '{"__proto__":{"polluted":true},"tokens":{"input":1,"output":1}}',
    ]);
    const result = await collectUsageEvents({
      deviceId: "device-1",
      fixture: unsafe,
    });
    expect(result.events).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/Unsafe JSON key/);
  });

  it("discovers a Copilot OTEL exporter file from the environment", async () => {
    const file = writeTextFixture("copilot", "otel.jsonl", "{}\n");
    const previous = process.env.COPILOT_OTEL_FILE_EXPORTER_PATH;
    process.env.COPILOT_OTEL_FILE_EXPORTER_PATH = file;
    try {
      const locations = await discoverSources(["copilot"]);
      expect(
        locations.find((location) => location.path === file),
      ).toMatchObject({
        source: "copilot",
        exists: true,
        fileCount: 1,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.COPILOT_OTEL_FILE_EXPORTER_PATH;
      } else {
        process.env.COPILOT_OTEL_FILE_EXPORTER_PATH = previous;
      }
    }
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

  it("infers source from path segments instead of arbitrary substrings", async () => {
    const fixture = writeFixture("notclaude", [
      {
        sourceSessionId: "session",
        sourceMessageId: "m1",
        modelId: "gpt-5.4",
        timestampMs: 1770000000000,
        tokens: { input: 1, output: 1 },
      },
    ]);
    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    expect(result.errors).toEqual([]);
    expect(result.events[0]?.source).toBe("codex");
  });

  it.each([
    ["cursor", "cursor"],
    ["copilot", "copilot"],
    ["gemini", "gemini"],
    ["openclaw", "openclaw"],
  ])("infers %s fixtures as %s", async (fixtureDir, expectedSource) => {
    const fixture = writeFixture(fixtureDir, [
      {
        sourceSessionId: `${expectedSource}-session`,
        sourceMessageId: "m1",
        modelId: "unknown-model",
        timestampMs: 1770000000000,
        tokens: { input: 1, output: 1 },
      },
    ]);
    const result = await collectUsageEvents({ deviceId: "device-1", fixture });

    expect(result.errors).toEqual([]);
    expect(result.events[0]?.source).toBe(expectedSource);
    expect(result.events[0]?.costUsd).toBeUndefined();
  });

  it("parses Cursor usage CSV without uploading private labels", async () => {
    const fixture = writeTextFixture(
      "cursor",
      "usage.csv",
      [
        "Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost",
        '"2026-04-09T18:02:13.576Z","cloud-secret","auto-private","On-Demand","gpt-5-codex","No","100","80","20","30","130","0.11"',
      ].join("\n"),
    );

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "cursor",
      sourceSessionId: "cursor-active",
      sourceMessageId: "cloud-secret",
      modelId: "gpt-5-codex",
      providerId: "openai",
      tokens: {
        input: 80,
        output: 30,
        cacheRead: 20,
        cacheWrite: 20,
        reasoning: 0,
      },
      costUsd: 0.11,
    });
    expect(serialized).not.toContain("private-client");
  });

  it("parses Copilot OTEL chat spans and suppresses lower-priority duplicate records", async () => {
    const fixture = writeTextFixture(
      "copilot",
      "otel.jsonl",
      [
        {
          type: "span",
          traceId: "trace-1",
          spanId: "agent-1",
          name: "invoke_agent GitHub Copilot Chat",
          endTime: [1775934270, 0],
          attributes: {
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.response.model": "gpt-5.4-mini",
            "gen_ai.conversation.id": "conv-private",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 30,
          },
        },
        {
          type: "span",
          traceId: "trace-1",
          spanId: "chat-1",
          name: "chat gpt-5.4-mini",
          endTime: [1775934264, 967317833],
          attributes: {
            "gen_ai.operation.name": "chat",
            "gen_ai.response.model": "gpt-5.4-mini",
            "gen_ai.conversation.id": "conv-private",
            "gen_ai.usage.input_tokens": 60,
            "gen_ai.usage.cache_read.input_tokens": 10,
            "gen_ai.usage.output_tokens": 8,
          },
          body: "SECRET_PROMPT_SHOULD_NOT_UPLOAD",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "copilot",
      sourceSessionId: "conv-private",
      sourceMessageId: "chat-1",
      dedupKey: "copilot:trace-1:chat-1",
      modelId: "gpt-5.4-mini",
      providerId: "openai",
      timestampMs: 1775934264967,
      tokens: {
        input: 50,
        output: 8,
        cacheRead: 10,
        cacheWrite: 0,
        reasoning: 0,
      },
    });
    expect(serialized).not.toContain("SECRET_PROMPT_SHOULD_NOT_UPLOAD");
  });

  it("parses Gemini CLI tmp chat JSONL and replaces duplicate message ids", async () => {
    const fixture = writeTextFixture(
      "gemini",
      "session-abc.jsonl",
      [
        {
          type: "init",
          model: "gemini-3.1-pro-preview",
          session_id: "gemini-session-1",
        },
        {
          type: "gemini",
          id: "msg-1",
          model: "gemini-3.1-pro-preview",
          timestamp: "2026-05-01T00:01:00.000Z",
          content: "SECRET_PROMPT_SHOULD_NOT_UPLOAD",
          tokens: {
            input: 10,
            output: 1,
            cached: 0,
            thoughts: 0,
            tool: 0,
            total: 11,
          },
        },
        {
          type: "gemini",
          id: "msg-1",
          model: "gemini-3.1-pro-preview",
          timestamp: "2026-05-01T00:02:00.000Z",
          tokens: {
            input: 20,
            output: 2,
            cached: 5,
            thoughts: 3,
            tool: 0,
            total: 25,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "gemini",
      sourceSessionId: "gemini-session-1",
      sourceMessageId: "msg-1",
      modelId: "gemini-3.1-pro-preview",
      providerId: "google",
      tokens: {
        input: 15,
        output: 2,
        cacheRead: 5,
        cacheWrite: 0,
        reasoning: 3,
      },
    });
    expect(serialized).not.toContain("SECRET_PROMPT_SHOULD_NOT_UPLOAD");
  });

  it("parses OpenClaw SDK run usage without uploading command text", async () => {
    const fixture = writeTextFixture(
      "openclaw",
      "session.jsonl",
      [
        {
          id: "event-1",
          event: "run.completed",
          ts: 1777000000000,
          data: {
            runId: "run-private",
            sessionId: "session-private",
            model: "claude-sonnet-4.5",
            workspace: { cwd: "C:/Users/alice/private-client/source" },
            usage: {
              input: 100,
              output: 20,
              cacheRead: 5,
              cacheWrite: 2,
              costUsd: 0.03,
            },
            output: { text: "SECRET_PROMPT_SHOULD_NOT_UPLOAD" },
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "openclaw",
      sourceSessionId: "session-private",
      sourceMessageId: "event-1",
      modelId: "claude-sonnet-4.5",
      providerId: "anthropic",
      workspaceLabel: "source",
      tokens: {
        input: 100,
        output: 20,
        cacheRead: 5,
        cacheWrite: 2,
        reasoning: 0,
      },
      costUsd: 0.03,
    });
    expect(result.events[0]?.workspaceKeyHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain("SECRET_PROMPT_SHOULD_NOT_UPLOAD");
    expect(serialized).not.toContain("private-client");
    expect(serialized).not.toContain("alice");
  });

  it("parses OpenClaw sessions.json indexes and transcript model state", async () => {
    const fixture = writeOpenClawIndexedFixture({
      "sessions.json": JSON.stringify({
        "agent:main:main": {
          sessionId: "indexed-session",
          sessionFile: "indexed-session.jsonl",
        },
      }),
      "indexed-session.jsonl": [
        {
          type: "model_change",
          id: "model-1",
          provider: "anthropic",
          modelId: "claude-opus-4-6",
        },
        {
          type: "message",
          id: "assistant-1",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "SECRET_PROMPT_SHOULD_NOT_UPLOAD" },
            ],
            usage: {
              input: 100,
              output: 50,
              cacheRead: 25,
              cacheWrite: 10,
              cost: { total: 0.05 },
            },
            timestamp: 1700000000000,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    });

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });
    const serialized = JSON.stringify(result.events);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "openclaw",
      sourceSessionId: "indexed-session",
      sourceMessageId: "assistant-1",
      modelId: "claude-opus-4-6",
      providerId: "anthropic",
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 25,
        cacheWrite: 10,
        reasoning: 0,
      },
      costUsd: 0.05,
    });
    expect(serialized).not.toContain("SECRET_PROMPT_SHOULD_NOT_UPLOAD");
  });

  it("parses OpenClaw standalone archived transcript filenames", async () => {
    const fixture = writeOpenClawIndexedFixture({
      "session-archived.jsonl.deleted.1700000000000": [
        {
          type: "custom",
          customType: "model-snapshot",
          data: {
            provider: "openai-codex",
            modelId: "gpt-5.3-codex",
          },
        },
        {
          type: "message",
          id: "assistant-2",
          message: {
            role: "assistant",
            usage: {
              input: 10,
              output: 5,
              cacheRead: 1,
              cacheWrite: 2,
            },
            timestamp: 1700000001000,
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    });

    const result = await collectUsageEvents({ deviceId: "device-1", fixture });

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "openclaw",
      sourceSessionId: "session-archived",
      modelId: "gpt-5.3-codex",
      providerId: "openai-codex",
      tokens: {
        input: 10,
        output: 5,
        cacheRead: 1,
        cacheWrite: 2,
        reasoning: 0,
      },
    });
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

function writeTextFixture(source: string, fileName: string, content: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `toksync-${source}-`));
  const fixture = path.join(dir, source, "case", "input");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(path.join(fixture, fileName), content);
  return path.dirname(fixture);
}

function writeOpenClawIndexedFixture(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "toksync-openclaw-"));
  const fixture = path.join(dir, "openclaw", "case", "input");
  mkdirSync(fixture, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    writeFileSync(path.join(fixture, fileName), content);
  }
  return path.dirname(fixture);
}
