import { describe, expect, it } from "vitest";
import {
  assertMetricsOnlyPayload,
  hashOpaqueValue,
  hashWorkspacePath,
  sha256Base64Url,
  workspaceLabelFromPath,
} from "./index";

describe("privacy helpers", () => {
  it("hashes workspace paths and keeps only a low sensitivity label", () => {
    const rawPath = "C:\\Users\\alice\\secret-client\\project";
    expect(hashWorkspacePath(rawPath)).toMatch(/^sha256:/);
    expect(hashWorkspacePath(rawPath)).not.toContain("alice");
    expect(workspaceLabelFromPath(rawPath)).toBe("project");
  });

  it("rejects content fields from metrics-only payloads", () => {
    expect(() =>
      assertMetricsOnlyPayload({ prompt: "do not upload me" }),
    ).toThrow(/prompt/);
    expect(() =>
      assertMetricsOnlyPayload({
        events: [
          {
            toolArguments: { path: "C:/Users/alice/private-client/secret.txt" },
          },
        ],
      }),
    ).toThrow(/toolArguments/);
    expect(() =>
      assertMetricsOnlyPayload(JSON.parse('{"\\u0070rompt":"escaped"}')),
    ).toThrow(/prompt/);
    expect(() =>
      assertMetricsOnlyPayload({
        events: [{ systemPrompt: "secret", diff: "patch text" }],
      }),
    ).toThrow(/systemPrompt/);
    expect(() =>
      assertMetricsOnlyPayload(
        { events: [{ customSecret: "x" }] },
        {
          forbiddenKeys: ["customSecret"],
        },
      ),
    ).toThrow(/customSecret/);
  });

  it("hashes opaque values and raw bytes deterministically", () => {
    expect(hashOpaqueValue("token", "secret")).toBe(
      hashOpaqueValue("token", "secret"),
    );
    expect(hashOpaqueValue("token", "secret")).not.toBe(
      hashOpaqueValue("token", "other"),
    );
    expect(sha256Base64Url("payload")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
