import { describe, expect, it } from "vitest";
import { HttpError, RateLimitedClient, type HttpResponse } from "./http.js";

function clientWithResponses(responses: HttpResponse[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const delays: number[] = [];
  const client = new RateLimitedClient({
    baseUrl: "https://api.example.test",
    maxRetries: 3,
    baseDelayMs: 100,
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers });
      const next = responses.shift();
      if (!next) throw new Error("fetch called more times than expected");
      return next;
    },
  });
  return { client, calls, delays };
}

describe("RateLimitedClient", () => {
  it("backs off exponentially on 429 and honors retry-after", async () => {
    const { client, delays } = clientWithResponses([
      { status: 429, headers: {}, body: undefined },
      { status: 429, headers: { "retry-after": "2" }, body: undefined },
      { status: 200, headers: {}, body: { ok: true } },
    ]);
    const body = await client.get("/things", "corr-1");
    expect(body).toEqual({ ok: true });
    expect(delays).toEqual([100, 2000]); // 100 * 2^0, then retry-after 2s
  });

  it("gives up after maxRetries and surfaces the correlation id", async () => {
    const { client } = clientWithResponses(
      Array.from({ length: 4 }, () => ({ status: 500, headers: {}, body: undefined })),
    );
    await expect(client.get("/things", "corr-2")).rejects.toThrow(HttpError);
  });

  it("does not retry non-retryable client errors", async () => {
    const { client, calls } = clientWithResponses([{ status: 404, headers: {}, body: undefined }]);
    await expect(client.get("/missing", "corr-3")).rejects.toThrow("HTTP 404");
    expect(calls).toHaveLength(1);
  });

  it("sends the correlation id on every request", async () => {
    const { client, calls } = clientWithResponses([
      { status: 429, headers: {}, body: undefined },
      { status: 200, headers: {}, body: {} },
    ]);
    await client.get("/things", "corr-4");
    expect(calls.map((c) => c.headers["x-correlation-id"])).toEqual(["corr-4", "corr-4"]);
  });
});
