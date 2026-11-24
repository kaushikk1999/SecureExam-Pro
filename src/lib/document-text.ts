import { strFromU8, unzipSync } from "fflate";

const MAX_EXTRACTED_TEXT = 200_000;

function decodeXmlEntities(value: string) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, code: string) => {
      if (code[0] === "#") {
        const point =
          code[1]?.toLowerCase() === "x"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return (
        { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
          code.toLowerCase()
        ] ?? entity
      );
    },
  );
}

export function extractDocxText(bytes: Uint8Array) {
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== "word/document.xml") return false;
      if (entry.originalSize > 2_000_000)
        throw new Error("The Word document text is too large to extract.");
      return true;
    },
  });
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("This Word document is invalid or empty.");

  return decodeXmlEntities(
    strFromU8(documentXml)
      .replace(/<w:tab\b[^>]*\/?\s*>/g, "\t")
      .replace(/<w:br\b[^>]*\/?\s*>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n\t/g, "\t")
      .replace(/[\t ]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  )
    .slice(0, MAX_EXTRACTED_TEXT)
    .trim();
}

export async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;

  if (document.numPages > 80) {
    await loadingTask.destroy();
    throw new Error(
      "This PDF has more than 80 pages; split it before uploading.",
    );
  }

  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = "";
        } else if (item.str && !item.str.endsWith(" ")) {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.join("\n"));
      page.cleanup();
      if (pages.join("\n\n").length > MAX_EXTRACTED_TEXT) break;
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages.join("\n\n").slice(0, MAX_EXTRACTED_TEXT).trim();
}

export type StructuredSourceQuestion = {
  sourceId: string;
  type:
    | "MCQ"
    | "TRUE_FALSE"
    | "FILL_BLANK"
    | "MATCHING"
    | "SHORT_ANSWER"
    | "CASE_STUDY"
    | "ESSAY";
  prompt: string;
  marks: number;
  options: string[];
};

/**
 * Question text is rendered as Markdown, which merges single line breaks.
 * Keep the paper's layout: tab-separated rows become a table and other line
 * breaks become hard breaks. The wording itself is unchanged.
 */
function promptMarkdown(text: string) {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].includes("\t")) {
      out.push(lines[index++]);
      continue;
    }
    const rows: string[][] = [];
    while (index < lines.length && lines[index].includes("\t"))
      rows.push(
        lines[index++]
          .split("\t")
          .map((cell) => cell.trim().replaceAll("|", "\\|")),
      );
    if (rows.length < 2) {
      out.push(rows[0].join("  "));
      continue;
    }
    const width = Math.max(...rows.map((row) => row.length));
    const cells = (row: string[]) =>
      `| ${[...row, ...Array(width - row.length).fill("")].join(" | ")} |`;
    out.push(
      "",
      cells(rows[0]),
      `| ${Array(width).fill("---").join(" | ")} |`,
      ...rows.slice(1).map(cells),
      "",
    );
  }
  return out
    .map((line, index) => {
      const next = out[index + 1];
      const isTable = (value?: string) => value?.trimStart().startsWith("|");
      return line.trim() && next?.trim() && !isTable(line) && !isTable(next)
        ? `${line}  `
        : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts clearly labeled questions without paraphrasing them. Ollama can
 * supply answer-key suggestions, but it must not change, merge, or reorder the
 * instructor's question text.
 */
export function extractStructuredQuestions(source: string) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    // Keep the number in a "Question 2" label attached to its prefix during
    // the packed-text split below; otherwise it can split as a bare "2".
    .replace(
      /\b((?:QUESTION|Q)\s*(?:NO\.?\s*)?#?)\s*(?=[A-Z]?\d{1,3}(?:[.)]|[—–:-]|\s|$))/gi,
      "$1\uE000",
    )
    .replace(/([^\n])\s+(?=(?:SECTION|PART)\s+[A-Z0-9]+\s*[—–:-])/gi, "$1\n")
    // Pasted papers often lose their line breaks. Split before common numbered
    // labels without splitting decimal numbers or marks embedded in a stem.
    .replace(
      /([^\n])\s+(?=(?:(?:QUESTION|Q)\s*(?:NO\.?\s*)?#?\s*)?[A-Z]?\d{1,3}(?:[.)]|[—–:-])\s+)/gi,
      "$1\n",
    )
    .replace(/([^\n])\s+(?=QUESTION\s+(?:NO\.?\s*)?#?\s*\d{1,3}\s+)/gi, "$1\n")
    .replace(
      /([^\n])\s+(?=(?:QUESTION|Q)\s+(?:NO\.?\s*)?#?\s*\d{1,3}(?:\s|$))/gi,
      "$1\n",
    )
    .replace(/([^\n])\s+Meanings:\s*/gi, "$1\nMeanings:\n")
    .split("\n")
    .map((line) => line.replaceAll("\uE000", " "));
  const questions: StructuredSourceQuestion[] = [];
  let section = "";
  let sectionTitle = "";
  let sectionPreamble: string[] = [];
  let pending: {
    sourceId: string;
    label: string;
    lines: string[];
    section: string;
    title: string;
    preamble: string[];
    implicit?: boolean;
    marksText?: string;
  } | null = null;
  // Papers often list questions without numbers, each ending in its marks,
  // e.g. "An algorithm is best described as: [1]". Number them per section.
  const implicitCounts = new Map<string, number>();
  const endsWithMarks = /\[\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*\]\s*$/i;

  const savePending = () => {
    if (!pending) return;
    const title =
      `${pending.title} ${pending.label} ${pending.preamble.join(" ")}`.toUpperCase();
    const caseSection = /CASE/.test(title);
    const matchingSection = /MATCHING/.test(title);
    const rawLines = pending.lines
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/END OF (?:RETEST|EXAM)/i.test(line))
      .filter(
        (line) =>
          !(
            matchingSection &&
            (/^Meanings\s*:/i.test(line) || /^[a-h][).]\s*/i.test(line))
          ),
      );
    const optionLines: string[] = [];
    const stemLines: string[] = [];
    const questionLines = [pending.label, ...rawLines];
    for (const line of questionLines) {
      const inlineMarkers = caseSection
        ? []
        : [...line.matchAll(/(?:^|\s)([A-D])[).]\s*/gi)];
      if (inlineMarkers.length >= 2) {
        const firstMarker = inlineMarkers[0];
        const firstStart =
          (firstMarker.index ?? 0) + firstMarker[0].search(/[A-D]/i);
        const stem = line.slice(0, firstStart).trim();
        if (stem) stemLines.push(stem);
        for (let index = 0; index < inlineMarkers.length; index += 1) {
          const marker = inlineMarkers[index];
          const optionStart = (marker.index ?? 0) + marker[0].search(/[A-D]/i);
          const contentStart = optionStart + marker[0].trimStart().length;
          const next = inlineMarkers[index + 1];
          const optionEnd = next?.index ?? line.length;
          const text = line.slice(contentStart, optionEnd).trim();
          if (text) optionLines.push(`${marker[1].toUpperCase()}) ${text}`);
        }
        continue;
      }
      const option = !caseSection && line.match(/^([A-D])[).]\s*(.+)$/i);
      if (option) {
        optionLines.push(`${option[1].toUpperCase()}) ${option[2].trim()}`);
      } else if (!/^Answer\s*(?:\([^)]*\))?\s*:/i.test(line)) {
        stemLines.push(line);
      }
    }

    const intro = pending.preamble.join("\n").trim();
    let prompt = stemLines.join("\n").trim();
    if (matchingSection) {
      const meaningsStart = lines.findIndex((line) =>
        /^\s*Meanings\s*:/i.test(line),
      );
      const sharedMeanings = (
        meaningsStart >= 0 ? lines.slice(meaningsStart) : []
      )
        .filter((line) => /^\s*[a-h][).]\s*/i.test(line))
        .map((line) => line.trim());
      if (sharedMeanings.length)
        prompt += `\n\nMeanings:\n${sharedMeanings.join("\n")}`;
    }
    if (intro) prompt = `${intro}\n\n${prompt}`;

    const explicitMarks =
      `${pending.marksText ?? ""} ${pending.label} ${pending.lines.join(" ")}`.match(
        /\[(\d+(?:\.\d+)?)(?:\s*marks?)?\]|\((\d+(?:\.\d+)?)(?:\s*marks?)?\)/i,
      );
    const sectionMarks = pending.title.match(/\d+\s*[×x]\s*(\d+(?:\.\d+)?)/i);
    const marks = Number(
      explicitMarks?.[1] ?? explicitMarks?.[2] ?? sectionMarks?.[1] ?? 1,
    );
    let type: StructuredSourceQuestion["type"] = "SHORT_ANSWER";
    if (/TRUE\s*(?:OR|\/)\s*FALSE/i.test(title)) type = "TRUE_FALSE";
    else if (/FILL.*BLANK|_{2,}/i.test(title)) type = "FILL_BLANK";
    else if (/MULTIPLE\s+CHOICE|\bMCQ\b/i.test(title)) type = "MCQ";
    else if (matchingSection) type = "MATCHING";
    else if (/CASE/i.test(title)) type = "CASE_STUDY";
    else if (optionLines.length) type = "MCQ";
    else if (/LONG\s+ANSWER|ESSAY/i.test(title)) type = "ESSAY";
    else if (
      /SHORT|BRIEF|ONE\s+OR\s+TWO\s+(?:LINES|SENTENCES)/i.test(title) ||
      (marks <= 3 && !/DISCUSS|EVALUATE|IN\s+DETAIL|ELABORATE/i.test(title))
    )
      type = "SHORT_ANSWER";
    else if (
      /DISCUSS|EVALUATE|IN\s+DETAIL|ELABORATE/i.test(title) ||
      marks >= 5
    )
      type = "ESSAY";
    if (type === "TRUE_FALSE" && !optionLines.length)
      optionLines.push("True", "False");

    if (prompt.trim()) {
      questions.push({
        sourceId: pending.sourceId,
        type,
        prompt: promptMarkdown(prompt),
        marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
        options: optionLines,
      });
    }
    pending = null;
  };

  for (const originalLine of lines) {
    const line = originalLine.trim();
    const sectionHeading = line.match(
      /^(?:PART|SECTION)\s+([A-Z0-9]+)\s*(?:[—–:-]\s*|\s+)(.+)$/i,
    );
    if (sectionHeading) {
      savePending();
      section = sectionHeading[1].toUpperCase();
      sectionTitle = sectionHeading[2];
      sectionPreamble = [];
      continue;
    }

    const letterLabel = line.match(
      /^(?:(?:QUESTION|Q)\s*(?:NO\.?\s*)?#?\s*)?([A-Z]?\d{1,3})(?:(?:[.)]|[—–:-])\s*(.*)|\s+(.+)|$)$/i,
    );
    const matchingLabel = /MATCHING/i.test(sectionTitle)
      ? line.match(/^(\d{1,2})[.)]\s*(.+)$/)
      : null;
    const match = letterLabel ?? matchingLabel;
    if (match) {
      savePending();
      const questionNumber = match[1].toUpperCase().replace(/\s+/g, "");
      const hasQuestionPrefix = /^(?:QUESTION\b|Q(?=\s|\d))/i.test(line);
      const sourceId = /^[A-Z]/i.test(questionNumber)
        ? questionNumber
        : hasQuestionPrefix
          ? `Q${questionNumber}`
          : questionNumber;
      pending = {
        sourceId,
        label: originalLine.trim().replace(/ {2,}/g, " "),
        lines: [],
        section,
        title: sectionTitle,
        preamble: [...sectionPreamble],
      };
      continue;
    }

    // An unnumbered question: a line ending in "[marks]" that is not an
    // option/sub-part ("a) ...") and not inside a numbered question (whose
    // "a) ... [1]" sub-parts belong to it, as in case studies).
    if (
      endsWithMarks.test(line) &&
      !/^[a-h][).]\s*/i.test(line) &&
      (!pending || pending.implicit)
    ) {
      savePending();
      const count = (implicitCounts.get(section) ?? 0) + 1;
      implicitCounts.set(section, count);
      pending = {
        sourceId: `${section || "Q"}${count}`,
        label: line.replace(endsWithMarks, "").trim(),
        lines: [],
        section,
        title: sectionTitle,
        preamble: [...sectionPreamble],
        implicit: true,
        // Keep the stated marks for scoring; the question text drops them.
        marksText: line.match(endsWithMarks)![0],
      };
      continue;
    }

    if (pending) pending.lines.push(originalLine);
    else sectionPreamble.push(originalLine);
  }
  savePending();

  return questions.length ? questions : null;
}
