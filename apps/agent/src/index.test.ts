import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceFingerprint, type AgentConfig } from "./config";
import {
  buildLocalReceipt,
  chunk,
  resolveWriteToken,
  summarizeSyncResponses,
} from "./index";

const baseConfig: AgentConfig = {
  apiUrl: "http://localhost:4000",
  deviceSeed: "stable-test-seed",
};

describe("agent CLI helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TOKSYNC_API_TOKEN;
  });

  it("derives stable local device fingerprints from the random device seed", () => {
    expect(deviceFingerprint(baseConfig)).toBe(deviceFingerprint(baseConfig));
    expect(deviceFingerprint(baseConfig)).not.toBe(
      deviceFingerprint({ ...baseConfig, deviceSeed: "other-seed" }),
    );
  });

  it("builds metrics-only dry-run receipts and rejects forbidden content keys", () => {
    const receipt = buildLocalReceipt({
      schemaVersion: 1,
      runId: "dry-run",
      mode: "dry-run",
      device: { id: "device-1" },
      events: [
        {
          source: "codex",
          modelId: "gpt-5.4",
          tokens: { input: 1, output: 1 },
        },
      ],
    });

    expect(receipt.payloadDigest).toMatch(/^sha256:/);
    expect(receipt.excludedFields).toContain("raw project paths");
    expect(() => buildLocalReceipt({ prompt: "do not upload" })).toThrow(
      /forbidden/i,
    );
  });

  it("chunks uploads and summarizes multi-batch responses", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(
      summarizeSyncResponses([
        { status: "accepted", inserted: 2, updated: 1, skipped: 0 },
        {
          status: "accepted",
          inserted: 0,
          updated: 0,
          skipped: 3,
          errors: [{ code: "wrong_device" }],
        },
      ]),
    ).toMatchObject({
      status: "accepted",
      batches: 2,
      inserted: 2,
      updated: 1,
      skipped: 3,
      errors: [{ batch: 2, code: "wrong_device" }],
    });
  });

  it("uses TOKSYNC_API_TOKEN once and clears it from this process", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.TOKSYNC_API_TOKEN = "tsk_env";

    expect(resolveWriteToken("tsd_config")).toBe("tsk_env");
    expect(process.env.TOKSYNC_API_TOKEN).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("TOKSYNC_API_TOKEN"),
    );
    expect(resolveWriteToken("tsd_config")).toBe("tsd_config");
  });
});
