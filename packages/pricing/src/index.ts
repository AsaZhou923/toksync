import type { TokenBreakdown } from "@toksync/shared";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  source: string;
  sourceUrl: string;
  note?: string;
}

const SOURCES = {
  openaiPricing: "https://openai.com/api/pricing/",
  openaiGpt53Codex:
    "https://developers.openai.com/api/docs/models/gpt-5.3-codex",
  openaiCodexRateCard:
    "https://help-lb.openai.com/en/articles/20001106-codex-rate-card",
  anthropicPricing: "https://platform.claude.com/docs/en/about-claude/pricing",
  deepseekPricing: "https://api-docs.deepseek.com/quick_start/pricing/",
  zaiPricing: "https://docs.z.ai/guides/overview/pricing",
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.5": {
    inputPerMillion: 5,
    outputPerMillion: 30,
    cacheReadPerMillion: 0.5,
    cacheWritePerMillion: 5,
    source: "OpenAI API pricing",
    sourceUrl: SOURCES.openaiPricing,
  },
  "gpt-5.4": {
    inputPerMillion: 2.5,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.25,
    cacheWritePerMillion: 2.5,
    source: "OpenAI API pricing",
    sourceUrl: SOURCES.openaiPricing,
  },
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    outputPerMillion: 4.5,
    cacheReadPerMillion: 0.075,
    cacheWritePerMillion: 0.75,
    source: "OpenAI API pricing",
    sourceUrl: SOURCES.openaiPricing,
  },
  "gpt-5.3-codex": {
    inputPerMillion: 1.75,
    outputPerMillion: 14,
    cacheReadPerMillion: 0.175,
    cacheWritePerMillion: 1.75,
    source: "OpenAI GPT-5.3-Codex model pricing",
    sourceUrl: SOURCES.openaiGpt53Codex,
    note: `codex-auto-review is mapped here because the OpenAI Codex rate card says code review uses GPT-5.3-Codex: ${SOURCES.openaiCodexRateCard}`,
  },
  "claude-sonnet-4.6": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
    source: "Anthropic Claude pricing",
    sourceUrl: SOURCES.anthropicPricing,
    note: "TokSync maps its single cacheWrite bucket to Anthropic's 5-minute cache write rate.",
  },
  "deepseek-v4-flash": {
    inputPerMillion: 0.14,
    outputPerMillion: 0.28,
    cacheReadPerMillion: 0.0028,
    cacheWritePerMillion: 0.14,
    source: "DeepSeek API pricing",
    sourceUrl: SOURCES.deepseekPricing,
  },
  "deepseek-v4-pro": {
    inputPerMillion: 0.435,
    outputPerMillion: 0.87,
    cacheReadPerMillion: 0.003625,
    cacheWritePerMillion: 0.435,
    source: "DeepSeek API pricing",
    sourceUrl: SOURCES.deepseekPricing,
    note: "Official page lists these DeepSeek-V4-Pro rates as a 75% promotion extended through 2026-05-31 15:59 UTC.",
  },
  "glm-5": {
    inputPerMillion: 1,
    outputPerMillion: 3.2,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 1,
    source: "Z.AI model pricing",
    sourceUrl: SOURCES.zaiPricing,
  },
};

const MODEL_ALIASES: Record<string, string> = {
  "codex-auto-review": "gpt-5.3-codex",
  "gpt-5.3-codex-spark": "gpt-5.3-codex",
  "gpt-5.4 mini": "gpt-5.4-mini",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "claude-4-6-sonnet": "claude-sonnet-4.6",
  "claude-sonnet-4.5": "claude-sonnet-4.6",
  "claude-sonnet-4-5": "claude-sonnet-4.6",
  "claude-sonnet-4": "claude-sonnet-4.6",
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-flash",
  "deepseek-v4-pro-thinking": "deepseek-v4-pro",
  "deepseek-v4-flash-thinking": "deepseek-v4-flash",
  "z-ai/glm-5": "glm-5",
  "zai/glm-5": "glm-5",
};

export function pricingForModel(modelId: string): ModelPricing | undefined {
  const key = canonicalModelId(modelId);
  return key ? MODEL_PRICING[key] : undefined;
}

export function estimateCostUsd(modelId: string, tokens: TokenBreakdown) {
  const pricing = pricingForModel(modelId);
  if (!pricing) return 0;

  return roundUsd(
    (tokens.input * pricing.inputPerMillion +
      tokens.output * pricing.outputPerMillion +
      tokens.cacheRead * pricing.cacheReadPerMillion +
      tokens.cacheWrite * pricing.cacheWritePerMillion +
      tokens.reasoning * pricing.outputPerMillion) /
      1_000_000,
  );
}

export function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function canonicalModelId(modelId: string) {
  const normalized = normalizeModelId(modelId);
  const providerStripped = stripProviderPrefix(normalized);
  const candidates = [
    normalized,
    providerStripped,
    stripSnapshotSuffix(normalized),
    stripSnapshotSuffix(providerStripped),
    stripParenthesizedReasoningTier(normalized),
    stripParenthesizedReasoningTier(providerStripped),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (MODEL_PRICING[candidate]) return candidate;
    const alias = MODEL_ALIASES[candidate];
    if (alias && MODEL_PRICING[alias]) return alias;
  }

  return undefined;
}

function normalizeModelId(modelId: string) {
  return modelId.trim().toLowerCase().replaceAll("_", "-");
}

function stripProviderPrefix(modelId: string) {
  const slashIndex = modelId.lastIndexOf("/");
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

function stripSnapshotSuffix(modelId: string) {
  return modelId.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function stripParenthesizedReasoningTier(modelId: string) {
  const match = /^(.*)\((minimal|low|medium|high|xhigh|auto|none)\)$/.exec(
    modelId,
  );
  return match?.[1];
}
