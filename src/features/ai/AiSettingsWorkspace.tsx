import { PageHeader } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import { AiFoundationPanel } from "./AiFoundationPanel";
import "../ai-chat/ai-workspace.css";

export interface AiSettingsWorkspaceProps {
  onOpenChat(): void;
}

export function AiSettingsWorkspace({ onOpenChat }: AiSettingsWorkspaceProps) {
  return (
    <div className="ai-settings-page">
      <PageHeader
        title="模型与 API"
        actions={
          <Button onClick={onOpenChat}>
            <span aria-hidden="true">＋</span> 新建 AI 对话
          </Button>
        }
      />

      <div className="ai-settings-workspace-grid">
        <AiFoundationPanel inlineManagement />
      </div>
    </div>
  );
}
