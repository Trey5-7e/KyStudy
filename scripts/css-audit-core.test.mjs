import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCss,
  extractSelectorBlocks,
  formatAuditReport,
} from "./css-audit-core.mjs";

test("extracts normalized selector records and at-rule scope", () => {
  const records = extractSelectorBlocks(`
    /* comments are not part of the selector */
    .card,
    .card-large { color: red; }
    .card:hover { color: blue; }
    @media (max-width: 600px) {
      .card { color: green; }
    }
  `);

  assert.deepEqual(
    records.map(({ prelude, context, classes, isMedia }) => ({
      classes,
      context,
      isMedia,
      prelude,
    })),
    [
      {
        classes: ["card", "card-large"],
        context: [],
        isMedia: false,
        prelude: ".card, .card-large",
      },
      {
        classes: ["card"],
        context: [],
        isMedia: false,
        prelude: ".card:hover",
      },
      {
        classes: ["card"],
        context: ["@media (max-width: 600px)"],
        isMedia: true,
        prelude: ".card",
      },
    ],
  );
});

test("only exact selector and scope repeats become duplicate candidates", () => {
  const result = analyzeCss(
    `
      .card { color: red; }
      .card:hover { color: blue; }
      .card { border: 1px solid; }
      @media (max-width: 600px) {
        .card { color: green; }
      }
    `,
    "const className = 'card';",
  );

  assert.deepEqual(
    result.exactRepeatedSelectorPreludes.map(({ prelude, context, count }) => ({
      context,
      count,
      prelude,
    })),
    [{ context: [], count: 2, prelude: ".card" }],
  );
  assert.deepEqual(result.repeatedDefinitions, [
    { className: "card", count: 2 },
  ]);
});

test("preserves exact source tokens and dynamic class prefixes", () => {
  const result = analyzeCss(
    `.known { color: red; } .status-loading { color: blue; } .unused { color: gray; }`,
    "const fixed = 'known'; const className = `status-" + "${state}`;",
  );

  assert.deepEqual(result.dynamicClassPrefixes, ["status-"]);
  assert.deepEqual(result.unusedCandidates, ["unused"]);
});

test("keeps default output concise and --all exposes every candidate", () => {
  const unusedCss = Array.from(
    { length: 45 },
    (_, index) => `.unused-${String(index).padStart(2, "0")} { color: red; }`,
  ).join("\n");
  const repeatedCss = Array.from(
    { length: 25 },
    (_, index) =>
      `.duplicate-${String(index).padStart(2, "0")} { color: red; }`,
  ).join("\n");
  const result = analyzeCss(`${unusedCss}\n${repeatedCss}\n${repeatedCss}`, "");

  const concise = formatAuditReport(result, { cssLabel: "fixture.css" });
  assert.match(concise, /\.unused-00/);
  assert.doesNotMatch(concise, /\.unused-44/);
  assert.match(concise, /\.\.\. 5 more; use --all/);
  assert.doesNotMatch(concise, /Exact selector prelude details:/);

  const complete = formatAuditReport(result, {
    cssLabel: "fixture.css",
    showAll: true,
  });
  assert.match(complete, /\.unused-44/);
  assert.match(complete, /Exact selector prelude details:/);
  assert.match(complete, /\.duplicate-24 \[base\] \(2\)/);
});
