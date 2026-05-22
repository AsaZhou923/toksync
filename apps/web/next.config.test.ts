import { describe, expect, it } from "vitest";
import nextConfig from "./next.config.mjs";

describe("web security headers", () => {
  it("does not allow arbitrary HTTPS connect-src targets", async () => {
    const headers = await nextConfig.headers();
    const csp = headers[0]?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain("connect-src");
    expect(csp).not.toContain("connect-src 'self' https:");
    expect(csp).not.toMatch(/connect-src[^;]*\shttps:/);
  });
});
