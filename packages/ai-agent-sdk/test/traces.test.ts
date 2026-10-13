import { describe, expect, it } from "vitest";
import { createClient } from "ai-agent-sdk";
import { openai } from "ai-agent-sdk/openai";
import type { Provider, ProviderId, WireChatRequest } from "../src/provider.ts";

function fakeProvider(id: ProviderId = "openai") {
  const bodies: WireChatRequest[] = [];
  const provider: Provider = {
    id,
    async chat(request) {
      bodies.push(request);
      return {
        id: "cmpl-1",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      };
    },
    async *chatStream() {
      yield {
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      };
    },
  };
  return { provider, bodies };
}

function fetchProvider(status: () => number) {
  return openai({
    apiKey: "sk-test",
    headers: { "x-password": "db-secret" },
    fetch: async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-test");
      expect(headers.get("x-password")).toBe("db-secret");
      if (status() === 200) {
        return Response.json({
          id: "cmpl-1",
          choices: [
            { index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        });
      }
      return Response.json({ error: { message: "nope" } }, { status: status() });
    },
  });
}

const hello = {
  model: "m",
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe("traces", () => {
  it("records success and provider_error without the key, the header password, or the message", async () => {
    let status = 200;
    const client = createClient({
      provider: fetchProvider(() => status),
      memory: false,
      maxRetries: 0,
    });

    const completion = await client.chat.completions.create({
      ...hello,
      threadId: "thread-1",
      user: "ada",
    });
    status = 400;
    await expect(
      client.chat.completions.create(hello),
    ).rejects.toMatchObject({ code: "provider_error" });

    const spans = client.traces.list();
    const dumped = JSON.stringify(spans);
    const success = spans.find(
      (span) => span.name === "chat.completions" && span.traceId === completion.traceId,
    );
    const attempt = spans.find(
      (span) => span.name === "chat.completions.attempt" && span.traceId === completion.traceId,
    );

    expect(success?.status).toBe("ok");
    expect(success?.attributes).toMatchObject({
      provider: "openai",
      model: "m",
      stream: false,
      threadId: "thread-1",
      user: "ada",
      "usage.prompt_tokens": 4,
      "usage.completion_tokens": 2,
    });
    expect(success?.attributes).not.toHaveProperty("http.status");
    expect(attempt?.parentSpanId).toBe(success?.spanId);
    expect(attempt?.attributes.attempt).toBe(1);
    expect(spans.some((span) => span.status === "error" && span.errorCode === "provider_error")).toBe(
      true,
    );
    expect(
      spans.find((span) => span.status === "error" && span.name === "chat.completions.attempt")
        ?.attributes["http.status"],
    ).toBe(400);
    for (const span of spans.filter((span) => span.status === "error")) {
      expect(span.attributes).not.toHaveProperty("threadId");
    }
    expect(dumped).not.toContain("sk-test");
    expect(dumped).not.toContain("Hello");
    expect(dumped).not.toContain("db-secret");
    expect(dumped).not.toContain("Bearer");
  });

  it("includes message text only when content tracing is on", async () => {
    const client = createClient({
      provider: fetchProvider(() => 200),
      memory: false,
      maxRetries: 0,
      traces: { content: true },
    });

    await client.chat.completions.create(hello);

    const dumped = JSON.stringify(client.traces.list());
    const parent = client.traces
      .list()
      .find((span) => span.name === "chat.completions" && span.status === "ok");
    expect(parent?.attributes.messages).toContain("Hello");
    expect(parent?.attributes.output).toContain("Hello");
    expect(dumped).toContain("Hello");
    expect(dumped).not.toContain("sk-test");
    expect(dumped).not.toContain("db-secret");
  });

  it("writes nothing when traces are off", async () => {
    const fake = fakeProvider();
    const client = createClient({ provider: fake.provider, memory: false, traces: false });

    await client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(client.traces.list()).toEqual([]);
    client.traces.clear();
    expect(client.traces.list()).toEqual([]);
  });

  it("keeps the last 200 spans per client", async () => {
    const fake = fakeProvider();
    const other = fakeProvider("groq");
    const client = createClient({ provider: fake.provider, memory: false });
    const second = createClient({ provider: other.provider, memory: false });

    const first = await client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "one" }],
    });
    for (let i = 0; i < 120; i++) {
      await client.chat.completions.create({
        model: "m",
        messages: [{ role: "user", content: `n${i}` }],
      });
    }
    await second.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "other" }],
    });

    const spans = client.traces.list();
    expect(spans).toHaveLength(200);
    expect(spans.some((span) => span.traceId === first.traceId)).toBe(false);
    expect(second.traces.list()).toHaveLength(2);
    expect(JSON.stringify(second.traces.list())).not.toContain(first.traceId);

    client.traces.clear();
    expect(client.traces.list()).toEqual([]);
    expect(second.traces.list()).toHaveLength(2);
  });

  it("records a stream without the delta text", async () => {
    const fake = fakeProvider();
    const client = createClient({ provider: fake.provider, memory: false });
    const chunks = [];
    for await (const chunk of client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.traceId).toBeTypeOf("string");
    const spans = client.traces.list();
    expect(spans.some((span) => span.name === "chat.completions" && span.traceId === chunks[0]?.traceId)).toBe(
      true,
    );
    expect(spans.some((span) => span.name === "chat.completions.attempt")).toBe(true);
    expect(JSON.stringify(spans)).not.toContain("Hello");
  });
});
