import { describe, expect, it } from "vitest";
import {
  assertMetricsOnlyPayload,
  hashWorkspacePath,
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
  });
});
