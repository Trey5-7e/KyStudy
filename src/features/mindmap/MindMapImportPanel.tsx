import { useState, type FormEvent } from "react";

import type {
  MindMapDraftNode,
  MindMapImportDraft,
} from "../../shared/tauri/knowledgeClient";
import type { ResourceDocument } from "../../shared/tauri/resourceClient";

interface MindMapImportPanelProps {
  resources: ResourceDocument[];
  drafts: MindMapImportDraft[];
  busy: boolean;
  onRefresh(): void;
  onCreateDraft(documentId: string): void;
  onAcceptDraft(draftId: string): void;
  onRejectDraft(draftId: string): void;
}

interface DraftPreviewNodeProps {
  node: MindMapDraftNode;
}

const DRAFT_STATE_LABELS: Record<MindMapImportDraft["state"], string> = {
  generated: "等待确认",
  accepted: "已导入",
  rejected: "已拒绝",
};

export function MindMapImportPanel({
  resources,
  drafts,
  busy,
  onRefresh,
  onCreateDraft,
  onAcceptDraft,
  onRejectDraft,
}: MindMapImportPanelProps) {
  const sources = resources.filter(
    (resource) => resource.kind === "mindmap_source",
  );
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const effectiveSourceId = sources.some(
    (source) => source.id === selectedSourceId,
  )
    ? selectedSourceId
    : (sources[0]?.id ?? "");
  const selectedSource = sources.find(
    (source) => source.id === effectiveSourceId,
  );
  const isXMind = selectedSource?.mimeType === "application/x-xmind";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (effectiveSourceId !== "" && !isXMind) {
      onCreateDraft(effectiveSourceId);
    }
  };

  return (
    <section className="mindmap-import" aria-labelledby="mindmap-import-title">
      <div className="mindmap-import-heading">
        <div>
          <h3 id="mindmap-import-title">结构化导入草案</h3>
          <p>
            OPML 与 FreeMind .mm 会先转换为只读草案；只有确认后才写入正式导图。
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onRefresh}
        >
          刷新资料与草案
        </button>
      </div>

      <form className="mindmap-import-form" onSubmit={submit}>
        <label>
          已上传的导图源文件
          <select
            value={effectiveSourceId}
            disabled={busy || sources.length === 0}
            onChange={(event) => setSelectedSourceId(event.target.value)}
          >
            {sources.length === 0 ? (
              <option value="">请先在资料库上传 OPML 或 .mm</option>
            ) : null}
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || effectiveSourceId === "" || isXMind}
        >
          生成预览草案
        </button>
      </form>

      {isXMind ? (
        <p className="mindmap-import-notice" role="status">
          该文件是 XMind 原文件。当前不直接解压多版本 XMind 包，请先在 XMind
          中导出为 OPML 再上传。
        </p>
      ) : null}

      {drafts.length === 0 ? (
        <p className="mindmap-empty">还没有导入草案。</p>
      ) : (
        <div className="mindmap-draft-list">
          {drafts.map((draft) => (
            <article key={draft.id} className="mindmap-draft-card">
              <div className="mindmap-draft-heading">
                <div>
                  <strong>{draft.title}</strong>
                  <span>
                    {draft.sourceFormat === "opml" ? "OPML" : "FreeMind"} ·{" "}
                    {draft.nodeCount} 个节点 · {DRAFT_STATE_LABELS[draft.state]}
                  </span>
                </div>
                {draft.state === "generated" ? (
                  <div className="mindmap-draft-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAcceptDraft(draft.id)}
                    >
                      确认导入
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy}
                      onClick={() => onRejectDraft(draft.id)}
                    >
                      拒绝草案
                    </button>
                  </div>
                ) : null}
              </div>

              {draft.warnings.length === 0 ? null : (
                <ul className="mindmap-import-warnings">
                  {draft.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <details open={draft.state === "generated"}>
                <summary>查看树形预览</summary>
                <div className="mindmap-draft-preview">
                  <DraftPreviewNode node={draft.tree} />
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DraftPreviewNode({ node }: DraftPreviewNodeProps) {
  return (
    <div className="mindmap-draft-node">
      <strong>{node.title}</strong>
      {node.noteMarkdown === undefined ? null : <p>{node.noteMarkdown}</p>}
      {node.children.length === 0 ? null : (
        <div className="mindmap-draft-children">
          {node.children.map((child, index) => (
            <DraftPreviewNode key={`${child.title}-${index}`} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
