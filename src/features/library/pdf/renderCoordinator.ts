export interface CancelableRenderTask {
  readonly promise: Promise<unknown>;
  cancel(extraDelay?: number): void;
}

export class RenderCoordinator {
  private revision = 0;
  private current: CancelableRenderTask | undefined;

  async render(factory: () => CancelableRenderTask): Promise<boolean> {
    const revision = ++this.revision;
    const previous = this.current;
    previous?.cancel(0);
    if (previous !== undefined) {
      await ignoreCancellation(previous.promise);
    }
    if (revision !== this.revision) {
      return false;
    }
    const task = factory();
    this.current = task;
    try {
      await task.promise;
      return revision === this.revision;
    } catch (error) {
      if (isCancellation(error)) {
        return false;
      }
      throw error;
    } finally {
      if (this.current === task) {
        this.current = undefined;
      }
    }
  }

  async cancel(): Promise<void> {
    this.revision += 1;
    const task = this.current;
    this.current = undefined;
    task?.cancel(0);
    if (task !== undefined) {
      await ignoreCancellation(task.promise);
    }
  }
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RenderingCancelledException" ||
      error.message.includes("Rendering cancelled"))
  );
}

async function ignoreCancellation(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isCancellation(error)) {
      throw error;
    }
  }
}
