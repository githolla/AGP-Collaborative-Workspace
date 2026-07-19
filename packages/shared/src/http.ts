/**
 * Rate-limit-aware HTTP client (SPEC constraint #6): backoff on 429/5xx,
 * correlation IDs on every request, bounded retries.
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface RateLimitedClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  /** Base backoff delay in ms; doubles per attempt. Injectable for tests. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: FetchLike;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly correlationId: string,
  ) {
    super(`HTTP ${status} from ${url} (correlation ${correlationId})`);
  }
}

const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON body stays as text
  }
  return { status: res.status, headers, body };
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimitedClient {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: RateLimitedClientOptions) {
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? defaultSleep;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async request(
    method: string,
    path: string,
    { body, correlationId }: { body?: unknown; correlationId: string },
  ): Promise<unknown> {
    const url = `${this.opts.baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId,
          ...this.opts.headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status < 400) return res.body;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        throw new HttpError(res.status, url, correlationId);
      }
      const retryAfterHeader = res.headers["retry-after"];
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
      const delay = Number.isFinite(retryAfterMs)
        ? retryAfterMs
        : this.baseDelayMs * 2 ** attempt;
      await this.sleep(delay);
      attempt += 1;
    }
  }

  get(path: string, correlationId: string): Promise<unknown> {
    return this.request("GET", path, { correlationId });
  }

  post(path: string, body: unknown, correlationId: string): Promise<unknown> {
    return this.request("POST", path, { body, correlationId });
  }
}

let correlationCounter = 0;

/** Correlation IDs thread through every saga and external write. */
export function newCorrelationId(prefix: string, now: Date): string {
  correlationCounter += 1;
  return `${prefix}-${now.toISOString().replace(/[-:.TZ]/g, "")}-${correlationCounter.toString(36)}`;
}
