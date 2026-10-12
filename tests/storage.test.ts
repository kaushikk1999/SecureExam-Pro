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

const { readPrivateFile, storePrivateFile } = await import(
  "../src/lib/integrations"
);

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
