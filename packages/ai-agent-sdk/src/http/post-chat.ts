import { SDKError } from "../errors.js";
import type { WireChatChunk, WireChatResponse } from "../provider.js";

export type PostChatTarget = {
  url: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
};

export type PostChatOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const IDLE_TIMEOUT_MS = 60_000;
const STREAM_CAP_MS = 10 * 60 * 1000;
const RETRY_AFTER_LIMIT_MS = 10_000;

type Attempt =
  | { kind: "response"; response: Response }
  | { kind: "retry"; delay: number }
  | { kind: "fail"; error: SDKError };

export async function postChat(
  target: PostChatTarget,
  body: unknown,
  options: PostChatOptions = {},
): Promise<WireChatResponse> {
  const maxRetries = target.maxRetries ?? DEFAULT_MAX_RETRIES;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await attemptOnce(target, body, options, attempt, maxRetries);
    if (result.kind === "fail") throw result.error;
    if (result.kind === "retry") {
      await sleep(result.delay, options.signal);
      continue;
    }
    try {
      const text = await result.response.text();
      return parseSuccessJson(text, result.response.status);
    } catch (error) {
      if (error instanceof SDKError) throw error;
      const network = networkError(error);
      if (attempt >= maxRetries) throw network;
      await sleep(backoffMs(attempt), options.signal);
    }
  }
  throw new SDKError("provider_error", "Provider request failed");
}

export async function* postChatStream(
  target: PostChatTarget,
  body: unknown,
  options: PostChatOptions = {},
): AsyncGenerator<WireChatChunk> {
  const maxRetries = target.maxRetries ?? DEFAULT_MAX_RETRIES;
  const startedAt = Date.now();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await attemptOnce(target, body, options, attempt, maxRetries);
    if (result.kind === "fail") throw result.error;
    if (result.kind === "retry") {
      await sleep(result.delay, options.signal);
      continue;
    }

    let yielded = false;
    try {
      for await (const chunk of readSSE(result.response, options.signal, startedAt)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (yielded) throw asStreamError(error, options.signal);
      if (error instanceof SDKError) throw error;
      if (attempt >= maxRetries) throw networkError(error);
      await sleep(backoffMs(attempt), options.signal);
    }
  }
  throw new SDKError("provider_error", "Provider request failed");
}

async function attemptOnce(
  target: PostChatTarget,
  body: unknown,
  options: PostChatOptions,
  attempt: number,
  maxRetries: number,
): Promise<Attempt> {
  try {
    const response = await fetchWithHeaderTimeout(target, body, options);
    if (response.ok) return { kind: "response", response };
    const error = await providerError(response);
    const delay = retryDelay(response, attempt);
    if (delay === null || attempt >= maxRetries) return { kind: "fail", error };
    return { kind: "retry", delay };
  } catch (error) {
    if (error instanceof SDKError) return { kind: "fail", error };
    const network = networkError(error);
    if (attempt >= maxRetries) return { kind: "fail", error: network };
    return { kind: "retry", delay: backoffMs(attempt) };
  }
}

async function fetchWithHeaderTimeout(
  target: PostChatTarget,
  body: unknown,
  options: PostChatOptions,
): Promise<Response> {
  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signals = [timeout.signal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  const doFetch = target.fetch ?? globalThis.fetch;

  try {
    return await doFetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...target.headers,
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new SDKError("aborted", "The request was aborted");
    }
    if (timeout.signal.aborted) {
      throw new SDKError("timeout", "The request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function retryDelay(response: Response, attempt: number): number | null {
  if (!isRetryableStatus(response.status)) return null;
  const retryAfter = retryAfterMs(response);
  if (retryAfter !== undefined && retryAfter >= RETRY_AFTER_LIMIT_MS) return null;
  if (retryAfter !== undefined) return retryAfter;
  return backoffMs(attempt);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(response: Response): number | undefined {
  if (response.status !== 429 && response.status !== 503) return undefined;
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - Date.now());
}

function backoffMs(attempt: number): number {
  const base = attempt === 0 ? 200 : 800;
  const jitter = Math.floor(Math.random() * 101);
  return base + jitter;
}

async function providerError(response: Response): Promise<SDKError> {
  const text = await response.text();
  const requestId = response.headers.get("x-request-id") ?? undefined;
  let message = `Provider request failed with status ${response.status}`;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
      message = parsed.error.message;
    }
  } catch {
    // Non-JSON bodies stay on cause. The message stays free of the raw payload.
  }
  return new SDKError("provider_error", message, {
    status: response.status,
    requestId,
    cause: text,
  });
}

function parseSuccessJson(text: string, status: number): WireChatResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SDKError("provider_error", "Provider response was not JSON", {
      status,
      cause: text === "" ? error : text,
    });
  }
  if (!isRecord(parsed)) {
    throw new SDKError("provider_error", "Provider response was not an object", {
      status,
      cause: text,
    });
  }
  return parsed;
}

async function* readSSE(
  response: Response,
  signal: AbortSignal | undefined,
  startedAt: number,
): AsyncGenerator<WireChatChunk> {
  const body = response.body;
  if (!body) {
    throw new SDKError("provider_error", "Provider response had no body", {
      status: response.status,
    });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const capAt = startedAt + STREAM_CAP_MS;

  try {
    while (true) {
      const { done, value } = await readOrTimeout(reader, signal, capAt);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const drained = drainEvents(buffer);
      buffer = drained.rest;
      for (const data of drained.events) {
        const chunk = parseChunk(data);
        if (chunk === "done") return;
        yield chunk;
      }
    }
    buffer += decoder.decode();
    const drained = drainEvents(`${buffer}\n\n`);
    for (const data of drained.events) {
      const chunk = parseChunk(data);
      if (chunk === "done") return;
      yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseChunk(data: string): WireChatChunk | "done" {
  const trimmed = data.trim();
  if (trimmed === "[DONE]") return "done";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new SDKError("provider_error", "Provider stream chunk was not JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new SDKError("provider_error", "Provider stream chunk was not an object", {
      cause: trimmed,
    });
  }
  return parsed;
}

function drainEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  while (true) {
    const boundary = findBoundary(rest);
    if (boundary === null) break;
    const raw = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary.length);
    const data = extractData(raw);
    if (data !== undefined) events.push(data);
  }
  return { events, rest };
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (lf === -1) return { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf <= crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function extractData(raw: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice("data:".length);
    dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  if (dataLines.length === 0) return undefined;
  return dataLines.join("\n");
}

function readOrTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  capAt: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const wait = Math.min(IDLE_TIMEOUT_MS, capAt - Date.now());
  if (wait <= 0) return Promise.reject(new SDKError("timeout", "The stream timed out"));
  if (signal?.aborted) return Promise.reject(new SDKError("aborted", "The request was aborted"));

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        reader.cancel().catch(() => {});
        reject(new SDKError("timeout", "The stream timed out"));
      });
    }, wait);

    const onAbort = () => {
      finish(() => {
        reader.cancel().catch(() => {});
        reject(new SDKError("aborted", "The request was aborted"));
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(settle: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      settle();
    }

    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
  });
}

function asStreamError(error: unknown, signal: AbortSignal | undefined): SDKError {
  if (error instanceof SDKError) return error;
  if (signal?.aborted) return new SDKError("aborted", "The request was aborted", { cause: error });
  return networkError(error);
}

function networkError(cause: unknown): SDKError {
  return new SDKError("provider_error", "Network request failed", { cause });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new SDKError("aborted", "The request was aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SDKError("aborted", "The request was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
