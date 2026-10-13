import { z } from "zod";
import { SDKError } from "./errors.js";

export type ConfigField = {
  key: string;
  env?: string;
  required?: boolean;
  default?: string;
};

function issuePath(issue: z.core.$ZodIssue): string {
  if (issue.path.length > 0) return issue.path.map(String).join(".");
  if (issue.code === "unrecognized_keys") return issue.keys.join(".");
  return "";
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issuePath(issue)}: ${issue.code}`).join("; ");
}

export function parseStrict<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new SDKError("invalid_request", formatZodIssues(result.error));
  }
  return result.data;
}

export function pickPresent(source: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return {};
  const record = source as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) picked[key] = record[key];
  }
  return picked;
}

export function readConfig(
  env: Record<string, string | undefined>,
  args: Record<string, unknown> | undefined,
  fields: readonly ConfigField[],
): Record<string, string> {
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    throw new SDKError("invalid_request", ": invalid_type");
  }

  const input = args ?? {};
  const known = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      throw new SDKError("invalid_request", `${key}: unrecognized_keys`);
    }
  }

  const resolved: Record<string, string> = {};
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(input, field.key);
    let value: string | undefined;
    if (present) {
      const raw = input[field.key];
      if (typeof raw !== "string") {
        throw new SDKError("invalid_request", `${field.key}: invalid_type`);
      }
      value = raw;
    } else if (field.env !== undefined && env[field.env] !== undefined) {
      value = env[field.env];
    } else if (field.default !== undefined) {
      value = field.default;
    }

    if (field.required && (value === undefined || value === "")) {
      throw new SDKError("missing_config", `${field.env ?? field.key} is required`);
    }
    if (value !== undefined) resolved[field.key] = value;
  }

  return resolved;
}
