import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { getAccessToken: vi.fn(async () => ({ token: "test-token" })) },
  fromJSON: vi.fn(() => mocks.auth),
  put: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () => "test-subject-token"),
}));
vi.mock("google-auth-library", () => ({
  ExternalAccountClient: { fromJSON: mocks.fromJSON },
}));
vi.mock("@vercel/blob", () => ({ put: mocks.put, get: mocks.get }));

const {
  archiveWarningEvidenceToDrive,
  deleteWarningEvidenceArchiveFromDrive,
  readPrivateFile,
  storePrivateFile,
} = await import("../src/lib/integrations");

const oldEnv = { ...process.env };
const nativeFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...oldEnv };
  globalThis.fetch = nativeFetch;
  vi.clearAllMocks();
});

describe("private exam file storage", () => {
  it("stores and reads files from the configured shared Drive folder", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "";
    process.env.GDRIVE_FOLDER_ID = "private-folder-id";
    process.env.GCP_PROJECT_NUMBER = "347634395141";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "exam-pool";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel-production";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "files@example.iam.gserviceaccount.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "stored-file-id" }))
      .mockResolvedValueOnce(new Response("docx-bytes"));
    globalThis.fetch = fetchMock as typeof fetch;

    const reference = await storePrivateFile(
      "exams/demo/paper.docx",
      Buffer.from("docx-bytes"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const stream = await readPrivateFile(reference);

    expect(reference).toBe("gdrive:stored-file-id");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("upload/drive/v3/files");
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain(
      '"parents":["private-folder-id"]',
    );
    expect(await new Response(stream).text()).toBe("docx-bytes");
  });

  it("uses Vercel Blob when its private token is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    mocks.put.mockResolvedValue({ url: "https://blob.example/private" });
    expect(
      await storePrivateFile(
        "exams/demo/paper.pdf",
        Buffer.from("pdf"),
        "application/pdf",
      ),
    ).toBe("https://blob.example/private");
    expect(mocks.put).toHaveBeenCalledOnce();
  });

  it("archives warning screenshots and a timestamped student activity report in exam/student Drive folders", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "";
    process.env.GDRIVE_FOLDER_ID = "private-folder-id";
    process.env.GCP_PROJECT_NUMBER = "347634395141";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "exam-pool";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel-production";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "files@example.iam.gserviceaccount.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "secure-exam-folder" }))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "exam-folder" }))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "student-folder" }))
      .mockResolvedValueOnce(Response.json({ parents: ["private-folder-id"] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "report-file" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await archiveWarningEvidenceToDrive({
      examId: "01234567-89ab-cdef-0123-456789abcdef",
      examTitle: "Data Structures Midterm",
      courseName: "Data Structures and Algorithms",
      courseCode: "IBA360",
      section: "356A",
      studentName: "Kaushik Karmakar",
      studentId: "1681006100",
      email: "student@example.edu",
      attemptStatus: "AUTO_SUBMITTED_SECURITY",
      warnings: 5,
      startedAt: "2026-10-14T06:00:00.000Z",
      submittedAt: "2026-10-14T07:30:00.000Z",
      events: [
        {
          event_type: "TAB_HIDDEN",
          severity: "HIGH",
          created_at: "2026-10-14T07:29:00.000Z",
          metadata: { reason: "document visibility changed" },
        },
        {
          event_type: "WARNING_ISSUED",
          severity: "HIGH",
          created_at: "2026-10-14T07:29:00.100Z",
          metadata: { reason: "TAB_HIDDEN", count: 5 },
        },
      ],
      evidence: [
        {
          id: "evidence-id",
          name: "EVIDENCE::TAB_HIDDEN::event-id.jpg",
          mime: "image/jpeg",
          url: "gdrive:evidence-id",
          created_at: "2026-10-14T07:29:00.000Z",
        },
      ],
    });

    expect(result).toMatchObject({
      archived: true,
      evidenceCount: 1,
      folderId: "student-folder",
      reportId: "report-file",
    });
    expect(String(fetchMock.mock.calls[1][1]?.body)).toContain(
      '"name":"Secure Exam"',
    );
    expect(String(fetchMock.mock.calls[3][1]?.body)).toContain(
      '"name":"Data Structures Midterm (01234567)"',
    );
    expect(String(fetchMock.mock.calls[5][1]?.body)).toContain(
      '"name":"Kaushik Karmakar (1681006100)"',
    );
    expect(String(fetchMock.mock.calls[7][0])).toContain(
      "addParents=student-folder",
    );
    expect(String(fetchMock.mock.calls[9][1]?.body)).toContain(
      "AUTO_SUBMITTED_SECURITY",
    );
    expect(String(fetchMock.mock.calls[9][1]?.body)).toContain("TAB_HIDDEN");
    expect(String(fetchMock.mock.calls[9][1]?.body)).toContain("14 Oct 2026");
  });

  it("does not create any Drive folders for students without warnings", async () => {
    const result = await archiveWarningEvidenceToDrive({
      examId: "01234567-89ab-cdef-0123-456789abcdef",
      examTitle: "Exam",
      courseName: "Course",
      courseCode: "C1",
      section: "",
      studentName: "Student",
      studentId: null,
      email: "student@example.edu",
      attemptStatus: "SUBMITTED",
      warnings: 0,
      startedAt: new Date(),
      submittedAt: new Date(),
      events: [],
      evidence: [],
    });
    expect(result).toEqual({ archived: false, evidenceCount: 0 });
    expect(globalThis.fetch).toBe(nativeFetch);
  });

  it("removes only the deleted exam's archived Drive tree", async () => {
    process.env.GDRIVE_FOLDER_ID = "private-folder-id";
    process.env.GCP_PROJECT_NUMBER = "347634395141";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "exam-pool";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel-production";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "files@example.iam.gserviceaccount.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ files: [{ id: "root", name: "Secure Exam" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ files: [{ id: "exam", name: "Exam (01234567)" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          files: [
            {
              id: "student",
              name: "Student (123)",
              mimeType: "application/vnd.google-apps.folder",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          files: [{ id: "report", name: "Student activity report.txt" }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      deleteWarningEvidenceArchiveFromDrive(
        "01234567-89ab-cdef-0123-456789abcdef",
        "Exam",
      ),
    ).resolves.toEqual({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(String(fetchMock.mock.calls[4][0])).toContain("/report");
    expect(String(fetchMock.mock.calls[6][0])).toContain("/exam");
  });

  it("fails with setup guidance if neither storage provider is configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "";
    delete process.env.GDRIVE_FOLDER_ID;
    await expect(
      storePrivateFile(
        "exams/demo/paper.pdf",
        Buffer.from("pdf"),
        "application/pdf",
      ),
    ).rejects.toThrow("GDRIVE_FOLDER_ID");
  });
});
