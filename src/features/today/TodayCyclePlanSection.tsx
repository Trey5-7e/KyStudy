import { PageEmpty } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import type {
  CyclePlanCommandError,
  CyclePlanItem,
  CyclePlanItemState,
} from "../../shared/tauri/cyclePlanClient";
import {
  cyclePlanItemActions,
  cyclePlanItemStateLabel,
} from "../planning/cyclePlanItemActions";
import type { TodayCycleItem } from "./todayOverviewParts";

interface TodayCyclePlanSectionProps {
  items: readonly TodayCycleItem[];
  nextCycleId?: string;
  cyclePlanError?: CyclePlanCommandError;
  busyTaskId?: string;
  onOpenPlan(): void;
  registerItemAction(itemId: string, node: HTMLButtonElement | null): void;
  onUpdateCycleItemState(
    item: CyclePlanItem,
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ): void;
}

export function TodayCyclePlanSection({
  items,
  nextCycleId,
  cyclePlanError,
  busyTaskId,
  onOpenPlan,
  registerItemAction,
  onUpdateCycleItemState,
}: TodayCyclePlanSectionProps) {
  return (
    <section className="today-up-next" aria-labelledby="today-up-next-title">
      <SectionHeader
        id="today-up-next-title"
        title="接下来"
        actions={
          <Button variant="text" size="sm" onClick={onOpenPlan}>
            打开计划
          </Button>
        }
      />

      {cyclePlanError === undefined ? (
        items.length === 0 ? (
          <PageEmpty
            className="today-inline-empty"
            headingLevel={3}
            title="今天还没有计划事项"
            description="可以新建周期计划，或查看已有计划的后续安排。"
          />
        ) : (
          <ul className="today-up-next-list">
            {items.map(({ item, overview }) => {
              const done = item.state === "completed";
              const itemLabel = `${overview.plan.name}第 ${item.unitIndex} ${overview.plan.unitLabel}`;
              return (
                <li
                  key={item.id}
                  className={done ? "today-task-done" : undefined}
                  aria-current={nextCycleId === item.id ? "step" : undefined}
                >
                  <span className="today-task-marker" aria-hidden="true">
                    {done ? "✓" : item.state === "skipped" ? "—" : ""}
                  </span>
                  <div className="today-task-copy">
                    <strong>
                      {overview.plan.name} · 第 {item.unitIndex}{" "}
                      {overview.plan.unitLabel}
                    </strong>
                    <small>{cyclePlanItemStateLabel(item.state)}</small>
                  </div>
                  <div className="today-task-actions">
                    {cyclePlanItemActions(item.state).map((action, index) => (
                      <Button
                        key={action.targetState}
                        ref={
                          index === 0
                            ? (node) => registerItemAction(item.id, node)
                            : undefined
                        }
                        variant={index === 0 ? "secondary" : "ghost"}
                        size="sm"
                        disabled={busyTaskId !== undefined}
                        aria-label={`${action.label}：${itemLabel}`}
                        onClick={(event) =>
                          onUpdateCycleItemState(
                            item,
                            action.targetState,
                            itemLabel,
                            event.currentTarget,
                          )
                        }
                      >
                        {busyTaskId === item.id ? "正在更新…" : action.label}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <StatusBanner tone="error" title={cyclePlanError.message}>
          {cyclePlanError.action}
        </StatusBanner>
      )}
    </section>
  );
}
