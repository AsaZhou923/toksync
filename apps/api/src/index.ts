import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import { createApiApp } from "./app";

loadDotEnvIfPresent();

const port = Number(process.env.PORT || 4000);
const app = createApiApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`TokSync API listening on http://localhost:${info.port}`);
});

function loadDotEnvIfPresent() {
  const envPath = path.resolve(process.env.INIT_CWD || process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}
