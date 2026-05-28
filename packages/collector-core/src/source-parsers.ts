import fs from "node:fs/promises";
import { type UsageEventV1 } from "@toksync/shared";
import { readJsonFileShape } from "./source-parsers/shared";
import type { SourceParseContext } from "./source-parsers/shared";
import { parseCursorCsv } from "./source-parsers/cursor";
import { parseCopilotOtel } from "./source-parsers/copilot";
import { parseGeminiSession } from "./source-parsers/gemini";
import { parseOpenClawUsageFile } from "./source-parsers/openclaw";

export type { SourceParseContext } from "./source-parsers/shared";

export async function parseSourceSpecificUsageFile(
  ctx: SourceParseContext,
): Promise<UsageEventV1[] | null> {
  if (ctx.source === "cursor" && ctx.file.toLowerCase().endsWith(".csv")) {
    return parseCursorCsv(await fs.readFile(ctx.file, "utf8"), ctx);
  }

  if (ctx.source === "copilot") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseCopilotOtel(parsed.records, ctx);
  }

  if (ctx.source === "gemini") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseGeminiSession(parsed, ctx);
  }

  if (ctx.source === "openclaw") {
    const parsed = await readJsonFileShape(ctx.file);
    return parseOpenClawUsageFile(parsed, ctx);
  }

  return null;
}
