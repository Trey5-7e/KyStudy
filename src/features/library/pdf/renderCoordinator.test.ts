import { describe, expect, it, vi } from "vitest";

import {
  RenderCoordinator,
  type CancelableRenderTask,
} from "./renderCoordinator";

describe("RenderCoordinator", () => {
  it("cancels the previous render before starting the next", async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    const first: CancelableRenderTask = {
      promise: new Promise((_, reject) => {
        rejectFirst = reject;
      }),
      cancel: vi.fn(() => {
        const error = new Error("Rendering cancelled");
        error.name = "RenderingCancelledException";
        rejectFirst(error);
      }),
    };
    const second: CancelableRenderTask = {
      promise: Promise.resolve(),
      cancel: vi.fn(),
    };
    const coordinator = new RenderCoordinator();
    const firstResult = coordinator.render(() => first);

    const secondResult = coordinator.render(() => second);

    await expect(firstResult).resolves.toBe(false);
    await expect(secondResult).resolves.toBe(true);
    expect(first.cancel).toHaveBeenCalledOnce();
  });
});
