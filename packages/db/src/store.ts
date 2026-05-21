import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyTokSyncData, type TokSyncData } from "./types";

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

export class FileTokSyncStore {
  private data: TokSyncData | null = null;
  private lastLoadedMtimeMs: number | null = null;

  constructor(
    public readonly filePath = process.env.TOKSYNC_DB_FILE ||
      path.resolve(
        process.env.INIT_CWD || process.cwd(),
        ".tmp",
        "toksync-dev.json",
      ),
  ) {}

  read(): TokSyncData {
    if (this.data && !this.hasExternalChange()) return this.data;
    if (!fs.existsSync(this.filePath)) {
      this.data = emptyTokSyncData();
      this.lastLoadedMtimeMs = null;
      return this.data;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    this.data = hydrateTokSyncData(
      raw.trim() ? (JSON.parse(raw) as TokSyncData) : emptyTokSyncData(),
    );
    this.lastLoadedMtimeMs = this.currentMtimeMs();
    return this.data;
  }

  write(data = this.read()) {
    this.withLock(() => {
      const diskMtime = this.currentMtimeMs();
      if (
        this.lastLoadedMtimeMs !== null &&
        diskMtime !== null &&
        diskMtime !== this.lastLoadedMtimeMs
      ) {
        throw new Error(
          "TokSync store changed on disk during this operation; retry to avoid overwriting concurrent data.",
        );
      }
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
      replaceFileSync(tempPath, this.filePath);
      this.data = data;
      this.lastLoadedMtimeMs = this.currentMtimeMs();
    });
  }

  reset() {
    this.data = emptyTokSyncData();
    this.lastLoadedMtimeMs = this.currentMtimeMs();
    this.write(this.data);
  }

  private hasExternalChange() {
    return this.currentMtimeMs() !== this.lastLoadedMtimeMs;
  }

  private currentMtimeMs() {
    try {
      return fs.statSync(this.filePath).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private withLock<T>(operation: () => T): T {
    const lockPath = `${this.filePath}.lock`;
    const startedAt = Date.now();
    let fd: number | null = null;
    while (fd === null) {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fd = fs.openSync(lockPath, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        this.removeStaleLock(lockPath);
        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new Error("Timed out waiting for TokSync store lock");
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }

    try {
      fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      return operation();
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
    }
  }

  private removeStaleLock(lockPath: string) {
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFileSync(tempPath: string, targetPath: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      sleepSync(LOCK_RETRY_MS * (attempt + 1));
      try {
        fs.rmSync(targetPath, { force: true });
        fs.renameSync(tempPath, targetPath);
        return;
      } catch (replaceError) {
        lastError = replaceError;
      }
    }
  }
  fs.rmSync(tempPath, { force: true });
  throw lastError;
}

function hydrateTokSyncData(data: TokSyncData): TokSyncData {
  const empty = emptyTokSyncData();
  return {
    ...empty,
    ...data,
    users: (data.users ?? empty.users).map(hydrateUser),
    devices: data.devices ?? empty.devices,
    deviceTokens: data.deviceTokens ?? empty.deviceTokens,
    userApiTokens: data.userApiTokens ?? empty.userApiTokens,
    deviceCodes: data.deviceCodes ?? empty.deviceCodes,
    syncRuns: data.syncRuns ?? empty.syncRuns,
    syncReceipts: data.syncReceipts ?? empty.syncReceipts,
    sourceHealthSnapshots:
      data.sourceHealthSnapshots ?? empty.sourceHealthSnapshots,
    mergeIssues: data.mergeIssues ?? empty.mergeIssues,
    usageEvents: data.usageEvents ?? empty.usageEvents,
    usageDaily: data.usageDaily ?? empty.usageDaily,
    profileStats: (data.profileStats ?? empty.profileStats).map(
      hydrateProfileStats,
    ),
    publicProfileStats: (
      data.publicProfileStats ?? empty.publicProfileStats
    ).map(hydratePublicProfileStats),
    costGuardrailRules: data.costGuardrailRules ?? empty.costGuardrailRules,
    costAnomalies: data.costAnomalies ?? empty.costAnomalies,
    vaultExports: data.vaultExports ?? empty.vaultExports,
  };
}

function hydrateUser(user: TokSyncData["users"][number]) {
  return {
    ...user,
    showWorkspaceBreakdown: user.showWorkspaceBreakdown ?? false,
  };
}

function hydrateProfileStats(stats: TokSyncData["profileStats"][number]) {
  return {
    ...stats,
    topWorkspaces: stats.topWorkspaces ?? [],
  };
}

function hydratePublicProfileStats(
  stats: TokSyncData["publicProfileStats"][number],
) {
  return {
    ...stats,
    topWorkspaces: stats.topWorkspaces ?? [],
    showWorkspaceBreakdown: stats.showWorkspaceBreakdown ?? false,
  };
}
