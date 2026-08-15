import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const root = process.cwd();
const rawTargets = process.argv.slice(2).filter((target) => target !== "--");

if (rawTargets.length === 0) {
  console.error(
    "Usage: pnpm check:target -- <changed-file> [changed-file ...]",
  );
  process.exit(2);
}

const targets = [
  ...new Set(
    rawTargets.map((target) => {
      const absolute = resolve(root, target);
      const workspacePath = relative(root, absolute);
      if (
        workspacePath.startsWith("..") ||
        !existsSync(absolute) ||
        !statSync(absolute).isFile()
      ) {
        console.error(`Invalid target file: ${target}`);
        process.exit(2);
      }
      return workspacePath.replaceAll("\\", "/");
    }),
  ),
];

const scriptExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);
const typedExtensions = new Set([".ts", ".tsx"]);
const lintTargets = targets.filter((target) =>
  scriptExtensions.has(extname(target)),
);
const typedTargets = targets.filter((target) =>
  typedExtensions.has(extname(target)),
);
const testTargets = typedTargets.filter((target) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(target),
);
const relatedTargets = typedTargets.filter(
  (target) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(target),
);

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const usePnpmCli = command === "pnpm" && process.env.npm_execpath;
  const executable = usePnpmCli ? process.execPath : command;
  const executableArgs = usePnpmCli
    ? [process.env.npm_execpath, ...args]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", ["exec", "prettier", "--check", ...targets]);

if (lintTargets.length > 0) {
  run("pnpm", ["exec", "eslint", ...lintTargets, "--max-warnings", "0"]);
}

if (typedTargets.length > 0) {
  run("pnpm", ["typecheck"]);
}

if (testTargets.length > 0) {
  run("pnpm", ["exec", "vitest", "run", ...testTargets]);
}

if (relatedTargets.length > 0) {
  run("pnpm", [
    "exec",
    "vitest",
    "related",
    "--run",
    "--passWithNoTests",
    ...relatedTargets,
  ]);
}
