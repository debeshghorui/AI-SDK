import type { ChatCompletion } from "../client.js";
import type { ChatCompletionChunk, ChatToolCallDelta, ToolCall } from "./types.js";

type ChoiceAcc = {
  index: number;
  content: string | null;
  toolCalls: Map<number, ToolCall>;
  finish_reason: string | null;
};

export async function collectStream(
  stream: AsyncIterable<ChatCompletionChunk>,
): Promise<ChatCompletion> {
  let id: string | undefined;
  let model: string | undefined;
  let usage: ChatCompletionChunk["usage"];
  let traceId: string | undefined;
  const choices = new Map<number, ChoiceAcc>();

  for await (const chunk of stream) {
    if (typeof chunk.id === "string") id = chunk.id;
    if (typeof chunk.model === "string") model = chunk.model;
    if (chunk.usage !== undefined) usage = chunk.usage;
    if (typeof chunk.traceId === "string") traceId = chunk.traceId;

    for (const choice of chunk.choices ?? []) {
      const index = choice.index ?? 0;
      const acc = choices.get(index) ?? {
        index,
        content: null,
        toolCalls: new Map<number, ToolCall>(),
        finish_reason: null,
      };
      choices.set(index, acc);

      const content = choice.delta?.content;
      if (typeof content === "string") acc.content = (acc.content ?? "") + content;
      if (choice.finish_reason != null) acc.finish_reason = choice.finish_reason;

      for (const call of choice.delta?.tool_calls ?? []) {
        const toolIndex = call.index ?? 0;
        acc.toolCalls.set(toolIndex, mergeToolCall(acc.toolCalls.get(toolIndex), call));
      }
    }
  }

  return {
    object: "chat.completion",
    ...(id !== undefined ? { id } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(usage !== undefined ? { usage } : {}),
    choices: [...choices.values()]
      .sort((left, right) => left.index - right.index)
      .map((acc) => ({
        index: acc.index,
        message: {
          role: "assistant" as const,
          content: acc.content,
          ...(acc.toolCalls.size > 0
            ? {
                tool_calls: [...acc.toolCalls.entries()]
                  .sort((left, right) => left[0] - right[0])
                  .map(([, call]) => call),
              }
            : {}),
        },
        finish_reason: acc.finish_reason,
      })),
    traceId: traceId ?? "",
  };
}

function mergeToolCall(existing: ToolCall | undefined, delta: ChatToolCallDelta): ToolCall {
  const name = delta.function?.name ?? "";
  const args = delta.function?.arguments ?? "";
  if (existing === undefined) {
    return {
      id: delta.id ?? "",
      type: "function",
      function: { name, arguments: args },
    };
  }
  return {
    id: delta.id && delta.id.length > 0 ? delta.id : existing.id,
    type: "function",
    function: {
      name: existing.function.name + name,
      arguments: existing.function.arguments + args,
    },
  };
}
