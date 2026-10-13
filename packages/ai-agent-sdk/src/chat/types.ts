import type { ZodType } from "zod";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FunctionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonValue;
  };
};

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        schema: JsonValue;
        strict?: boolean;
      };
    };

export type WireChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  seed?: number;
  user?: string;
  tools?: FunctionTool[];
  tool_choice?: ToolChoice;
  response_format?: ResponseFormat;
  stream?: boolean;
};

export type ParsedChatRequest = {
  wire: WireChatRequest;
  threadId?: string;
  signal?: AbortSignal;
  output?: ZodType;
};
