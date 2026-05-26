import { describe, expect, it } from "vitest";
import {
  auditModelPricing,
  estimateCostUsd,
  lookupModelPricing,
  pricingForModel,
  roundUsd,
} from "./index";

describe("pricing helpers", () => {
  it("uses official OpenAI pricing with cache reads and output-priced reasoning", () => {
    expect(
      estimateCostUsd("gpt-5.4", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(4.165);
  });

  it("keeps cache write pricing separate when the provider publishes it", () => {
    expect(
      estimateCostUsd("claude-sonnet-4-6", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(4.7025);
  });

  it("prices provider aliases without charging unknown models by default", () => {
    expect(pricingForModel("openai/gpt-5.1-codex-mini")).toMatchObject({
      inputPerMillion: 0.25,
      outputPerMillion: 2,
      cacheReadPerMillion: 0.025,
      cacheWritePerMillion: 0.25,
    });
    expect(pricingForModel("codex-auto-review")).toMatchObject({
      inputPerMillion: 0.25,
      outputPerMillion: 2,
      cacheReadPerMillion: 0.025,
      cacheWritePerMillion: 0.25,
    });
    expect(pricingForModel("openai/gpt-5.3-codex")).not.toEqual(
      pricingForModel("codex-auto-review"),
    );
    expect(
      estimateCostUsd("unknown-model", {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        reasoning: 1_000_000,
      }),
    ).toBe(0);
  });

  it("prices observed Gemini models with cached input and output-priced reasoning", () => {
    expect(
      estimateCostUsd("gemini-3.1-pro-preview", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(3.332);
    expect(
      estimateCostUsd("gemini-3-flash-preview", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(0.833);
    expect(
      estimateCostUsd("gemini-2.5-pro", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(2.335);
  });

  it("uses the low-cost Codex mini rate for codex-auto-review logs", () => {
    expect(
      estimateCostUsd("codex-auto-review", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(0.467);
  });

  it("uses official cache-hit pricing for DeepSeek and Z.AI models", () => {
    expect(
      estimateCostUsd("deepseek-v4-pro", {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        reasoning: 0,
      }),
    ).toBe(1.743625);
    expect(
      estimateCostUsd("z-ai/glm-5", {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        reasoning: 0,
      }),
    ).toBe(5.4);
  });

  it("rounds USD values to six decimal places", () => {
    expect(roundUsd(0.123456789)).toBe(0.123457);
  });

  it("explains exact, alias and unknown pricing lookup results", () => {
    expect(lookupModelPricing("gpt-5.4")).toMatchObject({
      modelId: "gpt-5.4",
      normalizedModelId: "gpt-5.4",
      canonicalModelId: "gpt-5.4",
      known: true,
    });
    expect(
      lookupModelPricing("openai/gpt-5.1-codex-mini-latest"),
    ).toMatchObject({
      normalizedModelId: "openai/gpt-5.1-codex-mini-latest",
      canonicalModelId: "gpt-5.1-codex-mini",
      known: true,
    });
    expect(lookupModelPricing("mystery-model")).toMatchObject({
      normalizedModelId: "mystery-model",
      known: false,
      explanation: expect.stringContaining("estimated cost at $0"),
    });
  });

  it("builds an unknown-first pricing audit queue from model rollups", () => {
    expect(
      auditModelPricing([
        { modelId: "gpt-5.4", tokens: 1000, costUsd: 0.01 },
        { modelId: "mystery-model", tokens: 900, costUsd: 0 },
        { modelId: "other-mystery", tokens: 1200, costUsd: 0 },
      ]).map((row) => ({
        modelId: row.modelId,
        known: row.known,
        tokens: row.tokens,
      })),
    ).toEqual([
      { modelId: "other-mystery", known: false, tokens: 1200 },
      { modelId: "mystery-model", known: false, tokens: 900 },
      { modelId: "gpt-5.4", known: true, tokens: 1000 },
    ]);
  });
});
