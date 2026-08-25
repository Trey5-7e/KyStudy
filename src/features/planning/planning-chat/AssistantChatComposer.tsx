import { ComposerPrimitive } from "@assistant-ui/react";
import {
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type RefObject,
} from "react";

import {
  extractLocalFileContent,
  type LocalComposerFile,
} from "./localFileExtract";

interface AssistantChatComposerProps {
  directMode?: boolean;
  busy: boolean;
  attachmentCount: number;
  attachmentsOpen: boolean;
  images?: string[];
  localFiles?: LocalComposerFile[];
  onImagesChange?(images: string[]): void;
  onLocalFilesChange?(files: LocalComposerFile[]): void;
  onToggleAttachments(): void;
  submitButtonRef?: RefObject<HTMLButtonElement | null>;
}

export function AssistantChatComposer({
  directMode = false,
  busy,
  attachmentCount,
  attachmentsOpen,
  images = [],
  localFiles = [],
  onImagesChange,
  onLocalFilesChange,
  onToggleAttachments,
  submitButtonRef,
}: AssistantChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | File[]) => {
    const currentImages = images;
    const currentFiles = localFiles;

    const remainingImageSlots = 6 - currentImages.length;
    const remainingFileSlots = 4 - currentFiles.length;

    const rawFiles = Array.from(fileList);
    const imageFiles = rawFiles
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, remainingImageSlots));
    const docFiles = rawFiles
      .filter((file) => !file.type.startsWith("image/"))
      .slice(0, Math.max(0, remainingFileSlots));

    if (imageFiles.length > 0) {
      const loaded = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<string | undefined>((resolve) => {
              if (file.size > 4 * 1024 * 1024) {
                resolve(undefined);
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                resolve(
                  typeof reader.result === "string" ? reader.result : undefined,
                );
              reader.onerror = () => resolve(undefined);
              reader.readAsDataURL(file);
            }),
        ),
      );
      const validImages = loaded.filter(
        (url): url is string => url !== undefined,
      );
      if (validImages.length > 0 && onImagesChange) {
        onImagesChange([...currentImages, ...validImages].slice(0, 6));
      }
    }

    if (docFiles.length > 0) {
      const extractedDocs = await Promise.all(
        docFiles.map((file) => extractLocalFileContent(file)),
      );
      const validDocs = extractedDocs.filter(
        (doc): doc is LocalComposerFile => doc !== undefined,
      );
      if (validDocs.length > 0 && onLocalFilesChange) {
        onLocalFilesChange([...currentFiles, ...validDocs].slice(0, 4));
      }
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item) {
        const file = item.getAsFile();
        if (file) {
          pastedFiles.push(file);
        }
      }
    }

    if (pastedFiles.length > 0) {
      void handleFiles(pastedFiles);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    if (busy) return;
    if (event.dataTransfer?.files) {
      void handleFiles(event.dataTransfer.files);
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void handleFiles(files);
      event.target.value = "";
    }
  };

  const removeImage = (indexToRemove: number) => {
    if (onImagesChange) {
      onImagesChange(images.filter((_, index) => index !== indexToRemove));
    }
  };

  const removeLocalFile = (indexToRemove: number) => {
    if (onLocalFilesChange) {
      onLocalFilesChange(
        localFiles.filter((_, index) => index !== indexToRemove),
      );
    }
  };

  const totalLocalItems = images.length + localFiles.length;

  return (
    <ComposerPrimitive.Root className="aui-chat-composer-root">
      <div
        className="aui-chat-composer-input-wrap"
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.txt,.md,.json"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />
        {images.length > 0 && (
          <div className="aui-chat-composer-images" aria-label="已附加图片预览">
            {images.map((url, index) => (
              <div key={index} className="aui-chat-composer-image-item">
                <img
                  src={url}
                  alt={`附加图片 ${index + 1}`}
                  className="aui-chat-composer-image-thumb"
                />
                <button
                  type="button"
                  className="aui-chat-composer-image-remove"
                  onClick={() => removeImage(index)}
                  aria-label={`移除图片 ${index + 1}`}
                  title="移除图片"
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    close
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        {localFiles.length > 0 && (
          <div className="aui-chat-composer-files" aria-label="已附加本地文件">
            {localFiles.map((file, index) => (
              <span key={index} className="aui-chat-composer-file-chip">
                <span className="material-symbols-rounded" aria-hidden="true">
                  description
                </span>
                <span className="aui-chat-file-name" title={file.name}>
                  {file.name}
                </span>
                {file.pageCount ? (
                  <span className="aui-chat-file-pages">
                    ({file.pageCount}页{file.isScanned ? " · 扫描件" : ""})
                  </span>
                ) : null}
                <button
                  type="button"
                  className="aui-chat-file-remove"
                  onClick={() => removeLocalFile(index)}
                  aria-label={`移除文件 ${file.name}`}
                  title="移除文件"
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    close
                  </span>
                </button>
              </span>
            ))}
          </div>
        )}
        <ComposerPrimitive.Input
          rows={3}
          maxLength={32_000}
          submitMode="enter"
          unstable_insertNewlineOnTouchEnter
          placeholder={
            directMode
              ? "输入消息或粘贴截图/拖入PDF，Enter 发送，Shift + Enter 换行"
              : "输入问题或粘贴截图/拖入PDF，Enter 生成预览，Shift + Enter 换行"
          }
          className="aui-chat-composer-input"
        />
        <div className="aui-chat-composer-toolbar">
          <div className="aui-chat-composer-tools">
            <button
              type="button"
              className="aui-chat-attachment-button"
              aria-expanded={attachmentsOpen}
              aria-controls="planning-chat-resources-dialog"
              onClick={onToggleAttachments}
              disabled={busy}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                folder_open
              </span>
              <span>
                软件资料{attachmentCount > 0 ? ` · ${attachmentCount}` : ""}
              </span>
            </button>
            <button
              type="button"
              className="aui-chat-attachment-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || totalLocalItems >= 10}
              title="添加电脑本地图片或 PDF 资料（临时分析，不存入资料库）"
              aria-label="添加本地图片或文件"
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                attach_file
              </span>
              <span>
                电脑文件
                {totalLocalItems > 0 ? ` · ${totalLocalItems}` : ""}
              </span>
            </button>
          </div>
          {directMode ? null : (
            <span className="aui-chat-composer-hint">
              本地预览 · 明确确认后外发
            </span>
          )}
          {busy ? (
            <ComposerPrimitive.Cancel className="aui-chat-composer-cancel">
              停止
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              ref={submitButtonRef}
              className="aui-chat-composer-send"
            >
              {directMode ? "发送" : "生成外发预览"}
            </ComposerPrimitive.Send>
          )}
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
