/** @type {import('next').NextConfig} */
const standaloneOutput =
  process.env.TOKSYNC_STANDALONE_OUTPUT === "1" ||
  process.env.CI === "true" ||
  process.env.VERCEL === "1";

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: ["@toksync/shared"],
  typedRoutes: true,
  poweredByHeader: false,
  output: standaloneOutput ? "standalone" : undefined,
};

export default nextConfig;
