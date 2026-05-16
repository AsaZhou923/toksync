import fs from "node:fs";
import path from "node:path";
import { emptyTokSyncData, type TokSyncData } from "./types";

export class FileTokSyncStore {
  private data: TokSyncData | null = null;

  constructor(
    public readonly filePath = process.env.TOKSYNC_DB_FILE ||
      path.resolve(
        process.env.INIT_CWD || process.cwd(),
        ".tmp",
        "toksync-dev.json",
      ),
  ) {}

  read(): TokSyncData {
    if (this.data) return this.data;
    if (!fs.existsSync(this.filePath)) {
      this.data = emptyTokSyncData();
      return this.data;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    this.data = raw.trim()
      ? (JSON.parse(raw) as TokSyncData)
      : emptyTokSyncData();
    return this.data;
  }

  write(data = this.read()) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
    this.data = data;
  }

  reset() {
    this.data = emptyTokSyncData();
    this.write(this.data);
  }
}
