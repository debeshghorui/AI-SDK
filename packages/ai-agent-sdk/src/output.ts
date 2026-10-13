import { z } from "zod";
import type { JsonValue, ResponseFormat } from "./chat/types.js";
import { formatZodIssues } from "./config.js";
import { SDKError } from "./errors.js";

export function outputResponseFormat(schema: z.ZodType): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: "output",
      schema: z.toJSONSchema(schema, { target: "draft-07" }) as JsonValue,
      strict: true,
    },
  };
}

export function parseStructuredOutput(content: unknown, schema: z.ZodType): unknown {
  if (typeof content !== "string") {
    throw new SDKError("invalid_output", "choices.0.message.content: invalid_type");
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new SDKError("invalid_output", "choices.0.message.content: invalid_json");
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SDKError("invalid_output", formatZodIssues(result.error));
  }
  return result.data;
}
