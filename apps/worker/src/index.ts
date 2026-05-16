import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { TokSyncRepository } from "@toksync/db";

const app = new Hono();
const repo = new TokSyncRepository();

app.get("/health", (c) =>
  c.json({ status: "ok", service: "worker", timestamp: Date.now() }),
);

app.post("/v1/worker/recompute/:username", (c) => {
  const username = c.req.param("username");
  repo.seedDevelopmentUser(username);
  return c.json({ status: "completed", username });
});

const port = Number(process.env.WORKER_PORT || 4100);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `TokSync worker health listening on http://localhost:${info.port}`,
  );
});
