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
    const text = await extractPdfText(
      searchablePdf(["PART A - MULTIPLE CHOICE", "A1. Pick the best answer."]),
    );
    expect(text).toContain("PART A - MULTIPLE CHOICE");
    expect(text).toContain("A1. Pick the best answer.");
  });
});

describe("structured question extraction", () => {
  it("recognizes common question labels and a single-section paper", () => {
    const questions = extractStructuredQuestions(`Section A: Multiple Choice
Choose the best answer.
Q1. Which option is correct? (2 marks)
A) First choice
B) Second choice
Answer: B
Question 2) Explain your choice. (3 marks)`);

    expect(questions).toHaveLength(2);
    expect(questions?.[0]).toMatchObject({
      sourceId: "Q1",
      type: "MCQ",
      marks: 2,
      options: ["A) First choice", "B) Second choice"],
    });
    expect(questions?.[0].prompt).toContain("Choose the best answer.");
    expect(questions?.[1]).toMatchObject({
      sourceId: "Q2",
      type: "MCQ",
      marks: 3,
    });
  });

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

  it("extracts unnumbered questions that end in [marks], section by section", () => {
    // Synthetic paper in the same layout as instructor papers that list
    // questions without numbers (never commit a real exam to this repo).
    const source = [
      "SECTION A — Multiple choice (3 × 1 = 3 marks)",
      "Circle the correct answer.",
      "",
      "Which planet is closest to the Sun? [1]",
      "a) Venus",
      "b) Mercury",
      "c) Mars",
      "d) Earth",
      "Which unit measures electric current? [1]",
      "a) Volt",
      "b) Watt",
      "c) Ampere",
      "d) Ohm",
      "A dozen equals: [1]",
      "a) 10",
      "b) 12",
      "c) 6",
      "d) 20",
      "",
      "SECTION B — True or False (2 × 1 = 2 marks)",
      "Write T for True or F for False.",
      "",
      "Water boils at 100 °C at sea level. ______ [1]",
      "A triangle has four sides. ______ [1]",
      "",
      "SECTION C — Fill in the blanks (2 × 1 = 2 marks)",
      "",
      "The capital of France is ____________. [1]",
      "Plants make food by ____________. [1]",
      "",
      "SECTION D — Short answers (2 × 2 = 4 marks)",
      "Answer in one or two lines.",
      "",
      "Give two uses of a spreadsheet. [2]",
      "Name two renewable energy sources. [2]",
      "",
      "SECTION E — Short case questions (1 × 5 = 5 marks)",
      "",
      "Question 1 — Lemonade stand [5]",
      "",
      "A lemonade stand sold these cups:",
      "",
      "Day\tCups",
      "Monday\t20",
      "Tuesday\t35",
      "",
      "a) What is the total? [2]",
      "b) Which day sold more? [1]",
      "c) Suggest one way to sell more. [2]",
    ].join("\n");
    const questions = extractStructuredQuestions(source)!;
    expect(questions.map((q) => [q.sourceId, q.type, q.marks])).toEqual([
      ["A1", "MCQ", 1],
      ["A2", "MCQ", 1],
      ["A3", "MCQ", 1],
      ["B1", "TRUE_FALSE", 1],
      ["B2", "TRUE_FALSE", 1],
      ["C1", "FILL_BLANK", 1],
      ["C2", "FILL_BLANK", 1],
      ["D1", "SHORT_ANSWER", 2],
      ["D2", "SHORT_ANSWER", 2],
      ["Q1", "CASE_STUDY", 5],
    ]);
    expect(questions[0].options).toEqual([
      "A) Venus",
      "B) Mercury",
      "C) Mars",
      "D) Earth",
    ]);
    expect(questions[0].prompt).toContain(
      "Which planet is closest to the Sun?",
    );
    expect(questions[0].prompt).not.toContain("[1]");
    expect(questions[3].options).toEqual(["True", "False"]);
    const caseStudy = questions.at(-1)!;
    expect(caseStudy.prompt).toContain("| Monday | 20 |");
    expect(caseStudy.prompt).toContain("c) Suggest one way to sell more. [2]");
  });
});
