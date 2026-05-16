import { describe, expect, it } from "vitest";
import { estimateCostUsd, pricingForModel, roundUsd } from "./index";

describe("pricing helpers", () => {
  it("uses model-specific pricing with cache and reasoning tokens", () => {
    expect(
      estimateCostUsd("gpt-5.4", {
        input: 1_000_000,
        output: 100_000,
        cacheRead: 500_000,
        cacheWrite: 10_000,
        reasoning: 1_000,
      }),
    ).toBe(6.79);
  });

  it("falls back to default pricing for unknown models", () => {
    expect(pricingForModel("unknown-model")).toEqual(
      pricingForModel("opencode-default"),
    );
    expect(roundUsd(0.123456789)).toBe(0.123457);
  });
});
