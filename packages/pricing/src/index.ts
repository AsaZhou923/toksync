import type { TokenBreakdown } from "@toksync/shared";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  reasoningPerMillion: number;
}

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 1.25,
  outputPerMillion: 10,
  cacheReadPerMillion: 0.125,
  cacheWritePerMillion: 1.25,
  reasoningPerMillion: 10,
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": {
    inputPerMillion: 5,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 2.5,
    reasoningPerMillion: 15,
  },
  "claude-3-5-sonnet": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
    reasoningPerMillion: 15,
  },
  "opencode-default": DEFAULT_PRICING,
};

export function pricingForModel(modelId: string) {
  return MODEL_PRICING[modelId] ?? DEFAULT_PRICING;
}

export function estimateCostUsd(modelId: string, tokens: TokenBreakdown) {
  const pricing = pricingForModel(modelId);
  return roundUsd(
    (tokens.input * pricing.inputPerMillion +
      tokens.output * pricing.outputPerMillion +
      tokens.cacheRead * pricing.cacheReadPerMillion +
      tokens.cacheWrite * pricing.cacheWritePerMillion +
      tokens.reasoning * pricing.reasoningPerMillion) /
      1_000_000,
  );
}

export function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
