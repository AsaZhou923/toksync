import { describe, expect, it } from "vitest";
import { estimateCostUsd, lookupModelPricing, pricingForModel } from "./index";

const oneMillionEach = {
  input: 1_000_000,
  output: 1_000_000,
  cacheRead: 1_000_000,
  cacheWrite: 1_000_000,
  reasoning: 0,
};

describe("Claude pricing", () => {
  // Base input, output, cache hit, and 5-minute cache write $/MTok from
  // https://platform.claude.com/docs/en/about-claude/pricing
  it.each([
    ["claude-fable-5-1", 10, 50, 0.25, 12.5],
    ["claude-mythos-5-1", 10, 50, 0.25, 12.5],
    ["claude-fable-5", 10, 50, 1, 12.5],
    ["claude-mythos-5", 10, 50, 1, 12.5],
    ["claude-opus-5-5", 4, 20, 0.2, 5],
    ["claude-opus-5", 5, 25, 0.5, 6.25],
    ["claude-opus-4-8", 5, 25, 0.5, 6.25],
    ["claude-opus-4-7", 5, 25, 0.5, 6.25],
    ["claude-opus-4-6", 5, 25, 0.5, 6.25],
    ["claude-opus-4-5-20251101", 5, 25, 0.5, 6.25],
    ["claude-opus-4-1-20250805", 15, 75, 1.5, 18.75],
    ["claude-opus-4-20250514", 15, 75, 1.5, 18.75],
    ["claude-sonnet-5-5", 2, 10, 0.1, 2.5],
    ["claude-sonnet-5", 2, 10, 0.2, 2.5],
    ["claude-sonnet-4-6", 3, 15, 0.3, 3.75],
    ["claude-sonnet-4-5-20250929", 3, 15, 0.3, 3.75],
    ["claude-sonnet-4-20250514", 3, 15, 0.3, 3.75],
    ["claude-haiku-5-5", 0.1, 0.5, 0.01, 0.125],
    ["claude-haiku-4-5-20251001", 1, 5, 0.1, 1.25],
    ["claude-3-5-haiku-20241022", 0.8, 4, 0.08, 1],
  ])(
    "prices %s from the official table",
    (modelId, input, output, cacheRead, cacheWrite) => {
      expect(pricingForModel(modelId)).toMatchObject({
        inputPerMillion: input,
        outputPerMillion: output,
        cacheReadPerMillion: cacheRead,
        cacheWritePerMillion: cacheWrite,
        source: "Anthropic Claude pricing",
      });
    },
  );

  it.each([
    ["claude-opus-4-5@20251101", "claude-opus-4.5"],
    ["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-sonnet-4.5"],
    ["anthropic/claude-sonnet-4.5", "claude-sonnet-4.5"],
    ["claude-sonnet-4-6[1m]", "claude-sonnet-4.6"],
    ["claude-4-6-sonnet", "claude-sonnet-4.6"],
    ["Claude-Opus-4-8", "claude-opus-4.8"],
  ])("normalizes provider model id %s", (modelId, canonicalModelId) => {
    expect(lookupModelPricing(modelId)).toMatchObject({
      canonicalModelId,
      known: true,
    });
  });

  it.each(["claude-3-5-sonnet-20241022", "claude-mythos-preview", "claude"])(
    "leaves %s without a price",
    (modelId) => {
      expect(lookupModelPricing(modelId).known).toBe(false);
      expect(estimateCostUsd(modelId, oneMillionEach)).toBe(0);
    },
  );

  it("uses the long-prompt Haiku 5.5 rates above 100,000 prompt tokens", () => {
    const usage = (input: number, cacheRead: number) => ({
      input,
      output: 1_000,
      cacheRead,
      cacheWrite: 0,
      reasoning: 0,
    });

    // 100,000 prompt tokens: base rates.
    expect(estimateCostUsd("claude-haiku-5-5", usage(40_000, 60_000))).toBe(
      0.0051,
    );
    // 100,001 prompt tokens, counting cache reads: long-prompt rates.
    expect(estimateCostUsd("claude-haiku-5-5", usage(40_001, 60_000))).toBe(
      0.025501,
    );
    // Other models have no prompt-length tier.
    expect(estimateCostUsd("claude-sonnet-4-6", usage(40_001, 60_000))).toBe(
      0.153003,
    );
  });
});
