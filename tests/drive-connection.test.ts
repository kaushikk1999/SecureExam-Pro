import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(
    async (statement?: unknown) => (statement ? [] : []) as unknown[],
  ),
  put: vi.fn(),
}));
vi.mock("../src/lib/db", () => ({ query: mocks.query }));
vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn() }));

const connection = await import("../src/lib/drive-connection");
const integrations = await import("../src/lib/integrations");

const TEACHER = "11111111-2222-4333-8444-555555555555";
const OWNER = "55555555-2222-4333-8444-555555555555";
const oldEnv = { ...process.env };
const nativeFetch = globalThis.fetch;
beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret-value";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
});
afterEach(() => {
  process.env = { ...oldEnv };
  globalThis.fetch = nativeFetch;
  vi.clearAllMocks();
  mocks.query.mockImplementation(async () => []);
});

describe("teacher Google Drive connection", () => {
  it("encrypts refresh tokens and builds a drive.file consent URL with PKCE", () => {
    const sealed = connection.encryptToken("refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(connection.decryptToken(sealed)).toBe("refresh-token");

    const request = connection.newAuthorizationRequest();
    const url = new URL(
      connection.authorizationUrl({
        origin: "https://exam.example",
        state: request.state,
        challenge: request.challenge,
        loginHint: "teacher@bu.ac.th",
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/drive.file",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://exam.example/api/platform/drive-connection/callback",
    );
    expect(url.searchParams.get("login_hint")).toBe("teacher@bu.ac.th");
  });

  it("saves the connection with an encrypted token and a recordings folder", async () => {
    const idPayload = Buffer.from(
      JSON.stringify({ email: "teacher@bu.ac.th", email_verified: true }),
    ).toString("base64url");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "openid email https://www.googleapis.com/auth/drive.file",
          id_token: `x.${idPayload}.y`,
        }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "root-folder" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await connection.completeDriveConnection({
      userId: TEACHER,
      code: "auth-code",
      verifier: "verifier",
      origin: "https://exam.example",
    });

    expect(result).toEqual({
      email: "teacher@bu.ac.th",
      rootFolderId: "root-folder",
    });
    const tokenBody = String(fetchMock.mock.calls[0][1]?.body);
    expect(tokenBody).toContain("code_verifier=verifier");
    const insert = JSON.stringify(mocks.query.mock.calls[0]);
    expect(insert).toContain("drive_connections");
    expect(insert).not.toContain('"refresh"');
  });

  it("reuses the recordings folder from an earlier connection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          scope: "openid email https://www.googleapis.com/auth/drive.file",
        }),
      )
      .mockResolvedValueOnce(Response.json({ files: [{ id: "old-folder" }] }));
    globalThis.fetch = fetchMock as typeof fetch;
    const result = await connection.completeDriveConnection({
      userId: TEACHER,
      code: "auth-code",
      verifier: "verifier",
      origin: "https://exam.example",
    });
    expect(result.rootFolderId).toBe("old-folder");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a connection where Drive access was not granted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        scope: "openid email",
      }),
    ) as typeof fetch;
    await expect(
      connection.completeDriveConnection({
        userId: TEACHER,
        code: "auth-code",
        verifier: "verifier",
        origin: "https://exam.example",
      }),
    ).rejects.toThrow("Drive access was not granted");
  });

  it("asks the teacher to reconnect when Google revokes the token", async () => {
    mocks.query.mockImplementation(async () => [
      {
        refresh_token_enc: connection.encryptToken("revoked"),
        root_folder_id: "root-folder",
      },
    ]);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "invalid_grant" }, { status: 400 }),
      ) as typeof fetch;
    await expect(
      connection.userDriveAccess("22222222-2222-4333-8444-555555555555"),
    ).rejects.toThrow("reconnect Google Drive");
  });

  it("saves recordings in the exam owner's connected Drive, not Blob", async () => {
    mocks.query.mockImplementation(async (statement: unknown) => {
      const text = JSON.stringify(statement);
      if (text.includes("teacher_id")) return [{ teacher_id: OWNER }];
      if (text.includes("drive_connections"))
        return [
          {
            refresh_token_enc: connection.encryptToken("refresh"),
            root_folder_id: "root-folder",
          },
        ];
      return [];
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: "owner-access", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "exam-folder" }))
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(Response.json({ id: "student-folder" }))
      .mockResolvedValueOnce(Response.json({ id: "segment-file" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const reference = await integrations.storeScreenRecordingPart({
      attemptId: "33333333-2222-4333-8444-555555555555",
      examId: "44444444-2222-4333-8444-555555555555",
      examTitle: "Midterm",
      studentName: "Student",
      studentId: "123",
      name: "SCREEN_RECORDING::a::0000000000001.webm",
      bytes: Buffer.from("webm"),
    });

    expect(reference).toBe(`udrive:${OWNER}:segment-file`);
    expect(mocks.put).not.toHaveBeenCalled();
    const upload = fetchMock.mock.calls[5];
    expect(String(upload[0])).toContain("upload/drive/v3/files");
    expect(upload[1]?.headers).toMatchObject({
      Authorization: "Bearer owner-access",
    });
    expect(String(upload[1]?.body)).toContain('"parents":["student-folder"]');
  });
});
