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

  it("allows configured API images for SVG previews", async () => {
    const headers = await nextConfig.headers();
    const csp = headers[0]?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain("img-src");
    expect(csp).toContain("http://localhost:4000");
    expect(csp).toContain("http://127.0.0.1:4000");
  });
});
