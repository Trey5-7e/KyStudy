import { useState, type FormEvent } from "react";

import type {
  AddKnowledgeNodeResourceInput,
  KnowledgeMap,
  KnowledgeNode,
  KnowledgeNodeResource,
  MasteryState,
  UpdateKnowledgeMapInput,
  UpdateKnowledgeNodeInput,
} from "../../shared/tauri/knowledgeClient";
import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";

interface MindMapSettingsProps {
  map: KnowledgeMap;
  subjects: StudySubject[];
  busy: boolean;
  onSave(input: UpdateKnowledgeMapInput): Promise<boolean>;
}

interface MindMapNodeEditorProps {
  node: KnowledgeNode;
  isRoot: boolean;
  subjects: StudySubject[];
  resources: ResourceDocument[];
  links: KnowledgeNodeResource[];
  busy: boolean;
  onSave(input: UpdateKnowledgeNodeInput): Promise<boolean>;
  onDelete(): void;
  onAddResource(input: AddKnowledgeNodeResourceInput): Promise<boolean>;
  onDeleteResource(resourceId: string): void;
  onOpenResource(documentId: string, page?: number): void;
}

const MASTERY_OPTIONS: Array<{ value: MasteryState; label: string }> = [
  { value: "unknown", label: "未评估" },
  { value: "learning", label: "学习中" },
  { value: "weak", label: "薄弱" },
  { value: "stable", label: "稳定" },
];

export function MindMapSettings({
  map,
  subjects,
  busy,
  onSave,
}: MindMapSettingsProps) {
  const [title, setTitle] = useState(map.title);
  const [subjectId, setSubjectId] = useState(map.subjectId ?? "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      mapId: map.id,
      title,
      subjectId: subjectId === "" ? undefined : subjectId,
    });
  };

  return (
    <form className="mindmap-settings" onSubmit={(event) => void submit(event)}>
      <h3>导图信息</h3>
      <label>
        导图名称
        <input
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        默认科目
        <select
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          <option value="">未分类</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        保存导图信息
      </button>
    </form>
  );
}

export function MindMapNodeEditor({
  node,
  isRoot,
  subjects,
  resources,
  links,
  busy,
  onSave,
  onDelete,
  onAddResource,
  onDeleteResource,
  onOpenResource,
}: MindMapNodeEditorProps) {
  const [title, setTitle] = useState(node.title);
  const [noteMarkdown, setNoteMarkdown] = useState(node.noteMarkdown ?? "");
  const [masteryState, setMasteryState] = useState(node.masteryState);
  const [importance, setImportance] = useState(String(node.importance));
  const [subjectId, setSubjectId] = useState(node.subjectId ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(
    resources[0]?.id ?? "",
  );
  const [pageStart, setPageStart] = useState("");
  const [pageEnd, setPageEnd] = useState("");
  const [resourceNote, setResourceNote] = useState("");
  const [resourceError, setResourceError] = useState<string>();
  const effectiveDocumentId = resources.some(
    (resource) => resource.id === selectedDocumentId,
  )
    ? selectedDocumentId
    : (resources[0]?.id ?? "");
  const selectedResource = resources.find(
    (resource) => resource.id === effectiveDocumentId,
  );

  const submitNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      nodeId: node.id,
      title,
      noteMarkdown: optionalText(noteMarkdown),
      masteryState,
      importance: Number(importance),
      subjectId: subjectId === "" ? undefined : subjectId,
    });
  };

  const submitResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedResource === undefined) {
      return;
    }
    const hasStart = pageStart.trim() !== "";
    const hasEnd = pageEnd.trim() !== "";
    if (selectedResource.kind === "pdf" && hasStart !== hasEnd) {
      setResourceError("PDF 页码需要同时填写起始页和结束页，或同时留空。");
      return;
    }
    const start =
      selectedResource.kind === "pdf" && hasStart
        ? Number(pageStart)
        : undefined;
    const end =
      selectedResource.kind === "pdf" && hasEnd ? Number(pageEnd) : undefined;
    if (
      (start !== undefined && (!Number.isInteger(start) || start < 1)) ||
      (end !== undefined &&
        (!Number.isInteger(end) || end < (start ?? Number.MAX_SAFE_INTEGER)))
    ) {
      setResourceError("请填写有效的 PDF 页码范围。");
      return;
    }
    setResourceError(undefined);
    const saved = await onAddResource({
      nodeId: node.id,
      documentId: selectedResource.id,
      pageStart: start,
      pageEnd: end,
      note: optionalText(resourceNote),
    });
    if (saved) {
      setPageStart("");
      setPageEnd("");
      setResourceNote("");
    }
  };

  return (
    <div className="mindmap-node-editor">
      <form onSubmit={(event) => void submitNode(event)}>
        <h3>节点详情</h3>
        <label>
          标题
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          节点笔记
          <textarea
            rows={6}
            maxLength={10_000}
            placeholder="记录定义、易错点、推导过程或复习提醒"
            value={noteMarkdown}
            onChange={(event) => setNoteMarkdown(event.target.value)}
          />
        </label>
        <div className="mindmap-detail-row">
          <label>
            掌握状态
            <select
              value={masteryState}
              onChange={(event) =>
                setMasteryState(event.target.value as MasteryState)
              }
            >
              {MASTERY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            重要度
            <select
              value={importance}
              onChange={(event) => setImportance(event.target.value)}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          所属科目
          <select
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="">跟随导图或未分类</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mindmap-detail-actions">
          <button type="submit" disabled={busy}>
            保存节点
          </button>
          {isRoot ? null : confirmDelete ? (
            <div className="mindmap-delete-confirmation">
              <span>会删除这个节点及其全部子节点。</span>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={onDelete}
              >
                确认删除
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              删除子树
            </button>
          )}
        </div>
      </form>

      <section
        className="mindmap-resource-links"
        aria-labelledby="node-link-title"
      >
        <h4 id="node-link-title">关联资料</h4>
        {links.length === 0 ? (
          <p className="mindmap-empty">这个节点还没有关联资料。</p>
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link.id}>
                <div>
                  <strong>{link.documentTitle}</strong>
                  {link.pageStart === undefined ? null : (
                    <span>
                      第 {link.pageStart}
                      {link.pageEnd === link.pageStart
                        ? ""
                        : `-${link.pageEnd}`}{" "}
                      页
                    </span>
                  )}
                  {link.note === undefined ? null : <p>{link.note}</p>}
                </div>
                <div className="mindmap-link-actions">
                  {resources.some(
                    (resource) =>
                      resource.id === link.documentId &&
                      (resource.kind === "pdf" || resource.kind === "image"),
                  ) ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        onOpenResource(link.documentId, link.pageStart)
                      }
                    >
                      打开资料
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() => onDeleteResource(link.id)}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mindmap-resource-form"
          onSubmit={(event) => void submitResource(event)}
        >
          <label>
            本地资料
            <select
              value={effectiveDocumentId}
              disabled={resources.length === 0}
              onChange={(event) => {
                setSelectedDocumentId(event.target.value);
                setPageStart("");
                setPageEnd("");
              }}
            >
              {resources.length === 0 ? (
                <option value="">请先上传资料</option>
              ) : null}
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.title}
                </option>
              ))}
            </select>
          </label>
          {selectedResource?.kind === "pdf" ? (
            <div className="mindmap-detail-row">
              <label>
                起始页（可选）
                <input
                  type="number"
                  min={1}
                  value={pageStart}
                  onChange={(event) => setPageStart(event.target.value)}
                />
              </label>
              <label>
                结束页（可选）
                <input
                  type="number"
                  min={1}
                  value={pageEnd}
                  onChange={(event) => setPageEnd(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <label>
            关联说明
            <input
              maxLength={1000}
              placeholder="例如：第 3 章例题与这个节点对应"
              value={resourceNote}
              onChange={(event) => setResourceNote(event.target.value)}
            />
          </label>
          {resourceError === undefined ? null : (
            <p className="mindmap-form-error" role="alert">
              {resourceError}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || selectedResource === undefined}
          >
            添加关联
          </button>
        </form>
      </section>
    </div>
  );
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
