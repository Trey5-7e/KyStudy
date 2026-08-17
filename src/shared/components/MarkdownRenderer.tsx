import { type ElementType, type ReactNode } from "react";
import { renderToString } from "katex";
import "katex/dist/katex.min.css";

export interface MarkdownRendererProps {
  source: string;
  className?: string;
}

export function MarkdownRenderer({ source, className }: MarkdownRendererProps) {
  return (
    <div
      className={
        className === undefined
          ? "markdown-renderer"
          : `markdown-renderer ${className}`
      }
    >
      {renderMarkdown(source)}
    </div>
  );
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre key={`code-${key++}`}>
          <code data-language={language || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim() === "$$" || line.trim() === "\\[") {
      const closing = line.trim() === "$$" ? "$$" : "\\]";
      const formula: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]!.trim() !== closing) {
        formula.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <div key={`math-block-${key++}`} className="markdown-math-block">
          {renderMath(formula.join("\n"), true, key)}
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading !== null) {
      const level = Math.min(6, heading[1]!.length) as 1 | 2 | 3 | 4 | 5 | 6;
      const Heading = `h${level}` as ElementType;
      nodes.push(
        <Heading key={`heading-${key++}`}>{renderInline(heading[2]!)}</Heading>,
      );
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index]!);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|")) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      nodes.push(
        <table key={`table-${key++}`}>
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {header.map((_, cellIndex) => (
                  <td key={cellIndex}>{renderInline(row[cellIndex] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (isListItem(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && isListItem(lines[index]!, ordered)) {
        items.push(
          lines[index]!.replace(
            ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/,
            "",
          ),
        );
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      nodes.push(
        <List key={`list-${key++}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !isBlockStart(lines, index)
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    nodes.push(
      <p key={`paragraph-${key++}`}>{renderInline(paragraph.join("\n"))}</p>,
    );
  }
  return nodes;
}

export function markdownToPlainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?|```$/g, ""),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeMarkdownHref(value: string): string | undefined {
  const href = value.trim();
  if (href === "") return undefined;
  try {
    const url = new URL(href, "https://kystudy.invalid");
    if (url.origin === "https://kystudy.invalid" && !href.startsWith("/"))
      return undefined;
    if (!["https:", "http:", "mailto:"].includes(url.protocol))
      return undefined;
    return href;
  } catch {
    return undefined;
  }
}

function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\)|\$\$[^$\n]+\$\$|\$[^$\n]+\$|\\\[[^\n]+?\\\]|\\\([^\n]+?\\\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={`inline-code-${key++}`}>{token.slice(1, -1)}</code>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      const href = link === null ? undefined : sanitizeMarkdownHref(link[2]!);
      nodes.push(
        href === undefined ? (
          (link?.[1] ?? token)
        ) : (
          <a key={`link-${key++}`} href={href} target="_blank" rel="noreferrer">
            {link?.[1] ?? token}
          </a>
        ),
      );
    } else {
      const displayMode = token.startsWith("$$") || token.startsWith("\\[");
      const expression = displayMode
        ? token.slice(2, -2)
        : token.startsWith("$")
          ? token.slice(1, -1)
          : token.slice(2, -2);
      nodes.push(renderMath(expression, displayMode, key++));
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  const result: ReactNode[] = [];
  nodes.forEach((node, index) => {
    if (typeof node !== "string" || !node.includes("\n")) {
      result.push(node);
      return;
    }
    const parts = node.split("\n");
    parts.forEach((part, partIndex) => {
      result.push(part);
      if (partIndex < parts.length - 1) {
        result.push(<br key={`br-${index}-${partIndex}`} />);
      }
    });
  });
  return result;
}

function renderMath(
  expression: string,
  displayMode: boolean,
  key: number,
): ReactNode {
  try {
    return (
      <span
        key={`math-${key}`}
        className="markdown-math"
        data-math={expression}
        dangerouslySetInnerHTML={{
          __html: renderToString(expression, {
            displayMode,
            throwOnError: true,
            trust: false,
            strict: "ignore",
          }),
        }}
      />
    );
  } catch {
    return (
      <span
        key={`math-fallback-${key}`}
        className="markdown-math"
        data-math={expression}
      >
        {expression}
      </span>
    );
  }
}

function isTableStart(lines: readonly string[], index: number): boolean {
  return (
    index + 1 < lines.length &&
    lines[index]!.includes("|") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]!)
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isListItem(line: string, ordered?: boolean): boolean {
  return ordered === true
    ? /^\s*\d+[.)]\s+/.test(line)
    : ordered === false
      ? /^\s*[-*+]\s+/.test(line)
      : /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    line.trim().startsWith("```") ||
    /^(#{1,6})\s+/.test(line.trim()) ||
    isListItem(line) ||
    isTableStart(lines, index)
  );
}
