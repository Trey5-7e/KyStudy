import { describe, expect, it } from "vitest";

import {
  RenderCoordinator,
  type CancelableRenderTask,
} from "./renderCoordinator";

describe("render coordinator", () => {
  it("cancels the active task before starting the latest render", async () => {
    const coordinator = new RenderCoordinator();
    const first = controlledTask();
    const second = controlledTask();
    const firstResult = coordinator.render(() => first.task);
    await Promise.resolve();
    const secondResult = coordinator.render(() => second.task);
    await Promise.resolve();
    second.resolve();

    await expect(firstResult).resolves.toBe(false);
    await expect(secondResult).resolves.toBe(true);
    expect(first.cancelCount()).toBe(1);
  });

  it("propagates a non-cancellation render failure", async () => {
    const coordinator = new RenderCoordinator();
    const failure = Promise.reject(new Error("GPU_CONTEXT_LOST"));

    await expect(
      coordinator.render(() => ({ promise: failure, cancel() {} })),
    ).rejects.toThrow("GPU_CONTEXT_LOST");
  });

  it("cancel resolves after the active render acknowledges cancellation", async () => {
    const coordinator = new RenderCoordinator();
    const active = controlledTask();
    const rendering = coordinator.render(() => active.task);
    await Promise.resolve();

    await coordinator.cancel();

    await expect(rendering).resolves.toBe(false);
    expect(active.cancelCount()).toBe(1);
  });
});

function controlledTask() {
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  let cancellations = 0;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const task: CancelableRenderTask = {
    promise,
    cancel() {
      cancellations += 1;
      const error = new Error("Rendering cancelled");
      error.name = "RenderingCancelledException";
      rejectPromise(error);
    },
  };
  return {
    task,
    resolve: resolvePromise,
    cancelCount: () => cancellations,
  };
}
