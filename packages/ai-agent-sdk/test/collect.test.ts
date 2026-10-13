import { describe, expect, it } from "vitest";
import { collectStream, createClient } from "ai-agent-sdk";
import type { ChatCompletionChunk } from "../src/chat/types.ts";
import type { ChatCallOptions, Provider, WireChatRequest } from "../src/provider.ts";

async function* chunks(items: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  for (const item of items) yield item;
}

describe("collectStream", () => {
  it("concatenates content deltas and copies metadata from the last chunk that has it", async () => {
    const completion = await collectStream(
      chunks([
        {
          id: "cmpl-early",
          model: "early-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "Hel" }, finish_reason: null }],
        },
        {
          choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
        },
        {
          id: "cmpl-1",
          model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          traceId: "trace-1",
        },
      ]),
    );

    expect(completion.choices).toEqual([
      {
        index: 0,
        message: { role: "assistant", content: "Hello" },
        finish_reason: "stop",
      },
    ]);
    expect(completion.id).toBe("cmpl-1");
    expect(completion.model).toBe("m");
    expect(completion.usage).toEqual({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 });
    expect(completion.traceId).toBe("trace-1");
  });

  it("assembles tool-call argument fragments by index", async () => {
    const completion = await collectStream(
      chunks([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "lookup", arguments: '{"q":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: '"x"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          traceId: "trace-tools",
        },
      ]),
    );

    expect(completion.choices).toEqual([
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"x"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ]);
    expect(completion.traceId).toBe("trace-tools");
  });
});

const hello = {
  model: "m",
  messages: [{ role: "user" as const, content: "Hi" }],
};

function streamingProvider() {
  const chatBodies: WireChatRequest[] = [];
  const streamBodies: WireChatRequest[] = [];
  const streamCalls: ChatCallOptions[] = [];
  const provider: Provider = {
    id: "openai",
    async chat(request) {
      chatBodies.push(request);
      return { id: "cmpl-sync", choices: [] };
    },
    async *chatStream(request, options) {
      streamBodies.push(request);
      streamCalls.push(options);
      if (options.signal?.aborted) return;
      yield { id: "cmpl-1", model: "m", choices: [{ index: 0, delta: { content: "Hel" } }] };
      yield { choices: [{ index: 0, delta: { content: "lo" } }] };
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  };
  return { provider, chatBodies, streamBodies, streamCalls };
}

describe("createClient stream", () => {
  it("returns chat chunks for stream: true and omits threadId from the wire body", async () => {
    const fake = streamingProvider();
    const client = createClient({ provider: fake.provider, memory: false });
    const stream = client.chat.completions.create({
      ...hello,
      stream: true,
      threadId: "thread-1",
    });

    const received: ChatCompletionChunk[] = [];
    for await (const chunk of stream) received.push(chunk);

    expect(fake.chatBodies).toEqual([]);
    expect(fake.streamBodies).toEqual([{ ...hello, stream: true }]);
    expect(fake.streamBodies[0]).not.toHaveProperty("threadId");
    expect(received.map((chunk) => chunk.choices?.[0]?.delta?.content)).toEqual(["Hel", "lo", undefined]);
    expect(new Set(received.map((chunk) => chunk.traceId)).size).toBe(1);
    expect(received[0]?.traceId).toEqual(expect.any(String));

    const completion = await collectStream(received);
    expect(completion.choices?.[0]).toMatchObject({
      message: { role: "assistant", content: "Hello" },
    });
    expect(completion.traceId).toBe(received[0]?.traceId);
  });

  it("rejects an unknown field before calling the provider", async () => {
    const fake = streamingProvider();
    const client = createClient({ provider: fake.provider, memory: false });

    await expect(
      Promise.resolve().then(() =>
        client.chat.completions.create({ ...hello, stream: true, surprise: true }),
      ),
    ).rejects.toMatchObject({
      name: "SDKError",
      code: "invalid_request",
    });
    expect(fake.chatBodies).toEqual([]);
    expect(fake.streamBodies).toEqual([]);
  });

  it("passes the abort signal through to the stream read", async () => {
    const fake = streamingProvider();
    const client = createClient({ provider: fake.provider, memory: false });
    const controller = new AbortController();

    const stream = client.chat.completions.create({
      ...hello,
      stream: true,
      signal: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await iterator.return?.();

    expect(fake.streamCalls[0]?.signal).toBe(controller.signal);
    expect(fake.streamCalls[0]?.signal?.aborted).toBe(true);
  });
});
