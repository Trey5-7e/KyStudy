import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { analyzeCss, formatAuditReport } from "./css-audit-core.mjs";

const root = process.cwd();
const argumentsList = process.argv.slice(2);
const showAll = argumentsList.includes("--all");
const cssArgument = argumentsList.find(
  (argument) => !argument.startsWith("--"),
);
const cssPath = resolve(root, cssArgument ?? "src/app/app.css");
const sourceRoot = resolve(root, "src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

if (!existsSync(cssPath) || !statSync(cssPath).isFile()) {
  console.error(`CSS file not found: ${relative(root, cssPath)}`);
  process.exit(2);
}

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    if (
      !sourceExtensions.has(extname(entry.name)) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

const css = readFileSync(cssPath, "utf8");
const sourceText = [
  readFileSync(resolve(root, "index.html"), "utf8"),
  ...collectSourceFiles(sourceRoot).map((path) => readFileSync(path, "utf8")),
].join("\n");
const result = analyzeCss(css, sourceText);

console.log(
  formatAuditReport(result, {
    cssLabel: relative(root, cssPath).replaceAll("\\", "/"),
    showAll,
  }),
);
