import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSourceSpecificUsageFile } from "./source-parsers";
import type { SourceParseContext } from "./source-parsers";

function parserContext(
  source: SourceParseContext["source"],
  file: string,
): SourceParseContext {
  return {
    source,
    file,
    deviceId: "device-1",
    includeRawWorkspacePath: false,
  };
}

function tempFile(source: string, name: string, body: string) {
  const dir = mkdtempSync(path.join(tmpdir(), `toksync-parser-${source}-`));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

describe("source-specific parsers", () => {
  it("parses Cursor CSV cache-write columns without double-counting input", async () => {
    const file = tempFile(
      "cursor",
      "usage.csv",
      [
        "Date,Cloud Agent ID,Automation ID,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Cost",
        "2026-04-09T18:02:13.576Z,cloud-1,auto-1,On-Demand,gpt-5.4,100,80,20,30,0.11",
      ].join("\n"),
    );

    const events = await parseSourceSpecificUsageFile(
      parserContext("cursor", file),
    );

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      source: "cursor",
      sourceMessageId: "cloud-1",
      modelId: "gpt-5.4",
      costUsd: 0.11,
      tokens: {
        input: 80,
        cacheRead: 20,
        cacheWrite: 20,
        output: 30,
      },
    });
  });

  it("parses Copilot OTEL records directly and drops prompt bodies", async () => {
    const file = tempFile(
      "copilot",
      "otel.jsonl",
      [
        {
          type: "span",
          traceId: "trace-1",
          spanId: "span-1",
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

    const events = await parseSourceSpecificUsageFile(
      parserContext("copilot", file),
    );

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      source: "copilot",
      sourceSessionId: "conv-private",
      sourceMessageId: "span-1",
      tokens: {
        input: 50,
        cacheRead: 10,
        output: 8,
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      "SECRET_PROMPT_SHOULD_NOT_UPLOAD",
    );
  });

  it("parses Gemini tmp chat records directly and drops message bodies", async () => {
    const file = tempFile(
      "gemini",
      "gemini-session.json",
      JSON.stringify({
        sessionId: "gemini-private-session",
        messages: [
          {
            type: "gemini",
            id: "turn-1",
            model: "gemini-2.5-pro",
            timestamp: "2026-04-10T10:00:00.000Z",
            tokens: {
              input: 120,
              cached: 20,
              output: 30,
              thoughts: 10,
              tool: 5,
              total: 165,
            },
            prompt: "SECRET_GEMINI_PROMPT_SHOULD_NOT_UPLOAD",
            response: "SECRET_GEMINI_RESPONSE_SHOULD_NOT_UPLOAD",
          },
        ],
      }),
    );

    const events = await parseSourceSpecificUsageFile(
      parserContext("gemini", file),
    );

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      source: "gemini",
      sourceSessionId: "gemini-private-session",
      sourceMessageId: "turn-1",
      modelId: "gemini-2.5-pro",
      providerId: "google",
      timestampMs: Date.parse("2026-04-10T10:00:00.000Z"),
      tokens: {
        input: 105,
        cacheRead: 20,
        cacheWrite: 0,
        output: 30,
        reasoning: 10,
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      "SECRET_GEMINI_PROMPT_SHOULD_NOT_UPLOAD",
    );
    expect(JSON.stringify(events)).not.toContain(
      "SECRET_GEMINI_RESPONSE_SHOULD_NOT_UPLOAD",
    );
  });

  it("parses OpenClaw transcript records directly and drops assistant text", async () => {
    const file = tempFile(
      "openclaw",
      "session-abc.jsonl",
      [
        {
          type: "model_change",
          modelId: "claude-3-5-sonnet",
          provider: "anthropic",
        },
        {
          type: "message",
          id: "assistant-1",
          message: {
            role: "assistant",
            timestamp: "2026-04-11T09:15:00.000Z",
            usage: {
              inputTokens: 200,
              outputTokens: 50,
              cacheRead: 25,
              cacheWrite: 5,
              reasoningTokens: 15,
              cost: { total: 0.07 },
            },
            content: "SECRET_OPENCLAW_ASSISTANT_TEXT_SHOULD_NOT_UPLOAD",
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const events = await parseSourceSpecificUsageFile(
      parserContext("openclaw", file),
    );

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      source: "openclaw",
      sourceSessionId: "session-abc",
      sourceMessageId: "assistant-1",
      modelId: "claude-3-5-sonnet",
      providerId: "anthropic",
      costUsd: 0.07,
      tokens: {
        input: 200,
        output: 50,
        cacheRead: 25,
        cacheWrite: 5,
        reasoning: 15,
      },
    });
    expect(JSON.stringify(events)).not.toContain(
      "SECRET_OPENCLAW_ASSISTANT_TEXT_SHOULD_NOT_UPLOAD",
    );
  });

  it("returns null for generic source files so the shared normalizer owns them", async () => {
    const file = tempFile("codex", "events.jsonl", "{}\n");

    await expect(
      parseSourceSpecificUsageFile(parserContext("codex", file)),
    ).resolves.toBeNull();
  });
});
