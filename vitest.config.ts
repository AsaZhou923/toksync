import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "apps/*/src/**/*.test.ts",
      "apps/web/**/*.test.ts",
      "apps/web/**/*.test.tsx",
      "packages/*/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    // tests/e2e/ and tests/visual/ use .spec.ts with Playwright runner
    // (pnpm test:e2e / pnpm test:visual), not vitest.
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.tmp/**"],
    coverage: {
      reportsDirectory: "coverage",
      reporter: ["text", "lcov"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/.next/**",
        "**/dist/**",
        "**/.tmp/**",
        "**/.omx/**",
        "**/output/**",
      ],
    },
  },
});
