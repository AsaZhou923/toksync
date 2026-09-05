import fs from "node:fs/promises";
import path from "node:path";

export const defaultPlaywrightLockStaleMs = 120_000;

export async function acquireJsonDirectoryLock(lockDir, owner, options = {}) {
  const {
    ownerFile = "owner.json",
    staleMs = defaultPlaywrightLockStaleMs,
    timeoutMs = defaultPlaywrightLockStaleMs,
    retryMs = 250,
    timeoutMessage = `Timed out waiting for Playwright lock at ${lockDir}`,
  } = options;
  const deadline = Date.now() + timeoutMs;
  const ownerPath = path.join(lockDir, ownerFile);

  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockDir, { recursive: false });
      try {
        await writeLockOwner(ownerPath, owner);
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      return { lockDir, ownerPath, token: owner.token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await recoverStaleDirectoryLock(lockDir, ownerFile, { staleMs });
    }
    await delay(retryMs);
  }

  throw new Error(timeoutMessage);
}

export async function releaseJsonDirectoryLock(lock, options = {}) {
  const { ownerFile = "owner.json" } = options;
  const owner = await readLockOwner(path.join(lock.lockDir, ownerFile));
  if (!owner || owner.token !== lock.token) return false;
  await fs.rm(lock.lockDir, { recursive: true, force: true });
  return true;
}

export async function acquireJsonFileLock(lockPath, owner, options = {}) {
  const { staleMs = defaultPlaywrightLockStaleMs } = options;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(formatOwner(owner));
      } catch (error) {
        await fs.rm(lockPath, { force: true });
        throw error;
      } finally {
        await handle.close();
      }
      return { lockPath, token: owner.token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const recovered = await recoverStaleFileLock(lockPath, { staleMs });
      if (!recovered) return null;
    }
  }

  return null;
}

export async function releaseJsonFileLock(lock) {
  const owner = await readLockOwner(lock.lockPath);
  if (!owner || owner.token !== lock.token) return false;
  await fs.rm(lock.lockPath, { force: true });
  return true;
}

export async function recoverStaleDirectoryLock(
  lockDir,
  ownerFile,
  options = {},
) {
  const ownerPath = path.join(lockDir, ownerFile);
  const owner = await readLockOwner(ownerPath);
  if (!(await isRecoverableDirectoryLock(owner, ownerPath, lockDir, options)))
    return false;
  const stalePath = `${lockDir}.stale-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(lockDir, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error?.code === "EEXIST" || error?.code === "EPERM") return false;
    throw error;
  }
  await fs.rm(stalePath, { recursive: true, force: true });
  return true;
}

export async function recoverStaleFileLock(lockPath, options = {}) {
  const owner = await readLockOwner(lockPath);
  if (!(await isRecoverableLock(owner, lockPath, options))) return false;
  const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    await fs.rename(lockPath, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error?.code === "EEXIST" || error?.code === "EPERM") return false;
    throw error;
  }
  await fs.rm(stalePath, { force: true });
  return true;
}

export function isRecoverableLockOwner(
  owner,
  { staleMs = defaultPlaywrightLockStaleMs, now = Date.now() } = {},
) {
  if (!owner || typeof owner !== "object") return false;
  if (isLivePid(owner.pid)) return false;
  if (isValidPid(owner.pid)) return true;

  const createdAt = Date.parse(owner.createdAt);
  return Number.isFinite(createdAt) && now - createdAt > staleMs;
}

async function readLockOwner(ownerPath) {
  try {
    return JSON.parse(await fs.readFile(ownerPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function isRecoverableLock(owner, lockPath, options) {
  if (hasUsableLockOwner(owner)) {
    return isRecoverableLockOwner(owner, options);
  }
  return isLockPathStale(lockPath, options);
}

async function isRecoverableDirectoryLock(owner, ownerPath, lockDir, options) {
  if (hasUsableLockOwner(owner)) {
    return isRecoverableLockOwner(owner, options);
  }
  return isLockPathStale(await ownerAgePath(ownerPath, lockDir), options);
}

async function ownerAgePath(ownerPath, lockDir) {
  try {
    await fs.stat(ownerPath);
    return ownerPath;
  } catch (error) {
    if (error?.code === "ENOENT") return lockDir;
    throw error;
  }
}

function hasUsableLockOwner(owner) {
  if (!owner || typeof owner !== "object") return false;
  if (typeof owner.token !== "string" || owner.token.length === 0) return false;
  return isValidPid(owner.pid) || Number.isFinite(Date.parse(owner.createdAt));
}

async function isLockPathStale(
  lockPath,
  { staleMs = defaultPlaywrightLockStaleMs, now = Date.now() } = {},
) {
  try {
    const stats = await fs.stat(lockPath);
    return now - stats.mtimeMs > staleMs;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function writeLockOwner(ownerPath, owner) {
  await fs.writeFile(ownerPath, formatOwner(owner));
}

function formatOwner(owner) {
  return `${JSON.stringify(owner, null, 2)}\n`;
}

function isLivePid(pid) {
  if (!isValidPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isValidPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
