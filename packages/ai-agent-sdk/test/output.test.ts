import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SDKError, createClient } from "ai-agent-sdk";
import type { Provider, WireChatRequest } from "../src/provider.ts";

function fakeProvider(content: unknown) {
  const bodies: WireChatRequest[] = [];
  const provider: Provider = {
    id: "openai",
    async chat(request) {
      bodies.push(request);
      return {
        id: "cmpl-1",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      };
    },
    async *chatStream() {
      // Structured output does not stream.
    },
  };
  return { provider, bodies };
}

const request = {
  model: "m",
  messages: [{ role: "user" as const, content: "Hi" }],
  output: z.strictObject({ answer: z.string() }),
};

describe("structured output", () => {
  it("parses message content onto completion.output and keeps the string", async () => {
    const fake = fakeProvider('{"answer":"yes"}');
    const client = createClient({ provider: fake.provider, memory: false });

    const completion = await client.chat.completions.create(request);

    expect(completion.output).toEqual({ answer: "yes" });
    expect(completion.choices).toEqual([
      {
        index: 0,
        message: { role: "assistant", content: '{"answer":"yes"}' },
        finish_reason: "stop",
      },
    ]);
    expect(fake.bodies[0]?.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "output",
        schema: z.toJSONSchema(request.output, { target: "draft-07" }),
        strict: true,
      },
    });
  });

  it("throws invalid_output for non-JSON content without echoing the text", async () => {
    const fake = fakeProvider("not json");
    const client = createClient({ provider: fake.provider, memory: false });

    await expect(client.chat.completions.create(request)).rejects.toMatchObject({
      name: "SDKError",
      code: "invalid_output",
    });
    try {
      await client.chat.completions.create(request);
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_output");
      expect((error as SDKError).message).not.toContain("not json");
    }
  });

  it("throws invalid_output with the Zod path and code and without the received value", async () => {
    const fake = fakeProvider('{"answer":1}');
    const client = createClient({ provider: fake.provider, memory: false });

    try {
      await client.chat.completions.create(request);
      expect.fail("expected invalid_output");
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_output");
      expect((error as SDKError).message).toContain("answer");
      expect((error as SDKError).message).toContain("invalid_type");
      expect((error as SDKError).message).not.toContain("1");
    }
  });

  it("throws invalid_output when message content is missing", async () => {
    const fake = fakeProvider(undefined);
    const client = createClient({ provider: fake.provider, memory: false });

    await expect(client.chat.completions.create(request)).rejects.toMatchObject({
      code: "invalid_output",
    });
  });
});
