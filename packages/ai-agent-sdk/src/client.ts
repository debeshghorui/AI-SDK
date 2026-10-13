import { z } from "zod";
import { parseChatRequest } from "./chat/schema.js";
import type { ChatCompletionChunk, ParsedChatRequest } from "./chat/types.js";
import { parseStrict } from "./config.js";
import { SDKError } from "./errors.js";
import type { Middleware } from "./middleware.js";
import { runMiddleware } from "./middleware.js";
import { outputResponseFormat, parseStructuredOutput } from "./output.js";
import type { ChatCallOptions, Provider, WireChatResponse } from "./provider.js";
import { attachTraceSession, createTraceSession, type Span, type SpanAttributes } from "./traces.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

const passthrough: Middleware = async (_context, next) => next();

const providerSchema = z.custom<Provider>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Provider).id === "string" &&
    typeof (value as Provider).chat === "function" &&
    typeof (value as Provider).chatStream === "function",
);

const clientOptionsSchema = z.strictObject({
  provider: providerSchema,
  memory: z
    .union([
      z.literal(false),
      z.custom<object>(
        (value) => typeof value === "object" && value !== null && !Array.isArray(value),
      ),
    ])
    .optional(),
  traces: z
    .union([z.literal(false), z.strictObject({ content: z.boolean().optional() })])
    .optional(),
  middleware: z.array(z.custom<Middleware>((value) => typeof value === "function")).optional(),
  timeoutMs: z.number().optional(),
  maxRetries: z.int().optional(),
});

export type ChatCompletion = WireChatResponse & {
  traceId: string;
  output?: unknown;
};

export type Client = {
  chat: {
    completions: {
      create(input: { stream: true }): AsyncIterable<ChatCompletionChunk>;
      create(input: unknown): Promise<ChatCompletion>;
    };
  };
  traces: {
    list(): readonly Span[];
    clear(): void;
  };
};

export function createClient(options: unknown): Client {
  const parsed = parseStrict(clientOptionsSchema, options);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = parsed.maxRetries ?? DEFAULT_MAX_RETRIES;
  const userMiddleware = parsed.middleware ?? [];
  const provider = parsed.provider;
  const tracesEnabled = parsed.traces !== false;
  const traceContent = typeof parsed.traces === "object" && parsed.traces.content === true;
  const session = createTraceSession({ enabled: tracesEnabled, content: traceContent });

  function create(input: { stream: true }): AsyncIterable<ChatCompletionChunk>;
  function create(input: unknown): Promise<ChatCompletion>;
  function create(input: unknown): Promise<ChatCompletion> | AsyncIterable<ChatCompletionChunk> {
    const traceId = crypto.randomUUID();
    let request: ParsedChatRequest;
    try {
      request = parseChatRequest(input);
    } catch (error) {
      const parent = session.start({
        traceId,
        name: "chat.completions",
        attributes: attributesFromUnknown(provider.id, input),
      });
      const info = errorAttributes(error);
      parent.end({ status: "error", errorCode: info.errorCode, attributes: info.attributes });
      return Promise.reject(error);
    }

    const call: ChatCallOptions = { timeoutMs, maxRetries };
    if (request.signal !== undefined) call.signal = request.signal;
    if (request.output !== undefined) {
      request.wire.response_format = outputResponseFormat(request.output);
    }

    if (request.wire.stream === true) return streamChunks(provider, request, call, traceId, session, traceContent);

    return completeChat(provider, request, call, traceId, userMiddleware, session, traceContent);
  }

  const client: Client = {
    chat: {
      completions: {
        create,
      },
    },
    traces: session,
  };
  attachTraceSession(client, session);
  return client;
}

async function completeChat(
  provider: Provider,
  request: ParsedChatRequest,
  call: ChatCallOptions,
  traceId: string,
  userMiddleware: readonly Middleware[],
  session: ReturnType<typeof createTraceSession>,
  traceContent: boolean,
): Promise<ChatCompletion> {
  const shared = sharedAttributes(provider.id, request);
  const parent = session.start({ traceId, name: "chat.completions", attributes: shared });
  const attempt = session.start({
    traceId,
    name: "chat.completions.attempt",
    parentSpanId: parent.spanId,
    attributes: { ...shared, attempt: 1 },
  });
  let outputText: string | undefined;

  try {
    const response = await runMiddleware(
      [passthrough, passthrough, ...userMiddleware],
      {
        operation: "chat",
        providerId: provider.id,
        ...(request.threadId !== undefined ? { threadId: request.threadId } : {}),
        request: request.wire,
      },
      () => provider.chat(request.wire, call),
    );
    const usage = usageAttributes(response);
    attempt.end({ status: "ok", attributes: usage });
    outputText = assistantText(response);
    const completion: ChatCompletion = { ...response, traceId };
    if (request.output !== undefined) {
      completion.output = parseStructuredOutput(assistantContent(response), request.output);
    }
    parent.end({
      status: "ok",
      attributes: { ...usage, ...textAttributes(request, outputText, traceContent) },
    });
    return completion;
  } catch (error) {
    const info = errorAttributes(error);
    if (!attempt.ended) {
      attempt.end({ status: "error", errorCode: info.errorCode, attributes: info.attributes });
    }
    if (!parent.ended) {
      parent.end({
        status: "error",
        errorCode: info.errorCode,
        attributes: { ...info.attributes, ...textAttributes(request, outputText, traceContent) },
      });
    }
    throw error;
  }
}

async function* streamChunks(
  provider: Provider,
  request: ParsedChatRequest,
  call: ChatCallOptions,
  traceId: string,
  session: ReturnType<typeof createTraceSession>,
  traceContent: boolean,
): AsyncGenerator<ChatCompletionChunk> {
  const shared = sharedAttributes(provider.id, request);
  const parent = session.start({ traceId, name: "chat.completions", attributes: shared });
  const attempt = session.start({
    traceId,
    name: "chat.completions.attempt",
    parentSpanId: parent.spanId,
    attributes: { ...shared, attempt: 1 },
  });
  let outputText = "";
  let usage: SpanAttributes = {};
  let failure: unknown;

  try {
    for await (const chunk of provider.chatStream(request.wire, call)) {
      if (traceContent) outputText += deltaText(chunk as ChatCompletionChunk);
      const nextUsage = usageAttributes(chunk as WireChatResponse);
      if (Object.keys(nextUsage).length > 0) usage = nextUsage;
      yield { ...(chunk as ChatCompletionChunk), traceId };
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const info = failure === undefined ? undefined : errorAttributes(failure);
    const status = failure === undefined ? "ok" : "error";
    const errorCode = info?.errorCode;
    if (!attempt.ended) {
      attempt.end({
        status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        attributes: { ...usage, ...info?.attributes },
      });
    }
    if (!parent.ended) {
      parent.end({
        status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        attributes: {
          ...usage,
          ...info?.attributes,
          ...textAttributes(request, traceContent ? outputText : undefined, traceContent),
        },
      });
    }
  }
}

function sharedAttributes(providerId: string, request: ParsedChatRequest): SpanAttributes {
  const attributes: SpanAttributes = {
    provider: providerId,
    model: request.wire.model,
    stream: request.wire.stream === true,
  };
  if (request.threadId !== undefined) attributes.threadId = request.threadId;
  if (request.wire.user !== undefined) attributes.user = request.wire.user;
  return attributes;
}

function attributesFromUnknown(providerId: string, input: unknown): SpanAttributes {
  const attributes: SpanAttributes = { provider: providerId, stream: false };
  if (typeof input !== "object" || input === null) return attributes;
  const record = input as Record<string, unknown>;
  if (typeof record.model === "string") attributes.model = record.model;
  if (record.stream === true) attributes.stream = true;
  if (typeof record.threadId === "string") attributes.threadId = record.threadId;
  if (typeof record.user === "string") attributes.user = record.user;
  return attributes;
}

function textAttributes(
  request: ParsedChatRequest,
  outputText: string | undefined,
  traceContent: boolean,
): SpanAttributes {
  if (!traceContent) return {};
  const attributes: SpanAttributes = { messages: JSON.stringify(request.wire.messages) };
  if (outputText !== undefined) attributes.output = outputText;
  return attributes;
}

function errorAttributes(error: unknown): { errorCode?: string; attributes: SpanAttributes } {
  if (!(error instanceof SDKError)) return { attributes: {} };
  const attributes: SpanAttributes = {};
  if (error.status !== undefined) attributes["http.status"] = error.status;
  return { errorCode: error.code, attributes };
}

function usageAttributes(response: WireChatResponse): SpanAttributes {
  const usage = response.usage;
  if (typeof usage !== "object" || usage === null) return {};
  const record = usage as Record<string, unknown>;
  const attributes: SpanAttributes = {};
  if (typeof record.prompt_tokens === "number") attributes["usage.prompt_tokens"] = record.prompt_tokens;
  if (typeof record.completion_tokens === "number") {
    attributes["usage.completion_tokens"] = record.completion_tokens;
  }
  return attributes;
}

function assistantContent(response: WireChatResponse): unknown {
  const choices = response.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  return (message as { content?: unknown }).content;
}

function assistantText(response: WireChatResponse): string | undefined {
  const content = assistantContent(response);
  return typeof content === "string" ? content : undefined;
}

function deltaText(chunk: ChatCompletionChunk): string {
  const choices = chunk.choices;
  if (!Array.isArray(choices)) return "";
  let text = "";
  for (const choice of choices) {
    const content = choice.delta?.content;
    if (typeof content === "string") text += content;
  }
  return text;
}
