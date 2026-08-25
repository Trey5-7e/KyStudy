import { describe, it, vi } from "vitest";
import fs from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

vi.mock("../library/pdf/pdfEngine", () => ({ openPdf: vi.fn() }));
vi.mock("../library/pdf/rangeSource", () => ({
  HttpRangeSource: class HttpRangeSource {},
}));
vi.mock("../../shared/tauri/resourceClient", () => ({
  buildResourceProtocolUrl: vi.fn(() => "kystudy-pdf://test"),
}));

import { openPdf } from "../library/pdf/pdfEngine";
import { analyzeWorkbookPdf } from "./pdfQuestionIndexer";
import { resolveWorkbookPdfProfile } from "./workbookPdfProfiles";

describe("audit all 6 workbooks", () => {
  const samples = [
    {
      title: "【A4留白】李永乐660高数篇做题本.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/660/【A4留白】李永乐660高数篇做题本.pdf",
    },
    {
      title: "【A4留白版】基础过关660线概篇.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/660/【A4留白版】基础过关660线概篇.pdf",
    },
    {
      title: "880数一高数篇做题本.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/880/880数一高数篇做题本.pdf",
    },
    {
      title: "880数一线概篇做题本.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/880/880数一线概篇做题本.pdf",
    },
    {
      title: "【A4带空】27李艳芳900题数一高数题本.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/李艳芳900/【A4带空】27李艳芳900题数一高数题本.pdf",
    },
    {
      title: "【A4带空】27李艳芳900题数一线代概率题本.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/李艳芳900/【A4带空】27李艳芳900题数一线代概率题本.pdf",
    },
    {
      title: "【A4基础强化合并】1000题数一高数篇.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/1000题/【A4基础强化合并】1000题数一高数篇.pdf",
    },
    {
      title: "【A4基础强化合并】1000题数一线概篇.pdf",
      path: "C:/Users/Administrator/Desktop/考研/数学/1000题/【A4基础强化合并】1000题数一线概篇.pdf",
    },
  ];

  for (const [sampleIndex, s] of samples.entries()) {
    it(`audits ${s.title}`, async () => {
      if (!fs.existsSync(s.path)) return;
      const bytes = new Uint8Array(fs.readFileSync(s.path));
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      vi.mocked(openPdf).mockResolvedValueOnce({
        document: doc as never,
        destroy: async () => undefined,
      });
      const profile = resolveWorkbookPdfProfile(s.title);

      const results = await analyzeWorkbookPdf(
        {
          documentId: `audit-${sampleIndex}`,
          title: s.title,
          kind: "pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.byteLength,
          pageCount: doc.numPages,
        },
        () => undefined,
        { profile },
      );

      let totalQ = 0;
      let totalDupes = 0;
      let totalZeros = 0;
      const issues: string[] = [];

      for (const subj of results) {
        totalQ += subj.questions.length;
        const groups = new Map<string, typeof subj.questions>();
        for (const q of subj.questions) {
          if (q.questionNumber === "0") totalZeros++;
          const key = `${subj.suggestedName} > ${q.chapter} [${q.sectionPart}] [${q.questionType}]`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(q);
        }

        for (const [key, qList] of groups.entries()) {
          const nums = qList.map((q) => q.questionNumber);
          const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
          if (dupes.length > 0) {
            totalDupes += dupes.length;
            const uniqueDupes = [...new Set(dupes)];
            issues.push(
              `DUPES in ${key}: [${uniqueDupes.join(", ")}] (pages ${Math.min(...qList.map((q) => q.regions[0]?.pageNumber ?? 0))}-${Math.max(...qList.map((q) => q.regions[0]?.pageNumber ?? 0))})`,
            );
          }
        }
      }

      console.log(
        `\n[AUDIT_SUMMARY] ${s.title} -> Total Questions: ${totalQ}, Subjects: ${results.map((r) => `${r.suggestedName}(${r.questions.length})`).join(", ")}, Dupes: ${totalDupes}, Zeros: ${totalZeros}, Issues: ${issues.length}`,
      );
      if (issues.length > 0) {
        for (const iss of issues) {
          console.log(`  - ${iss}`);
        }
      }
    }, 60000);
  }
});
