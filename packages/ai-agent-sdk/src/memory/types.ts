import type { ChatMessage } from "../chat/types.js";

export interface Memory {
  load(threadId: string): Promise<ChatMessage[]>;
  append(threadId: string, messages: ChatMessage[]): Promise<void>;
  remember?(fact: {
    subject: string;
    predicate: string;
    object: string;
    threadId?: string;
  }): Promise<void>;
  search?(
    query: string,
    limit: number,
  ): Promise<Array<{ subject: string; predicate: string; object: string }>>;
}
