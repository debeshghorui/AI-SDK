import { afterEach, describe, expect, it } from "vitest";
import { SDKError } from "ai-agent-sdk";
import { postChat, postChatStream } from "../src/http/post-chat.js";
import { startContractServer, type ContractServer } from "./contract/server.js";

const COMPLETION = JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [
    { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
  ],
});

const servers: ContractServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("postChat", () => {
  it("retries a 429 and then returns the 200", async () => {
    const server = await startContractServer((_request, response, index) => {
      if (index === 0) {
        response.writeHead(429, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "slow down" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(COMPLETION);
    });
    servers.push(server);

    const result = await postChat(
      {
        url: `${server.origin}/chat/completions`,
        headers: { Authorization: "Bearer sk-test" },
      },
      { model: "m", messages: [{ role: "user", content: "Hi" }] },
    );

    expect(server.requests).toHaveLength(2);
    expect(result).toMatchObject({ id: "chatcmpl-1" });
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });

  it("does not open a second request after one SSE chunk and a failure", async () => {
    const server = await startContractServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const payload = JSON.stringify({ choices: [{ delta: { content: "Hi" } }] });
      response.write(`data: ${payload}\n\n`, () => {
        response.destroy();
      });
    });
    servers.push(server);

    const chunks: unknown[] = [];
    let failure: unknown;
    try {
      for await (const chunk of postChatStream(
        { url: `${server.origin}/chat/completions`, headers: { Authorization: "Bearer sk-test" } },
        { model: "m", stream: true },
      )) {
        chunks.push(chunk);
      }
      expect.fail("expected the stream to fail");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SDKError);
    expect((failure as SDKError).message).not.toContain("sk-test");
    expect((failure as SDKError).message).not.toContain("Bearer");
    expect(chunks).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
  });

  it("yields SSE chunks until [DONE]", async () => {
    const server = await startContractServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" } }] })}\n\ndata: [DONE]\n\n`,
      );
    });
    servers.push(server);

    const chunks = [];
    for await (const chunk of postChatStream(
      { url: `${server.origin}/chat/completions`, headers: {} },
      { model: "m", stream: true },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ choices: [{ delta: { content: "Hi" } }] }]);
    expect(server.requests).toHaveLength(1);
  });

  it("returns a 429 with Retry-After 30 without waiting it out", async () => {
    const server = await startContractServer((_request, response) => {
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
      });
      response.end(JSON.stringify({ error: { message: "later" } }));
    });
    servers.push(server);

    const started = Date.now();
    await expect(
      postChat({ url: `${server.origin}/chat/completions`, headers: {} }, { model: "m" }),
    ).rejects.toMatchObject({ code: "provider_error", status: 429 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(server.requests).toHaveLength(1);
  });

  it("maps an OpenAI error body to provider_error without echoing credentials", async () => {
    const server = await startContractServer((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "nope" } }));
    });
    servers.push(server);

    const secret = "Bearer sk-test";
    try {
      await postChat(
        {
          url: `${server.origin}/chat/completions`,
          headers: { Authorization: secret, "api-key": "sk-test" },
        },
        { model: "m" },
      );
      expect.fail("expected provider_error");
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      const sdk = error as SDKError;
      expect(sdk.code).toBe("provider_error");
      expect(sdk.message).toBe("nope");
      expect(sdk.status).toBe(400);
      expect(sdk.message).not.toContain(secret);
      expect(sdk.message).not.toContain("sk-test");
      expect(String(sdk.cause)).toContain("nope");
      expect(server.requests[0]?.headers.authorization).toBe(secret);
    }
  });

  it("does not retry after the caller aborts", async () => {
    let arrived: () => void = () => {};
    const firstResponse = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = await startContractServer((_request, response) => {
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "1",
      });
      response.end(JSON.stringify({ error: { message: "later" } }));
      arrived();
    });
    servers.push(server);

    const controller = new AbortController();
    const pending = postChat(
      {
        url: `${server.origin}/chat/completions`,
        headers: { Authorization: "Bearer sk-test" },
      },
      { model: "m" },
      { signal: controller.signal },
    );
    await firstResponse;
    controller.abort();

    try {
      await pending;
      expect.fail("expected aborted");
    } catch (error) {
      expect(error).toBeInstanceOf(SDKError);
      const sdk = error as SDKError;
      expect(sdk.code).toBe("aborted");
      expect(sdk.message).not.toContain("sk-test");
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(server.requests).toHaveLength(1);
  });
});
