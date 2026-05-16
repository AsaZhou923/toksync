import { describe, expect, it } from "vitest";
import { estimateCostUsd, pricingForModel, roundUsd } from "./index";

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
    expect(pricingForModel("openai/gpt-5.3-codex")).toEqual(
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
});
