import { describe, expect, it } from "vitest";
import { SDKError, createClient } from "ai-agent-sdk";
import type { ChatCallOptions, Provider, ProviderId, WireChatRequest } from "../src/provider.ts";

function fakeProvider(id: ProviderId) {
  const bodies: WireChatRequest[] = [];
  const calls: ChatCallOptions[] = [];
  const provider: Provider = {
    id,
    async chat(request, options) {
      bodies.push(request);
      calls.push(options);
      return {
        id: "cmpl-1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      };
    },
    async *chatStream() {
      // Non-streaming client does not read this.
    },
  };
  return { provider, bodies, calls };
}

const hello = {
  model: "m",
  messages: [{ role: "user" as const, content: "Hi" }],
};

describe("createClient", () => {
  it("sends the wire body without threadId and returns a traceId", async () => {
    const fake = fakeProvider("openai");
    const client = createClient({ provider: fake.provider, memory: false });
    const completion = await client.chat.completions.create({
      ...hello,
      threadId: "thread-1",
    });

    expect(fake.bodies).toEqual([hello]);
    expect(fake.bodies[0]).not.toHaveProperty("threadId");
    expect(typeof completion.traceId).toBe("string");
    expect(completion.traceId.length).toBeGreaterThan(0);
    expect(completion.choices).toEqual([
      { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
    ]);
  });

  it("rejects an unknown request field before calling the provider", async () => {
    const fake = fakeProvider("openai");
    const client = createClient({ provider: fake.provider, memory: false });

    await expect(client.chat.completions.create({ ...hello, surprise: true })).rejects.toMatchObject({
      name: "SDKError",
      code: "invalid_request",
    });
    expect(fake.bodies).toEqual([]);
  });

  it("accepts the same create argument shape for openai and groq fakes", async () => {
    const openai = fakeProvider("openai");
    const groq = fakeProvider("groq");
    const openaiClient = createClient({ provider: openai.provider, memory: false });
    const groqClient = createClient({ provider: groq.provider, memory: false });

    await openaiClient.chat.completions.create(hello);
    await groqClient.chat.completions.create(hello);

    expect(openai.bodies).toEqual([hello]);
    expect(groq.bodies).toEqual([hello]);
  });

  it("rejects an unknown client option", () => {
    const fake = fakeProvider("openai");
    expect(() =>
      createClient({ provider: fake.provider, memory: false, surprise: true } as never),
    ).toThrow(SDKError);
    try {
      createClient({ provider: fake.provider, memory: false, surprise: true } as never);
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_request");
      expect((error as SDKError).message).toContain("surprise");
    }
  });

  it("runs user middleware in order and shows the wire request", async () => {
    const fake = fakeProvider("openai");
    const order: string[] = [];
    const client = createClient({
      provider: fake.provider,
      memory: false,
      middleware: [
        async (context, next) => {
          order.push("first");
          expect(context.operation).toBe("chat");
          expect(context.providerId).toBe("openai");
          expect(context.threadId).toBe("thread-1");
          expect(context.request).toEqual(hello);
          expect(context.request).not.toHaveProperty("threadId");
          return next();
        },
        async (_context, next) => {
          order.push("second");
          return next();
        },
      ],
    });

    await client.chat.completions.create({ ...hello, threadId: "thread-1" });
    expect(order).toEqual(["first", "second"]);
    expect(fake.bodies).toEqual([hello]);
  });

  it("passes the abort signal and client timeout to the provider", async () => {
    const fake = fakeProvider("groq");
    const client = createClient({
      provider: fake.provider,
      memory: false,
      timeoutMs: 1500,
      maxRetries: 0,
    });
    const signal = new AbortController().signal;

    await client.chat.completions.create({ ...hello, signal });

    expect(fake.calls).toEqual([{ signal, timeoutMs: 1500, maxRetries: 0 }]);
    expect(fake.bodies[0]).not.toHaveProperty("signal");
  });
});
