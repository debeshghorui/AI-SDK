import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SDKError } from "ai-agent-sdk";
import { parseChatRequest } from "../src/chat/schema.ts";

const base = {
  model: "m",
  messages: [{ role: "user", content: "Hi" }],
};

describe("parseChatRequest", () => {
  it("rejects an unknown field with invalid_request", () => {
    expect(() => parseChatRequest({ ...base, n: 2 })).toThrow(SDKError);
    try {
      parseChatRequest({ ...base, n: 2 });
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_request");
      expect((error as SDKError).message).toContain("n");
      expect((error as SDKError).message).not.toContain("2");
    }
  });

  it("rejects array content without echoing the value", () => {
    expect(() =>
      parseChatRequest({
        model: "m",
        messages: [{ role: "user", content: ["text"] }],
      }),
    ).toThrow(SDKError);
    try {
      parseChatRequest({
        model: "m",
        messages: [{ role: "user", content: ["text"] }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_request");
      expect((error as SDKError).message).toContain("messages.0.content");
      expect((error as SDKError).message).not.toContain("text");
    }
  });

  it("rejects output together with stream: true", () => {
    expect(() =>
      parseChatRequest({
        ...base,
        stream: true,
        output: z.object({ answer: z.string() }),
      }),
    ).toThrow(SDKError);
    try {
      parseChatRequest({
        ...base,
        stream: true,
        output: z.object({ answer: z.string() }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      expect((error as SDKError).code).toBe("invalid_request");
    }
  });

  it("rejects output together with response_format", () => {
    expect(() =>
      parseChatRequest({
        ...base,
        response_format: { type: "json_object" },
        output: z.string(),
      }),
    ).toThrow(SDKError);
    try {
      parseChatRequest({
        ...base,
        response_format: { type: "json_object" },
        output: z.string(),
      });
    } catch (error) {
      expect((error as SDKError).code).toBe("invalid_request");
    }
  });

  it("keeps threadId, signal, and output off the wire body", () => {
    const signal = new AbortController().signal;
    const output = z.object({ answer: z.string() });
    const parsed = parseChatRequest({
      ...base,
      threadId: "thread-1",
      signal,
      output,
      temperature: 0.2,
    });
    expect(parsed.threadId).toBe("thread-1");
    expect(parsed.signal).toBe(signal);
    expect(parsed.output).toBe(output);
    expect(parsed.wire).toEqual({
      model: "m",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.2,
    });
    expect(parsed.wire).not.toHaveProperty("threadId");
    expect(parsed.wire).not.toHaveProperty("signal");
    expect(parsed.wire).not.toHaveProperty("output");
  });

  it("requires tool_call_id on tool messages", () => {
    expect(() =>
      parseChatRequest({
        model: "m",
        messages: [{ role: "tool", content: "ok" }],
      }),
    ).toThrow(SDKError);
  });

  it("does not coerce numeric strings", () => {
    expect(() => parseChatRequest({ ...base, max_tokens: "5" })).toThrow(SDKError);
    try {
      parseChatRequest({ ...base, max_tokens: "5" });
    } catch (error) {
      expect((error as SDKError).code).toBe("invalid_request");
      expect((error as SDKError).message).toContain("max_tokens");
      expect((error as SDKError).message).not.toContain("5");
    }
  });
});
