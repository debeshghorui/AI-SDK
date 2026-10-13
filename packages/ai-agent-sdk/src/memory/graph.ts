import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Connection, Database, QueryResult } from "@ladybugdb/core";
import type { ChatMessage, ToolCall } from "../chat/types.js";
import { SDKError } from "../errors.js";
import type { Memory } from "./types.js";

const require = createRequire(import.meta.url);

const DEFAULT_PATH = ".ai-agent-sdk/memory.lbdb";
const DEFAULT_MAX_MESSAGES = 50;
const MAX_SEARCH_LIMIT = 50;

const SCHEMA = `
CREATE NODE TABLE IF NOT EXISTS Thread(id STRING, PRIMARY KEY (id));
CREATE NODE TABLE IF NOT EXISTS Message(
  id STRING,
  threadId STRING,
  seq INT64,
  role STRING,
  content STRING,
  toolCallId STRING,
  toolCalls STRING,
  PRIMARY KEY (id)
);
CREATE NODE TABLE IF NOT EXISTS Entity(id STRING, name STRING, PRIMARY KEY (id));
CREATE REL TABLE IF NOT EXISTS HAS_MESSAGE(FROM Thread TO Message);
CREATE REL TABLE IF NOT EXISTS RELATION(
  FROM Entity TO Entity,
  predicate STRING,
  threadId STRING,
  createdAt STRING
);
`;

const LOAD = `
MATCH (m:Message {threadId: $threadId})
RETURN m.role AS role, m.content AS content, m.toolCallId AS toolCallId, m.toolCalls AS toolCalls, m.seq AS seq
ORDER BY m.seq
`;

const MAX_SEQ = `
MATCH (m:Message {threadId: $threadId})
RETURN max(m.seq) AS maxSeq
`;

const INSERT = `
MERGE (t:Thread {id: $threadId})
CREATE (m:Message {
  id: $id,
  threadId: $threadId,
  seq: $seq,
  role: $role,
  content: $content,
  toolCallId: $toolCallId,
  toolCalls: $toolCalls
})
CREATE (t)-[:HAS_MESSAGE]->(m)
`;

const REMEMBER = `
MERGE (s:Entity {id: $subject})
ON CREATE SET s.name = $subject
MERGE (o:Entity {id: $object})
ON CREATE SET o.name = $object
MERGE (s)-[r:RELATION {predicate: $predicate, threadId: $threadId}]->(o)
ON CREATE SET r.createdAt = $createdAt
`;

const SEARCH = `
MATCH (s:Entity)-[r:RELATION]->(o:Entity)
WHERE contains(lower(s.name), $query)
  OR contains(lower(r.predicate), $query)
  OR contains(lower(o.name), $query)
RETURN s.name AS subject, r.predicate AS predicate, o.name AS object
ORDER BY r.createdAt DESC
LIMIT $limit
`;

type LadybugModule = {
  Database: typeof Database;
  Connection: typeof Connection;
};

type QueryParams = Record<string, string | number>;

export type GraphMemory = Memory & { maxMessages: number };

export function createGraphMemory(options?: { path?: string; maxMessages?: number }): GraphMemory {
  const path = options?.path ?? DEFAULT_PATH;
  const maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const lbug = loadLadybug();
  const connection = openConnection(lbug, path);
  const queue = createQueue(connection);

  return {
    maxMessages,
    load(threadId) {
      return queue.run(async () => {
        const rows = await queue.query(LOAD, { threadId });
        return rows.map(toMessage);
      });
    },
    append(threadId, messages) {
      return queue.run(async () => {
        const existing = await queue.query(MAX_SEQ, { threadId });
        let seq = existing.length === 0 ? 0 : numberValue(existing[0]?.maxSeq);
        for (const message of messages) {
          seq += 1;
          const fields = messageFields(message);
          await queue.query(INSERT, {
            threadId,
            id: crypto.randomUUID(),
            seq,
            role: fields.role,
            content: fields.content,
            toolCallId: fields.toolCallId,
            toolCalls: fields.toolCalls,
          });
        }
      });
    },
    remember(fact) {
      return queue.run(async () => {
        await queue.query(REMEMBER, {
          subject: normalizeEntity(fact.subject),
          object: normalizeEntity(fact.object),
          predicate: fact.predicate,
          threadId: fact.threadId ?? "",
          createdAt: new Date().toISOString(),
        });
      });
    },
    search(query, limit) {
      return queue.run(async () => {
        const capped = Math.min(MAX_SEARCH_LIMIT, Math.max(0, Math.floor(limit)));
        const rows = await queue.query(SEARCH, { query: query.toLowerCase(), limit: capped });
        return rows.map((row) => ({
          subject: text(row.subject),
          predicate: text(row.predicate),
          object: text(row.object),
        }));
      });
    },
  };
}

function loadLadybug(): LadybugModule {
  try {
    return require("@ladybugdb/core") as LadybugModule;
  } catch (error) {
    throw new SDKError("unsupported_runtime", "The Ladybug native addon failed to load", { cause: error });
  }
}

function openConnection(lbug: LadybugModule, path: string): Connection {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const database = new lbug.Database(path);
    return new lbug.Connection(database);
  } catch (error) {
    throw asMemoryError(error);
  }
}

function createQueue(connection: Connection) {
  let chain = Promise.resolve();
  let schemaReady = false;

  async function run<T>(work: () => Promise<T>): Promise<T> {
    const result = chain.then(work, work);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function query(statement: string, params?: QueryParams): Promise<Array<Record<string, unknown>>> {
    try {
      if (!schemaReady) {
        await readRows(await connection.query(SCHEMA));
        schemaReady = true;
      }
      if (params === undefined) return readRows(await connection.query(statement));
      const prepared = await connection.prepare(statement);
      if (!prepared.isSuccess()) throw new Error(prepared.getErrorMessage());
      return readRows(await connection.execute(prepared, params));
    } catch (error) {
      throw asMemoryError(error);
    }
  }

  return { run, query };
}

async function readRows(result: QueryResult | QueryResult[]): Promise<Array<Record<string, unknown>>> {
  const results = Array.isArray(result) ? result : [result];
  const rows: Array<Record<string, unknown>> = [];
  for (const item of results) {
    rows.push(...(await item.getAll()));
    item.close();
  }
  return rows;
}

function asMemoryError(error: unknown): SDKError {
  if (error instanceof SDKError) return error;
  const message = error instanceof Error ? error.message : "Memory query failed";
  return new SDKError("memory_error", message, { cause: error });
}

function messageFields(message: ChatMessage): {
  role: string;
  content: string;
  toolCallId: string;
  toolCalls: string;
} {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, toolCallId: message.tool_call_id, toolCalls: "" };
  }
  if (message.role === "assistant" && message.tool_calls !== undefined) {
    return {
      role: "assistant",
      content: message.content,
      toolCallId: "",
      toolCalls: JSON.stringify(message.tool_calls),
    };
  }
  return { role: message.role, content: message.content, toolCallId: "", toolCalls: "" };
}

function toMessage(row: Record<string, unknown>): ChatMessage {
  const role = text(row.role);
  const content = text(row.content);
  if (role === "system") return { role: "system", content };
  if (role === "user") return { role: "user", content };
  if (role === "tool") return { role: "tool", content, tool_call_id: text(row.toolCallId) };
  const toolCalls = text(row.toolCalls);
  if (toolCalls.length > 0) {
    return { role: "assistant", content, tool_calls: JSON.parse(toolCalls) as ToolCall[] };
  }
  return { role: "assistant", content };
}

function normalizeEntity(value: string): string {
  return value.trim().toLowerCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}
