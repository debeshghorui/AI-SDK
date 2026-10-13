import { z } from "zod";
import { formatZodIssues } from "../config.js";
import { SDKError } from "../errors.js";
import type { ParsedChatRequest, WireChatRequest } from "./types.js";

const toolCallSchema = z.strictObject({
  id: z.string(),
  type: z.literal("function"),
  function: z.strictObject({
    name: z.string(),
    arguments: z.string(),
  }),
});

const messageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("system"),
    content: z.string(),
  }),
  z.strictObject({
    role: z.literal("user"),
    content: z.string(),
  }),
  z.strictObject({
    role: z.literal("assistant"),
    content: z.string(),
    tool_calls: z.array(toolCallSchema).optional(),
  }),
  z.strictObject({
    role: z.literal("tool"),
    content: z.string(),
    tool_call_id: z.string(),
  }),
]);

const functionToolSchema = z.strictObject({
  type: z.literal("function"),
  function: z.strictObject({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.json().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.strictObject({
    type: z.literal("function"),
    function: z.strictObject({
      name: z.string(),
    }),
  }),
]);

const responseFormatSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text") }),
  z.strictObject({ type: z.literal("json_object") }),
  z.strictObject({
    type: z.literal("json_schema"),
    json_schema: z.strictObject({
      name: z.string(),
      schema: z.json(),
      strict: z.boolean().optional(),
    }),
  }),
]);

const chatRequestSchema = z
  .strictObject({
    model: z.string(),
    messages: z.array(messageSchema),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.int().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    seed: z.int().optional(),
    user: z.string().optional(),
    tools: z.array(functionToolSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
    response_format: responseFormatSchema.optional(),
    output: z.custom<z.ZodType>((value) => value instanceof z.ZodType).optional(),
    stream: z.boolean().optional(),
    threadId: z.string().optional(),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.output !== undefined && value.response_format !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["output"],
        message: "mutually exclusive with response_format",
      });
    }
    if (value.output !== undefined && value.stream === true) {
      ctx.addIssue({
        code: "custom",
        path: ["output"],
        message: "mutually exclusive with stream",
      });
    }
  });

export function parseChatRequest(input: unknown): ParsedChatRequest {
  const result = chatRequestSchema.safeParse(input);
  if (!result.success) {
    throw new SDKError("invalid_request", formatZodIssues(result.error));
  }

  const { threadId, signal, output, ...rest } = result.data;
  const wire: WireChatRequest = rest;
  const parsed: ParsedChatRequest = { wire };
  if (threadId !== undefined) parsed.threadId = threadId;
  if (signal !== undefined) parsed.signal = signal;
  if (output !== undefined) parsed.output = output;
  return parsed;
}
