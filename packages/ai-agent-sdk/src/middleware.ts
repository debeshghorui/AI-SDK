import type { WireChatRequest } from "./chat/types.js";
import type { WireChatResponse } from "./provider.js";

export type MiddlewareContext = {
  operation: "chat" | "agent";
  providerId: string;
  threadId?: string;
  request: WireChatRequest;
};

export type Middleware = (
  context: MiddlewareContext,
  next: () => Promise<WireChatResponse>,
) => Promise<WireChatResponse>;

export async function runMiddleware(
  middleware: readonly Middleware[],
  context: MiddlewareContext,
  terminal: () => Promise<WireChatResponse>,
): Promise<WireChatResponse> {
  const dispatch = (index: number): Promise<WireChatResponse> => {
    const current = middleware[index];
    if (current === undefined) return terminal();
    return current(context, () => dispatch(index + 1));
  };
  return dispatch(0);
}
