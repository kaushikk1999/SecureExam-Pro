import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { searchablePdf } from "./helpers/searchable-pdf";
import {
  extractDocxText,
  extractPdfText,
  extractStructuredQuestions,
} from "../src/lib/document-text";

describe("document text extraction", () => {
  it("preserves paragraphs, Word table cells, and XML entities", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Match each term &amp; meaning.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>1. Organisation</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Your answer</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
      ),
    });
    const text = extractDocxText(docx);
    expect(text).toContain("Match each term & meaning.");
    expect(text).toContain("1. Organisation\tYour answer");
  });

  it("extracts searchable text from a PDF", async () => {
    const text = await extractPdfText(searchablePdf(["PART A - MULTIPLE CHOICE", "A1. Pick the best answer."]));
    expect(text).toContain("PART A - MULTIPLE CHOICE");
    expect(text).toContain("A1. Pick the best answer.");
  });
});

describe("structured question extraction", () => {
  it("preserves each source item, answer choices, shared matching list, and case context", () => {
    const source = `PART A — MULTIPLE CHOICE (2 × 1 = 2 marks)
Type the letter of the best answer.
A1. Which option is correct?
A) First
B) Second
Answer (A/B/C/D):
A2. Which other option is correct?
A) One
B) Two

PART B — MATCHING (2 × 1 = 2 marks)
Match each term to a meaning.
1. Organisation
2. Dashboard
Meanings:
a) People working together
b) A screen with key numbers

PART C — SHORT ANSWER (1 × 2 = 2 marks)
Answer in one or two sentences.
C1. Explain the difference.
Answer (type here):

PART D — CASE STUDY (2 marks)
Read the BloomBox case: orders are growing fast and messages are missed.
D1. Name one business function that is struggling. (2 marks)
D2. Give one tool that could help. (2 marks)`;
    const questions = extractStructuredQuestions(source);
    expect(questions).toHaveLength(7);
    expect(questions?.map(({ sourceId }) => sourceId)).toEqual([
      "A1",
      "A2",
      "1",
      "2",
      "C1",
      "D1",
      "D2",
    ]);
    expect(questions?.[0]).toMatchObject({
      type: "MCQ",
      marks: 1,
      options: ["A) First", "B) Second"],
    });
    expect(questions?.[2].prompt).toContain("a) People working together");
    expect(questions?.[3].prompt).toContain("b) A screen with key numbers");
    expect(questions?.[4].prompt).toContain("Answer in one or two sentences.");
    expect(questions?.[6].prompt).toContain("orders are growing fast");
  });
});
