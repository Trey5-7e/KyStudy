import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import "katex/dist/katex.min.css";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import { AiPaperProposalCard } from "../../features/planning/planning-chat/AiPaperProposalCard";
import {
  parseAiPaperProposal,
  resolveAiPaperProposal,
} from "../../features/planning/planning-chat/aiPaperProposalModel";

export const MARKDOWN_RENDERER_VERSION = "katex-v1";

export interface MarkdownCitationSource {
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  citationLabel: string;
}

export interface MarkdownRendererProps {
  source: string;
  className?: string;
  sources?: MarkdownCitationSource[];
  onOpenReference?(documentId: string, page: number): void;
  questionBankQuestions?: IndexedQuestion[];
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
  onExportPaper?(questions: IndexedQuestion[], title?: string): void;
  /**
   * Kept for source compatibility with the previous renderer.
   * KaTeX emits HTML and MathML with a bundled stylesheet so desktop and web
   * previews share the same CSP-safe rendering path.
   */
  mathOutput?: "html" | "htmlAndMathml";
}

const markdownRemarkPlugins = [remarkGfm, remarkMath];
const markdownRehypePlugins = [
  [rehypeKatex, { strict: "ignore" }] as [
    typeof rehypeKatex,
    { strict: "ignore" },
  ],
];

const bareMathCommandPattern = /\\(?:[a-zA-Z]+|[,;:!?%]|\\)(?=[^a-zA-Z]|$)/;
const bareMathStructurePattern = /[=_^{}()[\]]|\\(?:begin|end)\{/;
const cjkTextPattern = /[\u3400-\u9fff]/;
const cjkTextBoundaryPattern = /[\u3400-\u9fff]/g;
const listPrefixPattern = /^(\s*(?:\d+[.)]|[-+*])\s+)([\s\S]+)$/;
const trailingMathPunctuationPattern =
  /([\s\u3001\u3002\uFF0C\uFF1B\uFF1A\uFF01\uFF1F,.!?]+)$/;
const quotedMathSpanPattern = /‘([^‘’\r\n]+)(?:’|‘)/g;

export function MarkdownRenderer({
  source,
  className,
  sources,
  onOpenReference,
  questionBankQuestions,
  onStartPaper,
  onExportPaper,
  mathOutput,
}: MarkdownRendererProps) {
  // The option remains accepted by callers that were written for the previous
  // renderer. The app uses one KaTeX output mode everywhere so desktop and web
  // previews cannot diverge because of separate renderer branches.
  void mathOutput;

  const normalizedSource = useMemo(() => {
    const withCitations = injectCitationLinks(source, sources);
    return normalizeMathDelimiters(withCitations);
  }, [source, sources]);

  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const safeHref =
          typeof href === "string" ? sanitizeMarkdownHref(href) : undefined;
        if (safeHref?.startsWith("citation:")) {
          const parts = safeHref.slice("citation:".length).split(":");
          const documentId = decodeURIComponent(parts[0] ?? "");
          const pageNumber = parseInt(parts[1] ?? "1", 10);
          return (
            <button
              type="button"
              className="markdown-citation-tag"
              onClick={(event) => {
                event.preventDefault();
                onOpenReference?.(documentId, pageNumber);
              }}
              title={`点击在资料库中打开第 ${pageNumber} 页`}
              aria-label={`在资料库中打开第 ${pageNumber} 页`}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                menu_book
              </span>
              <span>{children}</span>
            </button>
          );
        }
        return safeHref === undefined ? (
          <span>{children}</span>
        ) : (
          <a href={safeHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        const safeSrc =
          typeof src === "string" ? sanitizeMarkdownImageSrc(src) : undefined;
        return safeSrc === undefined ? (
          <span>{alt ?? ""}</span>
        ) : (
          <img
            src={safeSrc}
            alt={alt ?? "图片"}
            className="markdown-rendered-image"
            loading="lazy"
          />
        );
      },
      code({ className: codeClassName, children, ...props }) {
        const match = /language-([\w-]+)/.exec(codeClassName || "");
        const lang = match ? match[1] : undefined;
        if (lang === "kystudy-paper" || lang === "kystudy_paper") {
          const rawText = String(children).replace(/\n$/, "");
          const parsed = parseAiPaperProposal(rawText);
          if (parsed) {
            const resolved = resolveAiPaperProposal(
              parsed,
              questionBankQuestions ?? [],
            );
            return (
              <AiPaperProposalCard
                proposal={resolved}
                onStartPaper={onStartPaper}
                onExportPaper={onExportPaper}
              />
            );
          }
        }
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        );
      },
    }),
    [onOpenReference, onStartPaper, onExportPaper, questionBankQuestions],
  );

  return (
    <div
      data-renderer-version={MARKDOWN_RENDERER_VERSION}
      className={
        className === undefined
          ? "markdown-renderer"
          : `markdown-renderer ${className}`
      }
    >
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        skipHtml
        urlTransform={(url) => url}
        components={components}
      >
        {normalizedSource}
      </ReactMarkdown>
    </div>
  );
}

/**
 * remark-math follows the Markdown math convention (`$` and `$$`). AI
 * providers commonly return the equivalent TeX delimiters `\(...\)` and
 * `\[...\]`, so normalize those forms before the mature Markdown parser sees
 * them. Code fences are copied byte-for-byte and are never rewritten.
 */
export function normalizeMathDelimiters(source: string): string {
  const parts = source.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const normalizedDelimiters = normalizeProviderDisplayBlocks(
        normalizeProviderEscapes(part),
      )
        .replace(
          /\\\[([\s\S]*?)\\\]/g,
          (_match, expression: string) => `\n$$\n${expression.trim()}\n$$\n`,
        )
        .replace(
          /\\\(([\s\S]*?)\\\)/g,
          (_match, expression: string) => `$${expression.trim()}$`,
        );
      return normalizeBareMathLines(
        normalizeQuotedMathSpans(normalizedDelimiters),
      );
    })
    .join("");
}

/**
 * Provider responses often put a display-math delimiter on an indented line
 * (for example Markdown copied from a list item):
 *
 *     1. 说明
 *        \[
 *        x^2
 *        \]
 *        所以
 *
 * A global delimiter replacement leaves the opening marker attached to the
 * paragraph and remark-math then treats the following prose as part of the
 * formula. Normalize delimiter-only lines first so `$$` always occupies its
 * own Markdown line and the surrounding prose remains prose.
 */
function normalizeProviderDisplayBlocks(source: string): string {
  const lines = source.split(/\r?\n/);
  let insideDisplay = false;
  const normalized: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "\\[") {
      normalized.push("$$");
      insideDisplay = true;
      continue;
    }
    if (trimmed === "\\]") {
      normalized.push("$$");
      insideDisplay = false;
      continue;
    }
    if (insideDisplay) {
      // Remove only the provider's visual indentation. Keeping the expression
      // on its own line makes it render identically in the web preview and in
      // the desktop WebView, including when the source came from a list item.
      normalized.push(line.trim());
      continue;
    }
    normalized.push(line);
  }

  return normalized.join("\n");
}

/**
 * API payloads that have been JSON/string escaped twice may contain `\\vec`
 * or `\$x\$`. Recover only the escape forms that are unambiguously math
 * syntax; ordinary double backslashes used by aligned TeX line breaks remain
 * untouched.
 */
function normalizeProviderEscapes(source: string): string {
  let normalized = source;
  // A persisted history response may have crossed JSON and provider
  // transports more than once. Recover only syntax that is unambiguously
  // math, and repeat a small bounded number of times so older records with
  // two or three escape layers render the same as newly-created records.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = normalized
      .replace(/(?:\\)+\$/g, "$")
      .replace(/(?:\\){2,}(?=[a-zA-Z()[\]])/g, "\\");
    if (next === normalized) break;
    normalized = next;
  }
  return normalized;
}

/**
 * Some providers use Chinese single quotes as visual math delimiters, for
 * example `‘a/2‘` or `‘F(-x_0)=F(x_0)‘`. Convert only quote pairs that look
 * like expressions so ordinary quoted prose keeps its original meaning.
 */
function normalizeQuotedMathSpans(source: string): string {
  return source.replace(
    quotedMathSpanPattern,
    (match: string, expression: string) =>
      isLikelyQuotedMath(expression) ? `$${expression.trim()}$` : match,
  );
}

function isLikelyQuotedMath(expression: string): boolean {
  const trimmed = expression.trim();
  if (trimmed === "") return false;
  return (
    bareMathCommandPattern.test(trimmed) ||
    /[=_^{}()[\]]/.test(trimmed) ||
    /^[A-Za-z]\s*\/\s*(?:\d|[A-Za-z])/.test(trimmed)
  );
}

/**
 * AI providers occasionally omit Markdown math delimiters and return bare TeX
 * lines such as `\\vec n_1=(1,-1,0)` or `=\\frac{1}{2}`. Treat those lines as
 * display math while leaving normal prose, Markdown and code fences intact.
 */
function normalizeBareMathLines(source: string): string {
  const lines = source.split(/\r?\n/);
  const normalized: string[] = [];
  let insideDisplayMath = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const displayDelimiterCount = (line.match(/\$\$/g) ?? []).length;
    if (displayDelimiterCount > 0) {
      normalized.push(line);
      if (displayDelimiterCount % 2 === 1) {
        insideDisplayMath = !insideDisplayMath;
      }
      continue;
    }
    if (insideDisplayMath) {
      normalized.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "" || line.includes("`") || /\\(?:[()[\]])/.test(line)) {
      normalized.push(line);
      continue;
    }
    if (line.includes("$")) {
      normalized.push(normalizeBareMathInlineLine(line));
      continue;
    }

    const blockStart = line.match(/\\begin\{[a-zA-Z*]+\}/);
    if (blockStart !== null) {
      const blockLines = [line];
      let blockEndIndex = -1;
      for (
        let candidateIndex = index + 1;
        candidateIndex < lines.length;
        candidateIndex += 1
      ) {
        blockLines.push(lines[candidateIndex] ?? "");
        if (/\\end\{[a-zA-Z*]+\}/.test(lines[candidateIndex] ?? "")) {
          blockEndIndex = candidateIndex;
          break;
        }
      }
      if (blockEndIndex !== -1) {
        normalized.push("$$", ...blockLines, "$$");
        index = blockEndIndex;
        continue;
      }
    }

    normalized.push(normalizeBareMathLine(line));
  }

  return normalized.join("\n");
}

function normalizeBareMathInlineLine(line: string): string {
  const segments = line.split(/(\${1,2}[^$\r\n]*\${1,2})/g);
  return segments
    .map((segment, index) =>
      index % 2 === 1 ? segment : normalizeMixedMathLine(segment),
    )
    .join("");
}

function normalizeBareMathLine(line: string): string {
  const listMatch = line.match(listPrefixPattern);
  const listPrefix = listMatch?.[1] ?? "";
  const body = (listMatch?.[2] ?? line).replace(/^\\\\(?=[a-zA-Z])/, "\\");
  const normalizedLine = `${listPrefix}${body}`;
  if (!bareMathCommandPattern.test(normalizedLine)) return line;
  const hasCjkText = cjkTextPattern.test(body);
  const startsLikeMath = /^[\s]*[\\=+\-]/.test(body);
  if (!startsLikeMath && !bareMathStructurePattern.test(body)) return line;

  if (!hasCjkText) {
    const expression = body.trim();
    if (listPrefix !== "") return `${listPrefix}$${expression}$`;
    return `$$\n${expression}\n$$`;
  }

  return `${listPrefix}${normalizeMixedMathLine(body)}`;
}

function normalizeMixedMathLine(line: string): string {
  let cursor = 0;
  let normalized = "";
  for (const boundary of line.matchAll(cjkTextBoundaryPattern)) {
    const boundaryIndex = boundary.index ?? cursor;
    normalized += normalizeMixedMathSpan(line.slice(cursor, boundaryIndex));
    normalized += boundary[0];
    cursor = boundaryIndex + boundary[0].length;
  }
  return normalized + normalizeMixedMathSpan(line.slice(cursor));
}

function normalizeMixedMathSpan(span: string): string {
  if (!bareMathCommandPattern.test(span)) return span;
  const trimmed = span.trim();
  if (
    trimmed === "" ||
    trimmed.includes("$") ||
    (!/^[\\=+\-]/.test(trimmed) && !bareMathStructurePattern.test(trimmed))
  ) {
    return span;
  }
  const leadingWhitespace = span.slice(
    0,
    span.length - span.trimStart().length,
  );
  const trailingWhitespace = span.slice(span.trimEnd().length);
  const punctuationMatch = trimmed.match(trailingMathPunctuationPattern);
  const punctuation = punctuationMatch?.[1] ?? "";
  const expression =
    punctuation === ""
      ? trimmed
      : trimmed.slice(0, -punctuation.length).trimEnd();
  return `${leadingWhitespace}$${expression}$${punctuation}${trailingWhitespace}`;
}

/**
 * Compatibility helper for callers that used to consume the hand-written
 * parser's node array. The live component above is the single source of truth;
 * keeping this wrapper avoids forcing every caller to change at once.
 */
export function renderMarkdown(
  source: string,
  mathOutput: "html" | "htmlAndMathml" = "htmlAndMathml",
): ReactNode[] {
  return [
    <MarkdownRenderer
      key="markdown-renderer"
      source={source}
      mathOutput={mathOutput}
    />,
  ];
}

export function markdownToPlainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?|```$/g, ""),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\\\[|\\\]|\\\(|\\\)|\${1,2}/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function injectCitationLinks(
  source: string,
  sources?: MarkdownCitationSource[],
): string {
  if (!sources || sources.length === 0) return source;

  const sourceMap = new Map<string, MarkdownCitationSource>();
  sources.forEach((s, idx) => {
    sourceMap.set(s.citationLabel, s);
    const unbracketed = s.citationLabel.replace(/^\[|\]$/g, "");
    sourceMap.set(unbracketed, s);
    sourceMap.set(`[资料${idx + 1}]`, s);
    sourceMap.set(`资料${idx + 1}`, s);
    sourceMap.set(`[附件${idx + 1}]`, s);
    sourceMap.set(`附件${idx + 1}`, s);
  });

  const parts = source.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(
        /(?<!\[)\[(资料\d+|附件\d+)\](?!\()/g,
        (match, label) => {
          const matchedSource = sourceMap.get(match) ?? sourceMap.get(label);
          if (matchedSource) {
            return `[${match}](citation:${encodeURIComponent(matchedSource.documentId)}:${matchedSource.pageNumber})`;
          }
          return match;
        },
      );
    })
    .join("");
}

export function sanitizeMarkdownHref(value: string): string | undefined {
  const href = value.trim();
  if (href === "") return undefined;
  if (href.startsWith("citation:")) return href;
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

export function sanitizeMarkdownImageSrc(value: string): string | undefined {
  const src = value.trim();
  if (src === "") return undefined;
  if (
    src.startsWith("data:image/png;base64,") ||
    src.startsWith("data:image/jpeg;base64,") ||
    src.startsWith("data:image/webp;base64,") ||
    src.startsWith("data:image/gif;base64,") ||
    src.startsWith("data:image/svg+xml;base64,") ||
    src.startsWith("blob:")
  ) {
    return src;
  }
  try {
    const url = new URL(src, "https://kystudy.invalid");
    if (["https:", "http:"].includes(url.protocol)) {
      return src;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
