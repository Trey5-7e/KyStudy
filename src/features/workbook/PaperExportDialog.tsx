import { useState, type FormEvent } from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import { savePaperPdf } from "../../shared/tauri/paperExportClient";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { QuestionType } from "../../shared/tauri/questionClient";
import { captureQuestionRegionPng } from "../review/QuestionRegionCard";
import { PaperPdfPreview } from "./PaperPdfPreview";
import {
  loadPaperExportAnswerPreference,
  savePaperExportAnswerPreference,
} from "./paperExportPreferences";
import {
  layoutPaper,
  paperSectionHeadingImageId,
  paperSectionHeadingText,
} from "./paperExportLayout";
import {
  createPaperExportSnapshot,
  defaultPaperExportSettings,
  defaultPaperFileName,
  PaperExportValidationError,
  type PaperExportSettings,
} from "./paperExportModel";
import { createPaperPdf, type PaperPdfImage } from "./paperPdfWriter";

export function PaperExportDialog({
  questions,
  onClose,
  onSaved,
}: {
  questions: IndexedQuestion[];
  onClose(): void;
  onSaved(message: string): void;
}) {
  const [settings, setSettings] = useState<PaperExportSettings>(() => {
    const defaults = defaultPaperExportSettings();
    const remembered = loadPaperExportAnswerPreference();
    return remembered === undefined ? defaults : { ...defaults, ...remembered };
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PaperPdfPreviewState>();

  const update = <K extends keyof PaperExportSettings>(
    key: K,
    value: PaperExportSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const exportPdf = async (event: FormEvent) => {
    event.preventDefault();
    if (questions.length === 0 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const images: PaperPdfImage[] = [];
      const dimensions = new Map<string, { width: number; height: number }>();
      const total = questions.reduce(
        (count, question) => count + question.regions.length,
        0,
      );
      let completed = 0;
      for (const question of questions) {
        for (const region of [...question.regions].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        )) {
          completed += 1;
          setProgress(`正在生成第 ${completed}/${Math.max(total, 1)} 个题图`);
          let png: Uint8Array;
          try {
            png = await captureQuestionRegionPng(question.documentId, region);
          } catch (error: unknown) {
            const detail =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `PAPER_EXPORT_QUESTION:${question.questionNumber || question.id}:${detail}`,
            );
          }
          const jpeg = await pngToJpeg(png);
          images.push({ id: region.id, ...jpeg });
          dimensions.set(region.id, { width: jpeg.width, height: jpeg.height });
        }
      }
      images.push(
        ...(await createSectionHeadingImages(
          questions.map((question) => question.questionType),
        )),
      );
      setProgress("正在排版试卷…");
      const snapshot = createPaperExportSnapshot(
        questions,
        settings,
        dimensions,
      );
      const layout = layoutPaper(snapshot);
      const pdf = createPaperPdf(layout, images);
      setPreview({
        bytes: pdf,
        fileName: defaultPaperFileName(settings.title, settings.date),
        pageCount: layout.pageCount,
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      if (error instanceof PaperExportValidationError) {
        setMessage(
          error.issues
            .map((issue) => `${issue.message}${issue.action}`)
            .join(" "),
        );
      } else {
        const failedQuestion = /^PAPER_EXPORT_QUESTION:([^:]+):/.exec(
          text,
        )?.[1];
        setMessage(
          `导出失败${failedQuestion === undefined ? "" : `（第 ${failedQuestion} 题）`}：${text.includes("PAPER") ? "题图或 PDF 写出失败，请确认原 PDF 可读取后重试。" : text}`,
        );
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const savePreview = async () => {
    if (preview === undefined || busy) return;
    setBusy(true);
    setMessage("");
    setProgress("正在保存 PDF…");
    try {
      const saved = await savePaperPdf({
        fileName: preview.fileName,
        bytes: [...preview.bytes],
      });
      if (saved !== undefined) {
        onSaved(`已保存 ${saved.fileName}（${preview.pageCount} 页）`);
      }
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(
        `保存失败：${text.includes("PAPER") ? "PDF 写出失败，请重试。" : text}`,
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <EditorDialog
      title={preview === undefined ? "导出练习卷 PDF" : "预览练习卷 PDF"}
      dirty={false}
      onRequestClose={onClose}
      onRequestBack={
        preview === undefined ? onClose : () => setPreview(undefined)
      }
      backLabel={preview === undefined ? "返回练习卷" : "返回设置"}
      closeDisabled={busy}
      size={preview === undefined ? "medium" : "large"}
    >
      {preview === undefined ? (
        <form className="editor-form paper-export-dialog" onSubmit={exportPdf}>
          <label>
            解答题答题区
            <select
              value={`${settings.solutionLines}:${settings.answerStyle}`}
              disabled={busy}
              onChange={(event) => {
                const [lineValue, style] = event.target.value.split(":");
                const solutionLines = Number(lineValue);
                const answerStyle = style === "blank" ? "blank" : "lines";
                update("solutionLines", solutionLines);
                update("answerStyle", answerStyle);
                if (
                  solutionLines === 4 ||
                  solutionLines === 8 ||
                  solutionLines === 12
                ) {
                  savePaperExportAnswerPreference({
                    solutionLines,
                    otherLines: settings.otherLines === 4 ? 4 : 0,
                    answerStyle,
                  });
                }
              }}
            >
              <option value="4:lines">4 行横线</option>
              <option value="8:lines">8 行横线</option>
              <option value="12:lines">12 行横线</option>
              <option value="4:blank">4 行空白（无横线）</option>
              <option value="8:blank">8 行空白（无横线）</option>
              <option value="12:blank">12 行空白（无横线）</option>
            </select>
          </label>
          <label>
            其他题型答题区
            <select
              value={String(settings.otherLines === 4 ? 4 : 0)}
              disabled={busy}
              onChange={(event) => {
                const otherLines = Number(event.target.value) === 4 ? 4 : 0;
                update("otherLines", otherLines);
                if (
                  settings.solutionLines === 4 ||
                  settings.solutionLines === 8 ||
                  settings.solutionLines === 12
                ) {
                  savePaperExportAnswerPreference({
                    solutionLines: settings.solutionLines,
                    otherLines,
                    answerStyle: settings.answerStyle,
                  });
                }
              }}
            >
              <option value="0">不附加答题区</option>
              <option value="4">4 行答题区（跟随上方样式）</option>
            </select>
          </label>
          {progress === "" ? null : (
            <p className="form-hint" role="status">
              {progress}
            </p>
          )}
          {message === "" ? null : (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
            <EditorDialogCloseButton className="secondary-button">
              取消
            </EditorDialogCloseButton>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || questions.length === 0}
            >
              {busy ? "正在生成…" : "生成 PDF 预览"}
            </button>
          </EditorDialogFooter>
        </form>
      ) : (
        <div className="paper-export-preview-shell">
          <PaperPdfPreview bytes={preview.bytes} />
          {progress === "" ? null : (
            <p className="form-hint" role="status">
              {progress}
            </p>
          )}
          {message === "" ? null : (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
            <EditorDialogCloseButton className="secondary-button">
              返回设置
            </EditorDialogCloseButton>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void savePreview()}
            >
              {busy ? "正在保存…" : "确认并保存 PDF"}
            </button>
          </EditorDialogFooter>
        </div>
      )}
    </EditorDialog>
  );
}

interface PaperPdfPreviewState {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
}

async function createSectionHeadingImages(
  questionTypes: readonly QuestionType[],
): Promise<PaperPdfImage[]> {
  const uniqueTypes = [...new Set(questionTypes)];
  const images: PaperPdfImage[] = [];
  for (const questionType of uniqueTypes) {
    const width = 720;
    const height = 96;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("PAPER_EXPORT_SECTION_HEADING_RENDER_FAILED");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#111827";
    context.font =
      '700 40px "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", sans-serif';
    context.textBaseline = "middle";
    context.fillText(paperSectionHeadingText(questionType), 12, height / 2);
    images.push({
      id: paperSectionHeadingImageId(questionType),
      bytes: decodeDataUrl(canvas.toDataURL("image/jpeg", 0.95)),
      width,
      height,
    });
  }
  return images;
}

async function pngToJpeg(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1_600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("PAPER_EXPORT_IMAGE_DECODE_FAILED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return { bytes: decodeDataUrl(dataUrl), width, height };
  } finally {
    bitmap.close();
  }
}

function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("PAPER_EXPORT_IMAGE_ENCODE_FAILED");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
