import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileTokSyncStore } from "../store";

const store = new FileTokSyncStore();
store.write();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  scriptDir,
  "../../migrations/0001_v0_1_metrics.sql",
);
const hasMigration = fs.existsSync(migrationPath);

console.log(`TokSync file store ready at ${store.filePath}`);
console.log(
  hasMigration
    ? `Postgres migration available at ${migrationPath}`
    : "Postgres migration missing",
);
