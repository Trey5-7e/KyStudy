import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "./Field";
import { Input } from "./Input";

describe("Field", () => {
  it("associates descriptions and errors with its control", () => {
    const markup = renderToStaticMarkup(
      <Field
        label="名称"
        htmlFor="name"
        description="用于列表显示"
        error="名称不能为空"
      >
        <Input id="name" />
      </Field>,
    );

    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    for (const id of describedBy?.split(" ") ?? []) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('aria-invalid="true"');
  });

  it("preserves an explicit control description", () => {
    const markup = renderToStaticMarkup(
      <Field label="名称" description="补充说明">
        <Input aria-describedby="external-help" />
      </Field>,
    );

    expect(markup).toMatch(/aria-describedby="external-help [^"]+"/);
    const controlId = markup.match(/<input[^>]+id="([^"]+)"/)?.[1];
    expect(controlId).toBeDefined();
    expect(markup).toContain(`for="${controlId}"`);
  });
});
