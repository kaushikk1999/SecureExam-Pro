import { afterEach, describe, expect, it, vi } from "vitest";
import { ai, aiCameraReview } from "../src/lib/integrations";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Ollama cloud integration", () => {
  it("uses the private bearer key and Gemma chat endpoint", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    vi.stubEnv("OLLAMA_BASE_URL", "https://ollama.com/");
    vi.stubEnv("OLLAMA_MODEL", "gemma4:31b");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "Review summary" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(ai("Aggregate monitoring counts")).resolves.toBe(
      "Review summary",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ollama.com/api/chat");
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: "gemma4:31b",
      stream: false,
      messages: [
        { role: "system" },
        { role: "user", content: "Aggregate monitoring counts" },
      ],
    });
  });

  it("does not call Ollama when the integration is disabled", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "false");
    vi.stubEnv("OLLAMA_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ai("A sufficiently long prompt")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenRouter free-model integration", () => {
  it("prefers OpenRouter with Gemma 4 and JSON output when its key is set", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_API_KEY", "ollama-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ai("Format these questions", { format: "json" }),
    ).resolves.toBe('{"ok":true}');
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer or-test-key",
    );
    const body = JSON.parse(String(options.body));
    expect(body.models).toEqual([
      "google/gemma-4-31b-it:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "google/gemma-4-26b-a4b-it:free",
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "Format these questions",
    });
  });

  it("sends camera frames as images to the vision model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: '{"possiblePhoneOrExtraScreen":true}' } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(aiCameraReview(["AAAA", "BBBB"])).resolves.toContain(
      "possiblePhoneOrExtraScreen",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.models).toEqual([
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    ]);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toEqual([
      expect.objectContaining({ type: "text" }),
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,AAAA" },
      },
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,BBBB" },
      },
    ]);
  });

  it("falls back to the careful model when the fast one times out", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("timeout"), { name: "TimeoutError" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            { message: { content: '{"possiblePhoneOrExtraScreen":true}' } },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(aiCameraReview(["AAAA", "BBBB"])).resolves.toContain(
      "possiblePhoneOrExtraScreen",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(second.models).toEqual(["nvidia/nemotron-3.5-super-vl:free"]);
    expect(second.reasoning).toBeUndefined();
  });

  it("reports a free-tier rate limit as a retryable 429", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: "Rate limit" } }, { status: 429 }),
        ),
    );
    await expect(aiCameraReview(["AAAA", "BBBB"])).rejects.toMatchObject({
      status: 429,
    });
  });
});
