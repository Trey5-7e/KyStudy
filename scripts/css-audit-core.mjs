const CLASS_NAME_PATTERN = /\.(-?[_a-zA-Z]+[\w-]*)/g;
const SOURCE_TOKEN_PATTERN = /[_a-zA-Z][\w-]*/g;
const DYNAMIC_CLASS_PREFIX_PATTERN = /([_a-zA-Z][\w-]*-)\$\{/g;

export const DEFAULT_UNUSED_LIMIT = 40;
export const DEFAULT_REPEATED_LIMIT = 20;

export function stripCssComments(css) {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

export function normalizeSelectorPrelude(prelude) {
  return prelude
    .trim()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*,\s*/g, ", ");
}

function findNextStructure(source, start, end) {
  let quote = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (parentheses === 0 && brackets === 0 && "{};".includes(character)) {
      return { character, index };
    }
  }

  return { character: null, index: end };
}

function findMatchingBrace(source, openIndex, end) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < end; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return end;
}

function collectClasses(prelude) {
  return [
    ...new Set(
      [...prelude.matchAll(CLASS_NAME_PATTERN)].map((match) => match[1]),
    ),
  ];
}

function isAtRulePrelude(prelude) {
  return prelude.startsWith("@");
}

function isMediaContext(context) {
  return context.some((entry) => /^@media\b/i.test(entry));
}

/**
 * Extract CSS style-rule records while retaining the enclosing at-rule scope.
 *
 * A record's `prelude` is normalized for insignificant whitespace, while its
 * `context` keeps normalized at-rule preludes. Exact duplicate detection can
 * therefore compare both values and avoid treating `.card:hover` or a media
 * override of `.card` as the same selector block.
 */
export function extractSelectorBlocks(css) {
  const source = stripCssComments(css);
  const records = [];

  function visitContainer(start, end, context) {
    let cursor = start;
    while (cursor < end) {
      const structure = findNextStructure(source, cursor, end);
      if (structure.character === null || structure.character === "}") {
        return;
      }
      if (structure.character === ";") {
        cursor = structure.index + 1;
        continue;
      }

      const prelude = normalizeSelectorPrelude(
        source.slice(cursor, structure.index),
      );
      const closeIndex = findMatchingBrace(source, structure.index, end);
      if (prelude.length > 0) {
        if (isAtRulePrelude(prelude)) {
          visitContainer(structure.index + 1, closeIndex, [
            ...context,
            prelude,
          ]);
        } else {
          records.push({
            classes: collectClasses(prelude),
            context: [...context],
            isMedia: isMediaContext(context),
            prelude,
          });
        }
      }
      cursor = closeIndex < end ? closeIndex + 1 : end;
    }
  }

  visitContainer(0, source.length, []);
  return records;
}

export function collectDynamicClassPrefixes(sourceText) {
  return [
    ...new Set(
      [...sourceText.matchAll(DYNAMIC_CLASS_PREFIX_PATTERN)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

export function collectSourceTokens(sourceText) {
  return new Set(
    [...sourceText.matchAll(SOURCE_TOKEN_PATTERN)].map((match) => match[0]),
  );
}

function selectorGroupKey(record) {
  return `${record.context.join("\u0000")}\u0001${record.prelude}`;
}

export function groupSelectorBlocks(selectorBlocks) {
  const groups = new Map();
  for (const record of selectorBlocks) {
    const key = selectorGroupKey(record);
    const group = groups.get(key);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(key, {
        context: [...record.context],
        isMedia: record.isMedia,
        prelude: record.prelude,
        records: [record],
      });
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    count: group.records.length,
  }));
}

function sortRepeatedGroups(left, right) {
  return (
    right.count - left.count ||
    left.prelude.localeCompare(right.prelude) ||
    left.context.join(" > ").localeCompare(right.context.join(" > "))
  );
}

export function analyzeCss(css, sourceText = "") {
  const selectorBlocks = extractSelectorBlocks(css);
  const definitions = new Map();
  for (const record of selectorBlocks) {
    for (const className of record.classes) {
      definitions.set(className, (definitions.get(className) ?? 0) + 1);
    }
  }

  const sourceTokens = collectSourceTokens(sourceText);
  const dynamicClassPrefixes = collectDynamicClassPrefixes(sourceText);
  const unusedCandidates = [...definitions.keys()]
    .filter(
      (className) =>
        !sourceTokens.has(className) &&
        !dynamicClassPrefixes.some((prefix) => className.startsWith(prefix)),
    )
    .sort();

  const selectorGroups = groupSelectorBlocks(selectorBlocks);
  const exactRepeatedSelectorPreludes = selectorGroups
    .filter((group) => group.count > 1)
    .sort(sortRepeatedGroups);
  const repeatedDefinitionCounts = new Map();
  for (const group of exactRepeatedSelectorPreludes) {
    for (const record of group.records) {
      for (const className of record.classes) {
        repeatedDefinitionCounts.set(
          className,
          (repeatedDefinitionCounts.get(className) ?? 0) + 1,
        );
      }
    }
  }
  const repeatedDefinitions = [...repeatedDefinitionCounts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([className, count]) => ({ className, count }));

  return {
    definitions,
    dynamicClassPrefixes,
    exactRepeatedSelectorPreludes,
    repeatedDefinitions,
    selectorBlocks,
    selectorGroups,
    sourceTokens,
    unusedCandidates,
  };
}

function formatScope(context) {
  return context.length === 0 ? "base" : context.join(" > ");
}

function formatOverflow(total, displayed) {
  return displayed < total
    ? `  ... ${total - displayed} more; use --all`
    : null;
}

export function formatAuditReport(
  result,
  {
    cssLabel = "src/app/app.css",
    showAll = false,
    unusedLimit = DEFAULT_UNUSED_LIMIT,
    repeatedLimit = DEFAULT_REPEATED_LIMIT,
  } = {},
) {
  const lines = [
    `CSS: ${cssLabel}`,
    `Defined classes: ${result.definitions.size}`,
    `Zero-source-reference candidates: ${result.unusedCandidates.length}`,
  ];
  const displayedUnusedCandidates = showAll
    ? result.unusedCandidates
    : result.unusedCandidates.slice(0, unusedLimit);
  for (const className of displayedUnusedCandidates) {
    lines.push(`  .${className}`);
  }
  const unusedOverflow = formatOverflow(
    result.unusedCandidates.length,
    displayedUnusedCandidates.length,
  );
  if (unusedOverflow) {
    lines.push(unusedOverflow);
  }

  lines.push(
    `Exact selector preludes repeated in the same scope: ${result.exactRepeatedSelectorPreludes.length}`,
    `Classes appearing in multiple selector blocks (exact prelude + scope): ${result.repeatedDefinitions.length}`,
  );
  const displayedRepeatedDefinitions = showAll
    ? result.repeatedDefinitions
    : result.repeatedDefinitions.slice(0, repeatedLimit);
  for (const { className, count } of displayedRepeatedDefinitions) {
    lines.push(`  .${className} (${count})`);
  }
  const repeatedOverflow = formatOverflow(
    result.repeatedDefinitions.length,
    displayedRepeatedDefinitions.length,
  );
  if (repeatedOverflow) {
    lines.push(repeatedOverflow);
  }

  if (showAll) {
    lines.push("Exact selector prelude details:");
    for (const group of result.exactRepeatedSelectorPreludes) {
      lines.push(
        `  ${group.prelude} [${formatScope(group.context)}] (${group.count})`,
      );
    }
  }

  lines.push(
    "Normal pseudo/descendant variants and different media scopes are not counted as exact repeats.",
    "Candidates require manual review: dynamic class names and third-party DOM may not appear as exact source strings.",
  );
  return lines.join("\n");
}
