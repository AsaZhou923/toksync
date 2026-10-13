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
      // Vitest 4 only reports loaded files by default. Keep uncovered source
      // files in the report, as Vitest 3 did with coverage.all enabled.
      include: [
        "apps/*/src/**/*.{ts,tsx}",
        "apps/web/{app,components,lib}/**/*.{ts,tsx}",
        "packages/*/src/**/*.{ts,tsx}",
        "scripts/*.{ts,mjs}",
      ],
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
