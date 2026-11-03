import type { TokenBreakdown } from "@toksync/shared";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  source: string;
  sourceUrl: string;
  note?: string;
  // Higher rates for a request whose prompt (input + cache read + cache write
  // tokens) exceeds the threshold.
  longPrompt?: {
    thresholdTokens: number;
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number;
    cacheWritePerMillion: number;
  };
}

export interface ModelPricingLookup {
  modelId: string;
  normalizedModelId: string;
  canonicalModelId?: string;
  known: boolean;
  pricing?: ModelPricing;
  explanation: string;
}

export interface ModelPricingAuditRow extends ModelPricingLookup {
  tokens: number;
  costUsd: number;
}

const SOURCES = {
  openaiPricing: "https://openai.com/api/pricing/",
  openaiGpt51CodexMini:
    "https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini",
  openaiGpt53Codex:
    "https://developers.openai.com/api/docs/models/gpt-5.3-codex",
  openaiCodexRateCard:
    "https://help-lb.openai.com/en/articles/20001106-codex-rate-card",
  googleGeminiPricing: "https://ai.google.dev/gemini-api/docs/pricing",
  anthropicPricing: "https://platform.claude.com/docs/en/about-claude/pricing",
  deepseekPricing: "https://api-docs.deepseek.com/quick_start/pricing/",
  zaiPricing: "https://docs.z.ai/guides/overview/pricing",
};

function anthropicPricing(
  inputPerMillion: number,
  outputPerMillion: number,
  cacheReadPerMillion: number,
  cacheWritePerMillion: number,
): ModelPricing {
  return {
    inputPerMillion,
    outputPerMillion,
    cacheReadPerMillion,
    cacheWritePerMillion,
    source: "Anthropic Claude pricing",
    sourceUrl: SOURCES.anthropicPricing,
    note: "TokSync maps its single cacheWrite bucket to Anthropic's 5-minute cache write rate.",
  };
}

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
  },
  "gpt-5.1-codex-mini": {
    inputPerMillion: 0.25,
    outputPerMillion: 2,
    cacheReadPerMillion: 0.025,
    cacheWritePerMillion: 0.25,
    source: "OpenAI GPT-5.1-Codex-mini model pricing",
    sourceUrl: SOURCES.openaiGpt51CodexMini,
  },
  "codex-auto-review": {
    inputPerMillion: 0.25,
    outputPerMillion: 2,
    cacheReadPerMillion: 0.025,
    cacheWritePerMillion: 0.25,
    source: "OpenAI GPT-5.1-Codex-mini model pricing",
    sourceUrl: SOURCES.openaiGpt51CodexMini,
    note: `codex-auto-review is a Codex synthetic model id observed in local usage logs; use the GPT-5.1-Codex-mini token rate instead of the GPT-5.3-Codex code-review credit card unless the source publishes a first-party codex-auto-review USD rate. Codex credit reference: ${SOURCES.openaiCodexRateCard}`,
  },
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2,
    outputPerMillion: 12,
    cacheReadPerMillion: 0.2,
    cacheWritePerMillion: 2,
    source: "Google Gemini Developer API pricing",
    sourceUrl: SOURCES.googleGeminiPricing,
    note: "Uses the Standard paid tier for prompts <= 200k tokens; larger prompts have higher rates that TokSync cannot infer from aggregate event data yet.",
  },
  "gemini-3-flash-preview": {
    inputPerMillion: 0.5,
    outputPerMillion: 3,
    cacheReadPerMillion: 0.05,
    cacheWritePerMillion: 0.5,
    source: "Google Gemini Developer API pricing",
    sourceUrl: SOURCES.googleGeminiPricing,
  },
  "gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
    cacheReadPerMillion: 0.125,
    cacheWritePerMillion: 1.25,
    source: "Google Gemini Developer API pricing",
    sourceUrl: SOURCES.googleGeminiPricing,
    note: "Uses the Standard paid tier for prompts <= 200k tokens; larger prompts have higher rates that TokSync cannot infer from aggregate event data yet.",
  },
  "claude-fable-5.1": anthropicPricing(10, 50, 0.25, 12.5),
  "claude-mythos-5.1": anthropicPricing(10, 50, 0.25, 12.5),
  "claude-fable-5": anthropicPricing(10, 50, 1, 12.5),
  "claude-mythos-5": anthropicPricing(10, 50, 1, 12.5),
  "claude-opus-5.5": anthropicPricing(4, 20, 0.2, 5),
  "claude-opus-5": anthropicPricing(5, 25, 0.5, 6.25),
  "claude-opus-4.8": anthropicPricing(5, 25, 0.5, 6.25),
  "claude-opus-4.7": anthropicPricing(5, 25, 0.5, 6.25),
  "claude-opus-4.6": anthropicPricing(5, 25, 0.5, 6.25),
  "claude-opus-4.5": anthropicPricing(5, 25, 0.5, 6.25),
  "claude-opus-4.1": anthropicPricing(15, 75, 1.5, 18.75),
  "claude-opus-4": anthropicPricing(15, 75, 1.5, 18.75),
  "claude-sonnet-5.5": anthropicPricing(2, 10, 0.1, 2.5),
  "claude-sonnet-5": anthropicPricing(2, 10, 0.2, 2.5),
  "claude-sonnet-4.6": anthropicPricing(3, 15, 0.3, 3.75),
  "claude-sonnet-4.5": anthropicPricing(3, 15, 0.3, 3.75),
  "claude-sonnet-4": anthropicPricing(3, 15, 0.3, 3.75),
  "claude-haiku-5.5": {
    ...anthropicPricing(0.1, 0.5, 0.01, 0.125),
    longPrompt: {
      thresholdTokens: 100_000,
      inputPerMillion: 0.5,
      outputPerMillion: 2.5,
      cacheReadPerMillion: 0.05,
      cacheWritePerMillion: 0.625,
    },
  },
  "claude-haiku-4.5": anthropicPricing(1, 5, 0.1, 1.25),
  "claude-haiku-3.5": anthropicPricing(0.8, 4, 0.08, 1),
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
  "gpt-5.3-codex-spark": "gpt-5.3-codex",
  "gpt-5.1-codex-mini-latest": "gpt-5.1-codex-mini",
  "gpt-5.4 mini": "gpt-5.4-mini",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "gemini-3.1-pro-preview-customtools": "gemini-3.1-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-flash",
  "deepseek-v4-pro-thinking": "deepseek-v4-pro",
  "deepseek-v4-flash-thinking": "deepseek-v4-flash",
  "z-ai/glm-5": "glm-5",
  "zai/glm-5": "glm-5",
};

const pricingCache = new Map<string, ModelPricing | undefined>();

export function pricingForModel(modelId: string): ModelPricing | undefined {
  if (pricingCache.has(modelId)) return pricingCache.get(modelId);
  const key = canonicalModelId(modelId);
  const pricing = key ? MODEL_PRICING[key] : undefined;
  pricingCache.set(modelId, pricing);
  return pricing;
}

export function lookupModelPricing(modelId: string): ModelPricingLookup {
  const normalizedModelId = normalizeModelId(modelId);
  const canonical = canonicalModelId(modelId);
  const pricing = canonical ? MODEL_PRICING[canonical] : undefined;
  return {
    modelId,
    normalizedModelId,
    ...(canonical ? { canonicalModelId: canonical } : {}),
    known: Boolean(pricing),
    ...(pricing ? { pricing } : {}),
    explanation: pricing
      ? canonical === normalizedModelId
        ? "Exact pricing table match. Cost remains an estimate, not billing truth."
        : `Alias normalized to ${canonical}. Cost remains an estimate, not billing truth.`
      : "Unknown pricing. TokSync keeps estimated cost at $0 until a first-party price source is added.",
  };
}

export function auditModelPricing(
  rows: Array<{ modelId: string; tokens: number; costUsd: number }>,
): ModelPricingAuditRow[] {
  return rows
    .map((row) => ({
      ...lookupModelPricing(row.modelId),
      tokens: row.tokens,
      costUsd: row.costUsd,
    }))
    .sort((left, right) => {
      if (left.known !== right.known) return left.known ? 1 : -1;
      return (
        right.tokens - left.tokens || left.modelId.localeCompare(right.modelId)
      );
    });
}

export function estimateCostUsd(modelId: string, tokens: TokenBreakdown) {
  const pricing = pricingForModel(modelId);
  if (!pricing) return 0;
  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const rates =
    pricing.longPrompt && promptTokens > pricing.longPrompt.thresholdTokens
      ? pricing.longPrompt
      : pricing;

  return roundUsd(
    (tokens.input * rates.inputPerMillion +
      tokens.output * rates.outputPerMillion +
      tokens.cacheRead * rates.cacheReadPerMillion +
      tokens.cacheWrite * rates.cacheWritePerMillion +
      tokens.reasoning * rates.outputPerMillion) /
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
    canonicalClaudeModelId(normalized),
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

// Claude ids appear as claude-opus-4-6, claude-sonnet-4-5-20250929,
// claude-3-5-haiku-20241022, claude-opus-4-5@20251101 (Vertex) or
// us.anthropic.claude-sonnet-4-5-20250929-v1:0 (Bedrock). All map to the
// dotted claude-<family>-<version> pricing keys.
function canonicalClaudeModelId(modelId: string) {
  const start = modelId.indexOf("claude-");
  if (start < 0) return undefined;
  const id = modelId
    .slice(start)
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-v\d+(?::\d+)?$/, "")
    .replace(/[@-]\d{8}$/, "");
  const current = CLAUDE_CURRENT_ID.exec(id);
  if (current) return claudePricingKey(current[1], current[2], current[3]);
  const legacy = CLAUDE_LEGACY_ID.exec(id);
  if (legacy) return claudePricingKey(legacy[3], legacy[1], legacy[2]);
  return undefined;
}

const CLAUDE_FAMILIES = "opus|sonnet|haiku|fable|mythos";
const CLAUDE_CURRENT_ID = new RegExp(
  `^claude-(${CLAUDE_FAMILIES})-(\\d+)(?:[-.](\\d))?$`,
);
const CLAUDE_LEGACY_ID = new RegExp(
  `^claude-(\\d+)(?:[-.](\\d))?-(${CLAUDE_FAMILIES})$`,
);

function claudePricingKey(
  family: string | undefined,
  major: string | undefined,
  minor: string | undefined,
) {
  return `claude-${family}-${major}${minor ? `.${minor}` : ""}`;
}

function stripParenthesizedReasoningTier(modelId: string) {
  const match = /^(.*)\((minimal|low|medium|high|xhigh|auto|none)\)$/.exec(
    modelId,
  );
  return match?.[1];
}
