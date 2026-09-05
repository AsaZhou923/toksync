import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const englishReadme = readFileSync(join(process.cwd(), "README.md"), "utf8");
const chineseReadme = readFileSync(
  join(process.cwd(), "README.zh-CN.md"),
  "utf8",
);

function section(markdown: string, heading: string) {
  const start = markdown.indexOf(heading);
  expect(start, `missing heading ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function expectUserOnboardingContract(markdown: string, heading: string) {
  const userPath = section(markdown, heading);

  expect(userPath).toContain("toksync login");
  expect(userPath).toContain("toksync sync --dry-run");
  expect(userPath).toContain("toksync sync");
  expect(userPath).not.toMatch(
    /--fixture|--auto-authorize|localhost|demo|TOKSYNC_API_TOKEN|--token|skipped/,
  );
}

function expectDeveloperOnboardingContract(markdown: string, heading: string) {
  const localPath = section(markdown, heading);

  expect(localPath).toContain("pnpm install");
  expect(localPath).toContain(".env.example .env");
  expect(localPath).toContain("pnpm dev");
  expect(localPath).toContain("pnpm dev:worker");
  expect(localPath).toMatch(/\.tmp\/toksync-(?:onboarding|agent)/);
  expect(localPath).toContain("$env:TOKSYNC_CONFIG_DIR");
  expect(localPath).toContain(
    "corepack pnpm agent login --auto-authorize demo",
  );
  expect(localPath).toContain(
    "corepack pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic",
  );
  expect(localPath).toContain(
    "corepack pnpm agent sync --fixture ./packages/test-fixtures/codex/basic --yes",
  );

  expect(localPath.indexOf("pnpm dev")).toBeLessThan(
    localPath.indexOf("corepack pnpm agent login --auto-authorize demo"),
  );
  expect(localPath.indexOf("$env:TOKSYNC_CONFIG_DIR")).toBeLessThan(
    localPath.indexOf("corepack pnpm agent login --auto-authorize demo"),
  );
  expect(
    localPath.indexOf(
      "corepack pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic",
    ),
  ).toBeLessThan(
    localPath.indexOf(
      "corepack pnpm agent sync --fixture ./packages/test-fixtures/codex/basic --yes",
    ),
  );

  expect(localPath).toContain("http://localhost:4000");
  expect(localPath).toContain("TOKSYNC_DEV_AUTH=1");
  expect(localPath).toContain("TOKSYNC_API_TOKEN=");
}

describe("README onboarding contract", () => {
  it("keeps the final-user path concise in English", () => {
    expectUserOnboardingContract(englishReadme, "## Quick Start");
  });

  it("keeps the final-user path concise in Chinese", () => {
    expectUserOnboardingContract(chineseReadme, "## 快速开始");
  });

  it("keeps the reproducible contributor path in English", () => {
    expectDeveloperOnboardingContract(englishReadme, "## Developer Setup");
  });

  it("keeps the reproducible contributor path in Chinese", () => {
    expectDeveloperOnboardingContract(chineseReadme, "## 开发者设置");
  });
});
