import { z } from "zod";
import { parseChatRequest } from "./chat/schema.js";
import { parseStrict } from "./config.js";
import type { Middleware } from "./middleware.js";
import { runMiddleware } from "./middleware.js";
import type { ChatCallOptions, Provider, WireChatResponse } from "./provider.js";

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
};

export type Client = {
  chat: {
    completions: {
      create(input: unknown): Promise<ChatCompletion>;
    };
  };
};

export function createClient(options: unknown): Client {
  const parsed = parseStrict(clientOptionsSchema, options);
  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = parsed.maxRetries ?? DEFAULT_MAX_RETRIES;
  const userMiddleware = parsed.middleware ?? [];
  const provider = parsed.provider;

  return {
    chat: {
      completions: {
        async create(input: unknown): Promise<ChatCompletion> {
          const request = parseChatRequest(input);
          const traceId = crypto.randomUUID();
          const call: ChatCallOptions = { timeoutMs, maxRetries };
          if (request.signal !== undefined) call.signal = request.signal;

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

          return { ...response, traceId };
        },
      },
    },
  };
}
