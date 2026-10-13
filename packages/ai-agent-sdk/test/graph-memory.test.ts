import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "ai-agent-sdk";
import type { ChatMessage } from "../src/chat/types.ts";
import { createGraphMemory } from "../src/memory/graph.ts";
import type { ChatCallOptions, Provider, WireChatRequest } from "../src/provider.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-agent-sdk-"));
  dirs.push(dir);
  return join(dir, "memory.lbdb");
}

const turn: ChatMessage[] = [
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello" },
];

describe("createGraphMemory", () => {
  it("appends a turn and loads it back in order", async () => {
    const path = await databasePath();
    const memory = createGraphMemory({ path });

    await memory.append("thread-1", turn);

    expect(await memory.load("thread-1")).toEqual(turn);
  });

  it("returns the first turn from a second connection on the same file", async () => {
    const path = await databasePath();
    const first = createGraphMemory({ path });
    await first.append("thread-1", turn);

    const second = createGraphMemory({ path });
    expect(await second.load("thread-1")).toEqual(turn);
  });

  it("returns a remembered triple from search on a new connection", async () => {
    const path = await databasePath();
    const first = createGraphMemory({ path });
    await first.remember?.({ subject: "ada", predicate: "likes", object: "graphs" });
    await first.remember?.({ subject: "ada", predicate: "likes", object: "graphs" });

    const second = createGraphMemory({ path });
    const facts = await second.search?.("graphs", 10);

    expect(facts).toEqual([{ subject: "ada", predicate: "likes", object: "graphs" }]);
  });

  it("leaves the thread empty when chat fails", async () => {
    const path = await databasePath();
    const memory = createGraphMemory({ path });
    const provider: Provider = {
      id: "openai",
      async chat() {
        throw new Error("provider down");
      },
      async *chatStream() {
        // The failing call is not a stream.
      },
    };
    const client = createClient({ provider, memory });

    await expect(
      client.chat.completions.create({
        model: "m",
        messages: [{ role: "user", content: "Hi" }],
        threadId: "thread-1",
      }),
    ).rejects.toThrow("provider down");
    expect(await memory.load("thread-1")).toEqual([]);
  });

  it("sends the stored window plus the new messages and appends only after success", async () => {
    const path = await databasePath();
    const memory = createGraphMemory({ path, maxMessages: 2 });
    await memory.append("thread-1", [
      { role: "system", content: "Be brief" },
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "user", content: "three" },
    ]);

    const bodies: WireChatRequest[] = [];
    const provider: Provider = {
      id: "openai",
      async chat(request: WireChatRequest, _options: ChatCallOptions) {
        bodies.push(request);
        return {
          choices: [{ index: 0, message: { role: "assistant", content: "four" }, finish_reason: "stop" }],
        };
      },
      async *chatStream() {
        // This call is not a stream.
      },
    };
    const client = createClient({ provider, memory });

    await client.chat.completions.create({
      model: "m",
      messages: [{ role: "user", content: "next" }],
      threadId: "thread-1",
    });

    expect(bodies[0]?.messages).toEqual([
      { role: "system", content: "Be brief" },
      { role: "user", content: "three" },
      { role: "user", content: "next" },
    ]);
    expect(await memory.load("thread-1")).toEqual([
      { role: "system", content: "Be brief" },
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "user", content: "three" },
      { role: "user", content: "next" },
      { role: "assistant", content: "four" },
    ]);
  });
});
