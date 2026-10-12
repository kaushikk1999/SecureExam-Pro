import { afterEach, describe, expect, it, vi } from "vitest";
import { ai } from "../src/lib/integrations";

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
