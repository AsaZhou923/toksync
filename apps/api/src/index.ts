import { serve } from "@hono/node-server";
import { createApiApp } from "./app";

const port = Number(process.env.PORT || 4000);
const app = createApiApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`TokSync API listening on http://localhost:${info.port}`);
});
