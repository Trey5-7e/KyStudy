import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PageEmpty,
  PageHeader,
  PageStatus,
  PageSurface,
} from "./PagePrimitives";

describe("PagePrimitives SSR contracts", () => {
  it("preserves header identity and both action slots", () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        id="today-heading"
        eyebrow="Today"
        title="Focus"
        description="One next action"
        actions={<button type="button">Start</button>}
        backAction={<a href="/library">Back</a>}
      />,
    );

    expect(markup).toContain('<header class="page-header">');
    expect(markup).toContain('id="today-heading" class="page-header-title"');
    expect(markup).toContain('class="page-header-actions"');
    expect(markup).toContain('class="page-header-back-action"');
    expect(markup).toContain(">Start</button>");
    expect(markup).toContain(">Back</a>");
  });

  it("keeps the surface element, label relationship, and variant class stable", () => {
    const markup = renderToStaticMarkup(
      <PageSurface as="div" labelledBy="resource-heading" variant="muted">
        <h2 id="resource-heading">Resources</h2>
      </PageSurface>,
    );

    expect(markup).toContain(
      '<div class="page-surface page-surface-muted" aria-labelledby="resource-heading">',
    );
    expect(markup).toContain('<h2 id="resource-heading">Resources</h2>');
  });

  it("exposes status role and live mode in server markup", () => {
    const assertive = renderToStaticMarkup(
      <PageStatus tone="info" title="Saved" live="assertive">
        Ready
      </PageStatus>,
    );
    expect(assertive).toContain(
      'data-tone="info" role="status" aria-live="assertive"',
    );

    const error = renderToStaticMarkup(
      <PageStatus tone="error">Failed</PageStatus>,
    );
    expect(error).toContain('data-tone="error" role="alert"');
    expect(error).not.toContain("aria-live=");

    const silent = renderToStaticMarkup(
      <PageStatus tone="info" live="off">
        Idle
      </PageStatus>,
    );
    expect(silent).not.toContain(" role=");
    expect(silent).not.toContain("aria-live=");
  });

  it("renders the requested empty heading level and optional announcement", () => {
    const markup = renderToStaticMarkup(
      <PageEmpty
        title="No resources"
        description="Add a resource to get started."
        action={<button type="button">Add</button>}
        headingLevel={3}
        announce
      />,
    );

    expect(markup).toContain(
      'class="empty-state page-empty" role="status" aria-live="polite"',
    );
    expect(markup).toContain("<h3>No resources</h3>");
    expect(markup).toContain("<p>Add a resource to get started.</p>");
    expect(markup).toContain('class="page-empty-action"');
  });
});
