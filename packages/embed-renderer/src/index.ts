import { randomUUID } from "node:crypto";
import { formatCompactNumber, formatUsd } from "@toksync/shared";

export interface PublicEmbedStats {
  username: string;
  displayName?: string;
  totalTokens: number;
  totalCostUsd: number;
  activeDays: number;
  topSources: Array<{ key: string; tokens: number; costUsd: number }>;
  topModels: Array<{ key: string; tokens: number; costUsd: number }>;
  topWorkspaces?: Array<{ key: string; tokens: number; costUsd: number }>;
  lastSyncAt?: string;
  showCost: boolean;
  showSourceBreakdown: boolean;
  showModelBreakdown: boolean;
  showWorkspaceBreakdown?: boolean;
}

export interface BadgeOptions {
  metric?: "tokens" | "cost" | "rank";
  label?: string;
  color?: string;
  style?: "flat" | "flat-square";
  compact?: boolean;
}

export interface CardOptions {
  theme?: "dark" | "light";
  compact?: boolean;
  metric?: "tokens" | "cost";
}

export interface ShareImageOptions {
  theme?: "dark" | "light";
  metric?: "tokens" | "cost";
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeColor(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const normalized = value.replace(/^#/, "");
  return /^[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(normalized)
    ? `#${normalized}`
    : fallback;
}

export function renderBadgeSvg(
  stats: PublicEmbedStats | null,
  options: BadgeOptions = {},
) {
  const label = escapeXml(options.label ?? "TokSync");
  const color = safeColor(options.color, "#2563eb");
  const radius = options.style === "flat-square" ? 0 : 4;
  const value = stats
    ? badgeValue(stats, options.metric ?? "tokens")
    : "private";
  const valueWidth = Math.max(58, value.length * 8 + 18);
  const labelWidth = Math.max(62, label.length * 8 + 20);
  const width = labelWidth + valueWidth;
  const idPrefix = `toksync-badge-${randomUUID()}`;
  const gradientId = `${idPrefix}-shade`;
  const clipId = `${idPrefix}-clip`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${escapeXml(value)}">
  <title>${label}: ${escapeXml(value)}</title>
  <linearGradient id="${gradientId}" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient>
  <clipPath id="${clipId}"><rect width="${width}" height="20" rx="${radius}" fill="#fff"/></clipPath>
  <g clip-path="url(#${clipId})">
    <rect width="${labelWidth}" height="20" fill="#374151"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#${gradientId})"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15">${escapeXml(value)}</text>
  </g>
</svg>`;
}

export function renderProfileCardSvg(
  stats: PublicEmbedStats | null,
  options: CardOptions = {},
) {
  const theme = options.theme ?? "dark";
  const compact = Boolean(options.compact);
  const width = compact ? 360 : 520;
  const height = compact ? 142 : 230;
  const bg = theme === "light" ? "#f8fafc" : "#111827";
  const fg = theme === "light" ? "#111827" : "#f9fafb";
  const muted = theme === "light" ? "#64748b" : "#9ca3af";
  const stroke = theme === "light" ? "#cbd5e1" : "#374151";
  const accent = "#22c55e";

  if (!stats) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="TokSync profile is private">
  <rect width="100%" height="100%" rx="8" fill="${bg}" stroke="${stroke}"/>
  <text x="24" y="42" fill="${fg}" font-size="20" font-weight="700" font-family="Inter,Arial,sans-serif">TokSync</text>
  <text x="24" y="76" fill="${muted}" font-size="14" font-family="Inter,Arial,sans-serif">Profile is private or not available.</text>
</svg>`;
  }

  const title = escapeXml(stats.displayName || stats.username);
  const tokenText = formatCompactNumber(stats.totalTokens);
  const costText = stats.showCost ? formatUsd(stats.totalCostUsd) : "hidden";
  const sourceText = stats.topSources[0]?.key ?? "no source";
  const modelText = stats.topModels[0]?.key ?? "no model";
  const breakdown = compact
    ? ""
    : `<text x="24" y="178" fill="${muted}" font-size="13" font-family="Inter,Arial,sans-serif">Top source: ${escapeXml(sourceText)}</text>
       <text x="24" y="202" fill="${muted}" font-size="13" font-family="Inter,Arial,sans-serif">Top model: ${escapeXml(modelText)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="TokSync profile for ${escapeXml(stats.username)}">
  <rect width="100%" height="100%" rx="8" fill="${bg}" stroke="${stroke}"/>
  <circle cx="34" cy="34" r="10" fill="${accent}"/>
  <text x="54" y="41" fill="${fg}" font-size="20" font-weight="700" font-family="Inter,Arial,sans-serif">${title}</text>
  <text x="24" y="72" fill="${muted}" font-size="13" font-family="Inter,Arial,sans-serif">@${escapeXml(stats.username)} AI coding metrics</text>
  <g font-family="Inter,Arial,sans-serif">
    <text x="24" y="112" fill="${fg}" font-size="26" font-weight="700">${escapeXml(tokenText)}</text>
    <text x="24" y="132" fill="${muted}" font-size="12">tokens</text>
    <text x="176" y="112" fill="${fg}" font-size="26" font-weight="700">${escapeXml(costText)}</text>
    <text x="176" y="132" fill="${muted}" font-size="12">cost</text>
    <text x="316" y="112" fill="${fg}" font-size="26" font-weight="700">${stats.activeDays}</text>
    <text x="316" y="132" fill="${muted}" font-size="12">active days</text>
  </g>
  ${breakdown}
</svg>`;
}

export function renderShareImageSvg(
  stats: PublicEmbedStats | null,
  options: ShareImageOptions = {},
) {
  const theme = options.theme ?? "dark";
  const width = 1200;
  const height = 630;
  const bg = theme === "light" ? "#f7f5ee" : "#101711";
  const panel = theme === "light" ? "#ffffff" : "#19221b";
  const fg = theme === "light" ? "#101711" : "#f5f1e8";
  const muted = theme === "light" ? "#667064" : "#a9b5a7";
  const line = theme === "light" ? "#d7ddcf" : "#334035";
  const accent = "#22c55e";

  if (!stats) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="TokSync public share unavailable">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="72" y="72" width="1056" height="486" rx="24" fill="${panel}" stroke="${line}"/>
  <text x="116" y="156" fill="${fg}" font-size="46" font-weight="800" font-family="Inter,Arial,sans-serif">TokSync</text>
  <text x="116" y="224" fill="${muted}" font-size="26" font-family="Inter,Arial,sans-serif">Public profile is private or not available.</text>
</svg>`;
  }

  const title = escapeXml(stats.displayName || stats.username);
  const metric = options.metric === "cost" ? "cost" : "tokens";
  const metricValue =
    metric === "cost"
      ? stats.showCost
        ? formatUsd(stats.totalCostUsd)
        : "hidden"
      : formatCompactNumber(stats.totalTokens);
  const metricLabel = metric === "cost" ? "estimated cost" : "public tokens";
  const topSource = stats.showSourceBreakdown
    ? (stats.topSources[0]?.key ?? "no source")
    : "hidden";
  const topModel = stats.showModelBreakdown
    ? (stats.topModels[0]?.key ?? "no model")
    : "hidden";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="TokSync public share for ${escapeXml(stats.username)}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="72" y="72" width="1056" height="486" rx="24" fill="${panel}" stroke="${line}"/>
  <circle cx="130" cy="136" r="18" fill="${accent}"/>
  <text x="164" y="149" fill="${fg}" font-size="32" font-weight="800" font-family="Inter,Arial,sans-serif">TokSync</text>
  <text x="116" y="248" fill="${fg}" font-size="70" font-weight="850" font-family="Inter,Arial,sans-serif">${title}</text>
  <text x="116" y="304" fill="${muted}" font-size="28" font-family="Inter,Arial,sans-serif">@${escapeXml(stats.username)} public AI coding metrics</text>
  <text x="116" y="420" fill="${fg}" font-size="82" font-weight="850" font-family="Inter,Arial,sans-serif">${escapeXml(metricValue)}</text>
  <text x="118" y="466" fill="${muted}" font-size="24" font-family="Inter,Arial,sans-serif">${metricLabel}. Estimates are not provider billing truth.</text>
  <g font-family="Inter,Arial,sans-serif" font-size="22" fill="${muted}">
    <text x="690" y="384">active days</text>
    <text x="690" y="432">top source</text>
    <text x="690" y="480">top model</text>
  </g>
  <g font-family="Inter,Arial,sans-serif" font-size="28" font-weight="700" fill="${fg}">
    <text x="900" y="384">${stats.activeDays}</text>
    <text x="900" y="432">${escapeXml(topSource)}</text>
    <text x="900" y="480">${escapeXml(topModel)}</text>
  </g>
</svg>`;
}

function badgeValue(
  stats: PublicEmbedStats,
  metric: "tokens" | "cost" | "rank",
) {
  if (metric === "cost")
    return stats.showCost ? formatUsd(stats.totalCostUsd) : "hidden";
  if (metric === "rank") return "not ranked";
  return `${formatCompactNumber(stats.totalTokens)} tokens`;
}
