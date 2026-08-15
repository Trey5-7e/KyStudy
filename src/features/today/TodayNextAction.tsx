import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import type { CyclePlanItemAction } from "../planning/cyclePlanItemActions";
import { cyclePlanItemStateLabel } from "../planning/cyclePlanItemActions";
import type { CyclePlanItemState } from "../../shared/tauri/cyclePlanClient";
import type { TodayCycleItem } from "./todayOverviewParts";

export type TodayNextActionKind = "review" | "cycle" | "plan" | "workbook";

interface TodayNextActionProps {
  kind: TodayNextActionKind;
  reviewHasWork: boolean;
  generatedSchemes: number;
  reviewRemaining: number;
  reviewRestDay: boolean;
  reviewFinished: boolean;
  nextCycle?: TodayCycleItem;
  nextCycleAction?: CyclePlanItemAction;
  nextCycleLabel?: string;
  busyTaskId?: string;
  registerItemAction(itemId: string, node: HTMLButtonElement | null): void;
  onStartReview(openWindow: boolean): void;
  onUpdateCycleItemState(
    item: TodayCycleItem["item"],
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ): void;
  onOpenPlan(): void;
  onOpenWorkbook(): void;
}

export function TodayNextAction({
  kind,
  reviewHasWork,
  generatedSchemes,
  reviewRemaining,
  reviewRestDay,
  reviewFinished,
  nextCycle,
  nextCycleAction,
  nextCycleLabel,
  busyTaskId,
  registerItemAction,
  onStartReview,
  onUpdateCycleItemState,
  onOpenPlan,
  onOpenWorkbook,
}: TodayNextActionProps) {
  return (
    <section
      className="today-next-action"
      aria-labelledby="today-next-action-title"
      aria-busy={busyTaskId !== undefined}
    >
      <div className="today-next-action-copy">
        <Badge tone={reviewHasWork ? "warning" : "info"}>下一项</Badge>
        {kind === "review" ? (
          <>
            <h2 id="today-next-action-title">今日错题复习</h2>
            <p>
              {generatedSchemes === 0
                ? `有 ${reviewRemaining} 道错题等待开始。`
                : `还有 ${reviewRemaining} 道错题待复习。`}
            </p>
          </>
        ) : kind === "cycle" && nextCycle !== undefined ? (
          <>
            <h2 id="today-next-action-title">
              {nextCycle.overview.plan.name} · 第 {nextCycle.item.unitIndex}{" "}
              {nextCycle.overview.plan.unitLabel}
            </h2>
            <p>
              今日计划事项 · {cyclePlanItemStateLabel(nextCycle.item.state)}
            </p>
          </>
        ) : kind === "plan" ? (
          <>
            <h2 id="today-next-action-title">查看下一阶段计划</h2>
            <p>今天没有待完成事项，打开计划安排接下来的学习。</p>
          </>
        ) : (
          <>
            <h2 id="today-next-action-title">建立你的第一项学习任务</h2>
            <p>从习题册开始，完成练习后今日页会自动生成复习任务。</p>
          </>
        )}
      </div>
      <div className="today-next-action-cta">
        {kind === "review" ? (
          <Button
            variant="primary"
            size="lg"
            disabled={busyTaskId !== undefined}
            onClick={() => onStartReview(!reviewRestDay && !reviewFinished)}
          >
            {busyTaskId === "today-review"
              ? "正在准备…"
              : generatedSchemes === 0
                ? "开始今日错题"
                : "继续今日错题"}
          </Button>
        ) : kind === "cycle" &&
          nextCycle !== undefined &&
          nextCycleAction !== undefined ? (
          <Button
            ref={(node) => registerItemAction(nextCycle.item.id, node)}
            variant="primary"
            size="lg"
            disabled={busyTaskId !== undefined}
            aria-label={`${nextCycleAction.label}：${nextCycleLabel}`}
            onClick={(event) =>
              onUpdateCycleItemState(
                nextCycle.item,
                nextCycleAction.targetState,
                nextCycleLabel ?? "今日计划事项",
                event.currentTarget,
              )
            }
          >
            {busyTaskId === nextCycle.item.id
              ? "正在更新…"
              : nextCycleAction.label}
          </Button>
        ) : kind === "plan" ? (
          <Button variant="primary" size="lg" onClick={onOpenPlan}>
            打开计划
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={onOpenWorkbook}>
            打开习题册
          </Button>
        )}
      </div>
    </section>
  );
}
