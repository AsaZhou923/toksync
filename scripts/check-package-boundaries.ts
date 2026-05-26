import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type WorkspaceKind = "app" | "package";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type WorkspacePackage = {
  name: string;
  dir: string;
  kind: WorkspaceKind;
  dependencyNames: Set<string>;
};

const rootDir = path.resolve(import.meta.dirname, "..");

const allowedWorkspaceImports: Record<string, string[]> = {
  "@toksync/agent": [
    "@toksync/collector-core",
    "@toksync/privacy",
    "@toksync/shared",
  ],
  "@toksync/api": [
    "@toksync/db",
    "@toksync/embed-renderer",
    "@toksync/pricing",
    "@toksync/shared",
  ],
  "@toksync/web": ["@toksync/shared"],
  "@toksync/worker": ["@toksync/db"],
  "@toksync/collector-core": [
    "@toksync/pricing",
    "@toksync/privacy",
    "@toksync/shared",
  ],
  "@toksync/db": ["@toksync/privacy", "@toksync/shared"],
  "@toksync/embed-renderer": ["@toksync/shared"],
  "@toksync/pricing": ["@toksync/shared"],
  "@toksync/privacy": [],
  "@toksync/shared": [],
  "@toksync/test-fixtures": [],
};

const workspacePackages = loadWorkspacePackages();
const workspaceByName = new Map(
  workspacePackages.map((workspacePackage) => [
    workspacePackage.name,
    workspacePackage,
  ]),
);
const errors: string[] = [];
let checkedImports = 0;

for (const workspacePackage of workspacePackages) {
  const allowedImports = allowedWorkspaceImports[workspacePackage.name];
  if (!allowedImports) {
    errors.push(
      `${workspacePackage.name} is missing from allowedWorkspaceImports in scripts/check-package-boundaries.ts`,
    );
    continue;
  }

  for (const allowedImport of allowedImports) {
    if (!workspaceByName.has(allowedImport)) {
      errors.push(
        `${workspacePackage.name} allows unknown workspace dependency ${allowedImport}`,
      );
    }
  }

  for (const filePath of findSourceFiles(workspacePackage.dir)) {
    for (const specifier of extractImportSpecifiers(filePath)) {
      const targetName = workspacePackageNameFromSpecifier(specifier);
      if (!targetName) continue;

      checkedImports += 1;
      const relativeFile = path.relative(rootDir, filePath);
      const targetPackage = workspaceByName.get(targetName);
      if (!targetPackage) {
        errors.push(
          `${relativeFile} imports unknown workspace package ${specifier}`,
        );
        continue;
      }

      if (specifier !== targetName) {
        errors.push(
          `${relativeFile} imports deep workspace path ${specifier}; use ${targetName}'s public export instead`,
        );
      }

      if (workspacePackage.name === targetName) {
        continue;
      }

      if (workspacePackage.kind === "app" && targetPackage.kind === "app") {
        errors.push(`${relativeFile} imports app package ${targetName}`);
      }

      if (workspacePackage.kind === "package" && targetPackage.kind === "app") {
        errors.push(`${relativeFile} imports app package ${targetName}`);
      }

      if (!allowedImports.includes(targetName)) {
        errors.push(
          `${relativeFile} imports ${targetName}, but ${workspacePackage.name} only allows ${formatList(
            allowedImports,
          )}`,
        );
      }

      if (!workspacePackage.dependencyNames.has(targetName)) {
        errors.push(
          `${relativeFile} imports ${targetName}, but ${workspacePackage.name}/package.json does not declare it`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Package boundary check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Package boundary check passed for ${workspacePackages.length} workspace packages and ${checkedImports} workspace imports.`,
);

function loadWorkspacePackages() {
  return [
    ...loadWorkspaceRoot("apps", "app"),
    ...loadWorkspaceRoot("packages", "package"),
  ];
}

function loadWorkspaceRoot(rootName: string, kind: WorkspaceKind) {
  const rootPath = path.join(rootDir, rootName);
  if (!existsSync(rootPath)) return [];

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry): WorkspacePackage[] => {
      const dir = path.join(rootPath, entry.name);
      const packageJsonPath = path.join(dir, "package.json");
      if (!existsSync(packageJsonPath)) return [];

      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as PackageJson;
      if (!packageJson.name?.startsWith("@toksync/")) {
        return [];
      }

      return [
        {
          name: packageJson.name,
          dir,
          kind,
          dependencyNames: new Set([
            ...Object.keys(packageJson.dependencies ?? {}),
            ...Object.keys(packageJson.devDependencies ?? {}),
            ...Object.keys(packageJson.peerDependencies ?? {}),
            ...Object.keys(packageJson.optionalDependencies ?? {}),
          ]),
        },
      ];
    });
}

function findSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      files.push(...findSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && isSourceFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

function extractImportSpecifiers(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const specifiers: string[] = [];
  const importPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function workspacePackageNameFromSpecifier(specifier: string) {
  if (!specifier.startsWith("@toksync/")) return null;
  const [, scope, name] = specifier.match(/^(@toksync)\/([^/]+)/) ?? [];
  if (!scope || !name) return null;
  return `${scope}/${name}`;
}

function isSourceFile(filePath: string) {
  return [".ts", ".tsx", ".mts", ".cts"].includes(path.extname(filePath));
}

function shouldSkipDirectory(name: string) {
  return new Set([".next", ".turbo", "coverage", "dist", "node_modules"]).has(
    name,
  );
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "no workspace imports";
}
