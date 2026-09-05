/** @type {import('next').NextConfig} */
const standaloneOutput =
  process.env.TOKSYNC_STANDALONE_OUTPUT === "1" ||
  process.env.CI === "true" ||
  process.env.VERCEL === "1";
const devScriptPolicy =
  process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
const apiOrigin = apiOriginFromEnv();
const playwrightDistDir =
  process.env.TOKSYNC_PLAYWRIGHT_NEXT_DIST_DIR?.trim() || undefined;
const playwrightTsconfigPath =
  process.env.TOKSYNC_PLAYWRIGHT_TSCONFIG_PATH?.trim() || undefined;
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `img-src 'self' data: https: ${apiOrigin} http://localhost:4000 http://127.0.0.1:4000`,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Next's static pages emit inline hydration scripts. Removing unsafe-inline
  // requires nonce propagation plus dynamic rendering, or a verified hash policy.
  // Keep this compatibility constraint explicit; SVG responses use script-src 'none'.
  // https://nextjs.org/docs/app/guides/content-security-policy#without-nonces
  `script-src 'self' 'unsafe-inline'${devScriptPolicy}`,
  `connect-src 'self' ${apiOrigin} http://localhost:4000 http://127.0.0.1:4000`,
].join("; ");

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@toksync/shared"],
  typedRoutes: true,
  poweredByHeader: false,
  distDir: playwrightDistDir,
  output: standaloneOutput ? "standalone" : undefined,
  typescript: playwrightTsconfigPath
    ? { tsconfigPath: playwrightTsconfigPath }
    : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

function apiOriginFromEnv() {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_API_URL ||
        process.env.API_URL ||
        "http://localhost:4000",
    ).origin;
  } catch {
    return "http://localhost:4000";
  }
}
