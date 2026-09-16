import type { BadgeTone } from "../../shared/ui/Badge";

export interface MistakeTagMeta {
  id: string;
  label: string;
  tone: BadgeTone;
  description: string;
}

export const PRESET_MISTAKE_TAGS: readonly MistakeTagMeta[] = [
  {
    id: "calc_error",
    label: "计算失误",
    tone: "danger",
    description: "计算粗心、符号弄错或代数化简出错",
  },
  {
    id: "concept_blur",
    label: "概念模糊",
    tone: "warning",
    description: "基本概念、定理性质或前提条件理解不清",
  },
  {
    id: "stuck_approach",
    label: "思路卡壳",
    tone: "info",
    description: "缺乏解题切入点或经典辅助方法受阻",
  },
  {
    id: "misread_cond",
    label: "审题不清",
    tone: "warning",
    description: "遗漏隐含条件或误读题干设问",
  },
  {
    id: "formula_wrong",
    label: "公式记错",
    tone: "danger",
    description: "定理公式记忆混乱或套用错误",
  },
  {
    id: "classic_problem",
    label: "典型好题",
    tone: "success",
    description: "方法典型精妙、极具代表性与启发性",
  },
  {
    id: "must_review",
    label: "考前必刷",
    tone: "info",
    description: "高频失分盲点、考前冲刺重点过一遍",
  },
  {
    id: "must_do",
    label: "必做",
    tone: "danger",
    description: "习题重点核心必做题，优先攻克",
  },
  {
    id: "optional_do",
    label: "选做",
    tone: "info",
    description: "机动或拔高拓展选做题，按需练习",
  },
];

export const MISTAKE_TAGS_STORAGE_KEY =
  "kystudy.mistake_notebook.question_tags";
export const MISTAKE_CUSTOM_TAGS_STORAGE_KEY =
  "kystudy.mistake_notebook.custom_tags";
export const MISTAKE_TAGS_CHANGED_EVENT = "kystudy:mistake_tags_changed";

/**
 * 获取指定标签的视觉 Tone（色彩）
 */
export function getMistakeTagTone(label: string): BadgeTone {
  const preset = PRESET_MISTAKE_TAGS.find((p) => p.label === label);
  if (preset) return preset.tone;
  return "neutral";
}

/**
 * 互斥重点标签映射（必做与选做互斥，绝不能同时存在）
 */
export function getConflictingPriorityTag(label: string): string | undefined {
  if (label === "必做") return "选做";
  if (label === "选做") return "必做";
  return undefined;
}

/**
 * 清洗题目标签数组：
 * 1. 过滤空值与非法类型并去重；
 * 2. 保证“必做”与“选做”互斥，绝不同时存在：
 *    - 若指定了 preferredTag（如用户刚操作添加的标签），则保留 preferredTag，移除其对立标签；
 *    - 若未指定且同时包含两者，则保留数组中较后出现的那一个（即最新赋予的标签），移除较早的那个。
 */
export function sanitizeQuestionTags(
  tags: readonly string[],
  preferredTag?: string,
): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }

  const hasMust = list.includes("必做");
  const hasOptional = list.includes("选做");
  if (hasMust && hasOptional) {
    let removeTag: string;
    if (preferredTag === "必做") {
      removeTag = "选做";
    } else if (preferredTag === "选做") {
      removeTag = "必做";
    } else {
      const mustIndex = list.lastIndexOf("必做");
      const optIndex = list.lastIndexOf("选做");
      removeTag = mustIndex > optIndex ? "选做" : "必做";
    }
    return list.filter((t) => t !== removeTag);
  }

  return list;
}

/**
 * 加载所有题目的标签映射表 { [questionId]: string[] }
 * 自动对历史遗留数据进行清洗自愈，若发现“必做”与“选做”共存等冲突脏数据，自动写回 localStorage
 */
export function loadAllQuestionTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(MISTAKE_TAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, string[]> = {};
    let hasChanges = false;
    for (const [qid, tags] of Object.entries(parsed)) {
      if (Array.isArray(tags)) {
        const rawList = tags.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        );
        const cleaned = sanitizeQuestionTags(rawList);
        if (cleaned.length > 0) {
          result[qid] = cleaned;
        }
        if (
          cleaned.length !== rawList.length ||
          cleaned.some((t, i) => t !== rawList[i])
        ) {
          hasChanges = true;
        }
      }
    }
    if (hasChanges) {
      try {
        localStorage.setItem(MISTAKE_TAGS_STORAGE_KEY, JSON.stringify(result));
      } catch {
        // ignore
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 加载所有自定义标签列表
 */
export function loadCustomTags(): string[] {
  try {
    const raw = localStorage.getItem(MISTAKE_CUSTOM_TAGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * 保存题目标签映射表
 */
export function saveAllQuestionTags(tagsMap: Record<string, string[]>): void {
  try {
    const sanitizedMap: Record<string, string[]> = {};
    for (const [qid, tags] of Object.entries(tagsMap)) {
      if (Array.isArray(tags)) {
        const cleaned = sanitizeQuestionTags(tags);
        if (cleaned.length > 0) {
          sanitizedMap[qid] = cleaned;
        }
      }
    }
    localStorage.setItem(
      MISTAKE_TAGS_STORAGE_KEY,
      JSON.stringify(sanitizedMap),
    );
    dispatchMistakeTagsChanged();
  } catch {
    // ignore
  }
}

/**
 * 保存自定义标签列表
 */
export function saveCustomTags(customTags: string[]): void {
  try {
    const unique = Array.from(new Set(customTags.map((t) => t.trim()))).filter(
      Boolean,
    );
    localStorage.setItem(
      MISTAKE_CUSTOM_TAGS_STORAGE_KEY,
      JSON.stringify(unique),
    );
    dispatchMistakeTagsChanged();
  } catch {
    // ignore
  }
}

/**
 * 获取题库中当前所有可用标签（预设标签 + 用户添加的自定义标签）
 */
export function getAllAvailableTags(customTags?: readonly string[]): string[] {
  const presets = PRESET_MISTAKE_TAGS.map((t) => t.label);
  const custom = customTags ?? loadCustomTags();
  return Array.from(new Set([...presets, ...custom]));
}

/**
 * 获取单道题目的标签列表
 */
export function getQuestionTags(
  questionId: string,
  tagsMap?: Record<string, string[]>,
): string[] {
  const map = tagsMap ?? loadAllQuestionTags();
  return map[questionId] ?? [];
}

/**
 * 为单道题目添加标签（如为新自定义标签同时沉淀至自定义标签库）
 */
export function addTagToQuestion(
  questionId: string,
  tag: string,
): Record<string, string[]> {
  const trimmed = tag.trim();
  if (!trimmed) return loadAllQuestionTags();

  const map = loadAllQuestionTags();
  const current = map[questionId] ?? [];
  const conflicting = getConflictingPriorityTag(trimmed);
  const base =
    conflicting !== undefined
      ? current.filter((t) => t !== conflicting)
      : current;

  if (!base.includes(trimmed) || base.length !== current.length) {
    map[questionId] = sanitizeQuestionTags([...base, trimmed], trimmed);
    saveAllQuestionTags(map);
  }

  if (!PRESET_MISTAKE_TAGS.some((p) => p.label === trimmed)) {
    const customs = loadCustomTags();
    if (!customs.includes(trimmed)) {
      saveCustomTags([...customs, trimmed]);
    }
  }

  return map;
}

/**
 * 移除单道题目的指定标签
 */
export function removeTagFromQuestion(
  questionId: string,
  tag: string,
): Record<string, string[]> {
  const map = loadAllQuestionTags();
  const current = map[questionId] ?? [];
  if (current.includes(tag)) {
    const updated = current.filter((t) => t !== tag);
    if (updated.length > 0) {
      map[questionId] = updated;
    } else {
      delete map[questionId];
    }
    saveAllQuestionTags(map);
  }
  return map;
}

/**
 * 批量为多道题目添加一组标签
 */
export function batchAddTagsToQuestions(
  questionIds: Iterable<string>,
  tags: string[],
): Record<string, string[]> {
  const validTags = sanitizeQuestionTags(tags);
  if (validTags.length === 0) return loadAllQuestionTags();

  const map = loadAllQuestionTags();
  for (const qid of questionIds) {
    const current = map[qid] ?? [];
    let merged = current;
    for (const tag of validTags) {
      const conflicting = getConflictingPriorityTag(tag);
      if (conflicting !== undefined) {
        merged = merged.filter((t) => t !== conflicting);
      }
    }
    const cleanList = sanitizeQuestionTags([...merged, ...validTags]);
    if (cleanList.length > 0) {
      map[qid] = cleanList;
    } else {
      delete map[qid];
    }
  }
  saveAllQuestionTags(map);

  const newCustoms = validTags.filter(
    (t) => !PRESET_MISTAKE_TAGS.some((p) => p.label === t),
  );
  if (newCustoms.length > 0) {
    const customs = loadCustomTags();
    saveCustomTags([...customs, ...newCustoms]);
  }

  return map;
}

/**
 * 批量为多道题目移除一组标签
 */
export function batchRemoveTagsFromQuestions(
  questionIds: Iterable<string>,
  tags: string[],
): Record<string, string[]> {
  const removeSet = new Set(tags);
  if (removeSet.size === 0) return loadAllQuestionTags();

  const map = loadAllQuestionTags();
  for (const qid of questionIds) {
    const current = map[qid] ?? [];
    const filtered = current.filter((t) => !removeSet.has(t));
    if (filtered.length > 0) {
      map[qid] = filtered;
    } else {
      delete map[qid];
    }
  }
  saveAllQuestionTags(map);
  return map;
}

/**
 * 派发标签变更全局事件，驱动多组件实时刷新
 */
export function dispatchMistakeTagsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MISTAKE_TAGS_CHANGED_EVENT));
  }
}

/**
 * 订阅标签变更事件
 */
export function subscribeMistakeTagsChanged(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MISTAKE_TAGS_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener(MISTAKE_TAGS_CHANGED_EVENT, callback);
  };
}
