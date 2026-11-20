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
 * Extracts clearly labeled questions without paraphrasing them. Ollama can
 * supply answer-key suggestions, but it must not change, merge, or reorder the
 * instructor's question text.
 */
export function extractStructuredQuestions(source: string) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replace(/([^\n])\s+(?=(?:SECTION|PART)\s+[A-Z0-9]+\s*[—–:-])/gi, "$1\n")
    // Pasted papers often lose their line breaks. Split before common numbered
    // labels without splitting decimal numbers or marks embedded in a stem.
    .replace(
      /([^\n])\s+(?=(?:(?:QUESTION|Q)\s*(?:NO\.?\s*)?#?\s*)?[A-Z]?\d{1,3}(?:[.)]|[—–:-])\s+)/gi,
      "$1\n",
    )
    .replace(
      /([^\n])\s+(?=QUESTION\s+(?:NO\.?\s*)?#?\s*\d{1,3}\s+)/gi,
      "$1\n",
    )
    .replace(
      /([^\n])\s+(?=(?:QUESTION|Q)\s+(?:NO\.?\s*)?#?\s*\d{1,3}(?:\s|$))/gi,
      "$1\n",
    )
    .replace(/([^\n])\s+Meanings:\s*/gi, "$1\nMeanings:\n")
    .split("\n");
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
  } | null = null;

  const savePending = () => {
    if (!pending) return;
    const title = `${pending.title} ${pending.label} ${pending.preamble.join(" ")}`.toUpperCase();
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

    const explicitMarks = `${pending.label} ${pending.lines.join(" ")}`.match(
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
    else if (/LONG\s+ANSWER|ESSAY/i.test(title))
      type = "ESSAY";
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
        prompt,
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
    const matchingLabel =
      section === "B" && /MATCHING/i.test(sectionTitle)
        ? line.match(/^(\d{1,2})[.)]\s*(.+)$/)
        : null;
    const match = letterLabel ?? matchingLabel;
    if (match) {
      savePending();
      const questionNumber = match[1].toUpperCase().replace(/\s+/g, "");
      const sourceId = `${section || "Q"}-${questionNumber}`;
      pending = {
        sourceId,
        label: originalLine.trim(),
        lines: [],
        section,
        title: sectionTitle,
        preamble: [...sectionPreamble],
      };
      continue;
    }

    if (pending) pending.lines.push(originalLine);
    else sectionPreamble.push(originalLine);
  }
  savePending();

  return questions.length ? questions : null;
}
