import type { ChatMessage } from "../chat/types.js";

const MAX_SYSTEM_MESSAGES = 20;

export function selectMessages(stored: ChatMessage[], maxMessages: number): ChatMessage[] {
  const systems: ChatMessage[] = [];
  const rest: ChatMessage[] = [];
  for (const message of stored) {
    if (message.role === "system") systems.push(message);
    else rest.push(message);
  }

  const chosenSystems = systems.slice(0, Math.min(MAX_SYSTEM_MESSAGES, Math.max(0, maxMessages)));
  const room = maxMessages - chosenSystems.length;
  const chosenRest = room > 0 ? rest.slice(-room) : [];
  return [...chosenSystems, ...chosenRest];
}
