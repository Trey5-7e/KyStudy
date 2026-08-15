import { PageEmpty } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import type { WorkspaceCommandError } from "../../shared/tauri/workspaceClient";

export type TodayOverviewStatusKind = "loading" | "missing-workspace" | "error";

interface TodayOverviewStatusProps {
  kind: TodayOverviewStatusKind;
  error?: WorkspaceCommandError;
  onOpenSettings(): void;
  onRetry(): void;
}

/** Keeps the non-ready states visually consistent and out of the data view. */
export function TodayOverviewStatus({
  kind,
  error,
  onOpenSettings,
  onRetry,
}: TodayOverviewStatusProps) {
  if (kind === "loading") {
    return (
      <section
        className="today-overview today-focus-view"
        aria-labelledby="today-title"
      >
        <SectionHeader
          id="today-title"
          title="今日"
          description="正在准备今天的学习内容…"
        />
        <StatusBanner tone="info" title="正在准备今天的学习内容…" />
      </section>
    );
  }

  if (kind === "missing-workspace") {
    return (
      <section
        className="today-overview today-focus-view"
        aria-labelledby="today-title"
      >
        <SectionHeader
          id="today-title"
          title="今日"
          description="创建工作区后，今日页会为你安排下一项学习任务。"
          actions={
            <Button variant="primary" onClick={onOpenSettings}>
              前往设置
            </Button>
          }
        />
        <PageEmpty
          title="先创建本地工作区"
          description="工作区用于在你的电脑上保存计划、习题册和错题。"
        />
      </section>
    );
  }

  if (error === undefined) {
    return null;
  }

  return (
    <section
      className="today-overview today-focus-view"
      aria-labelledby="today-title"
    >
      <SectionHeader
        id="today-title"
        title="今日"
        description="今天需要完成的计划和错题。"
        actions={
          <>
            <Button variant="primary" onClick={onRetry}>
              重新读取
            </Button>
            <Button variant="secondary" onClick={onOpenSettings}>
              打开设置
            </Button>
          </>
        }
      />
      <StatusBanner tone="error" title={error.message}>
        {error.action}
      </StatusBanner>
    </section>
  );
}
