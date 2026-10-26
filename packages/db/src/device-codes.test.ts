import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TokSyncRepository } from "./repository";
import { FileTokSyncStore } from "./store";

const { userCodeBytes } = vi.hoisted(() => ({
  userCodeBytes: vi.fn<() => Buffer | undefined>(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: (size: number) =>
      (size === 8 ? userCodeBytes() : undefined) ?? actual.randomBytes(size),
  };
});

const taskDirectory = mkdtempSync(path.join(tmpdir(), "toksync-device-codes-"));
const input = {
  deviceName: "Synthetic test device",
  platform: "linux" as const,
  agentVersion: "0.1.0",
  deviceFingerprint: "synthetic-device-fingerprint",
};

function createContext() {
  const store = new FileTokSyncStore(
    path.join(mkdtempSync(path.join(taskDirectory, "case-")), "db.json"),
  );
  return { store, repo: new TokSyncRepository(store) };
}

beforeEach(() => userCodeBytes.mockReset());

afterAll(() => {
  const resolved = path.resolve(taskDirectory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("toksync-device-codes-")
  ) {
    throw new Error("Refusing to remove an unexpected temporary directory");
  }
  rmSync(resolved, { recursive: true, force: true });
});

describe("device authorization code security", () => {
  it("uses eight uniform base-32 characters within the stored code length", () => {
    const { repo } = createContext();
    userCodeBytes.mockReturnValue(
      Buffer.from([0, 31, 32, 63, 64, 95, 96, 127]),
    );

    const code = repo.createDeviceCode(input);

    expect(code.userCode).toBe("TS-A9A9-A9A9");
    expect(code.userCode).toHaveLength(12);
    expect(code.userCode).toMatch(/^TS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("retries a collision without making two pending codes ambiguous", () => {
    const { repo, store } = createContext();
    userCodeBytes
      .mockReturnValueOnce(Buffer.alloc(8, 0))
      .mockReturnValueOnce(Buffer.alloc(8, 0))
      .mockReturnValueOnce(Buffer.alloc(8, 1));

    const first = repo.createDeviceCode(input);
    const second = repo.createDeviceCode(input);

    expect(first.userCode).toBe("TS-AAAA-AAAA");
    expect(second.userCode).toBe("TS-BBBB-BBBB");
    expect(userCodeBytes).toHaveBeenCalledTimes(3);
    expect(store.read().deviceCodes).toHaveLength(2);
    expect(repo.authorizeDeviceCode(second.userCode, "bob")).toEqual({
      status: "authorized",
      username: "bob",
    });
    expect(repo.pollDeviceCode(first.deviceCode).status).toBe("pending");
    expect(repo.pollDeviceCode(second.deviceCode)).toMatchObject({
      status: "authorized",
      username: "bob",
    });
  });

  it("fails closed after bounded collisions without persisting a new code", () => {
    const { repo, store } = createContext();
    userCodeBytes.mockReturnValue(Buffer.alloc(8, 0));
    repo.createDeviceCode(input);
    const before = readFileSync(store.filePath);

    expect(() => repo.createDeviceCode(input)).toThrow(
      "Unable to generate a unique device user code",
    );

    expect(userCodeBytes).toHaveBeenCalledTimes(11);
    expect(readFileSync(store.filePath)).toEqual(before);
    expect(
      new FileTokSyncStore(store.filePath).read().deviceCodes,
    ).toHaveLength(1);
  });

  it("accepts lowercase input once and never lets another user replace the owner", () => {
    const { repo, store } = createContext();
    const started = repo.createDeviceCode(input);

    expect(
      repo.authorizeDeviceCode(started.userCode.toLowerCase(), "alice"),
    ).toEqual({ status: "authorized", username: "alice" });
    const before = readFileSync(store.filePath);
    expect(repo.authorizeDeviceCode(started.userCode, "mallory")).toBeNull();
    expect(repo.authorizeDeviceCode(started.userCode, "alice")).toBeNull();
    expect(readFileSync(store.filePath)).toEqual(before);
    expect(repo.getUser("mallory")).toBeUndefined();
    expect(repo.pollDeviceCode(started.deviceCode)).toMatchObject({
      status: "authorized",
      username: "alice",
    });
    expect(repo.pollDeviceCode(started.deviceCode)).toEqual({
      status: "consumed",
    });
    expect(repo.authorizeDeviceCode(started.userCode, "mallory")).toBeNull();
  });

  it("rejects expired codes without creating a user or issuing a token", () => {
    const { repo, store } = createContext();
    const started = repo.createDeviceCode(input);
    store.transaction((data) => {
      data.deviceCodes[0]!.expiresAt = new Date(
        Date.now() - 1_000,
      ).toISOString();
      return { commit: true, result: undefined };
    });

    expect(repo.authorizeDeviceCode(started.userCode, "alice")).toBeNull();
    expect(repo.pollDeviceCode(started.deviceCode)).toEqual({
      status: "expired",
    });
    expect(store.read().users).toHaveLength(0);
    expect(store.read().deviceTokens).toHaveLength(0);
  });

  it("still authorizes a legacy pending code without changing its format", () => {
    const { repo, store } = createContext();
    const started = repo.createDeviceCode(input);
    store.transaction((data) => {
      data.deviceCodes[0]!.userCode = "TS-12AF";
      return { commit: true, result: undefined };
    });

    expect(repo.authorizeDeviceCode("ts-12af", "alice")).toEqual({
      status: "authorized",
      username: "alice",
    });
    expect(repo.pollDeviceCode(started.deviceCode)).toMatchObject({
      status: "authorized",
      username: "alice",
    });
  });
});
