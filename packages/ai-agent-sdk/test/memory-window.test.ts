import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/chat/types.ts";
import { selectMessages } from "../src/memory/window.ts";

function system(content: string): ChatMessage {
  return { role: "system", content };
}

function user(content: string): ChatMessage {
  return { role: "user", content };
}

describe("selectMessages", () => {
  it("keeps fitting system messages and the newest non-system messages up to maxMessages", () => {
    const stored: ChatMessage[] = [];
    for (let i = 0; i < 30; i += 1) {
      stored.push(i % 6 === 0 ? system(`sys-${i}`) : user(`user-${i}`));
    }

    const selected = selectMessages(stored, 10);

    expect(selected).toHaveLength(10);
    expect(selected.map((message) => message.content)).toEqual([
      "sys-0",
      "sys-6",
      "sys-12",
      "sys-18",
      "sys-24",
      "user-25",
      "user-26",
      "user-27",
      "user-28",
      "user-29",
    ]);
    expect(selected.map((message) => message.content)).not.toContain("user-1");
  });

  it("keeps at most 20 oldest system messages, then fills the rest with newest non-system messages", () => {
    const stored: ChatMessage[] = [];
    for (let i = 0; i < 25; i += 1) stored.push(system(`sys-${i}`));
    for (let i = 0; i < 5; i += 1) stored.push(user(`user-${i}`));

    const selected = selectMessages(stored, 22);

    expect(selected.map((message) => message.content)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => `sys-${i}`),
      "user-3",
      "user-4",
    ]);
  });
});
