# AI Agent SDK — Product Requirements

> Status: draft for review. Date: 2026-10-13.
>
> This document is the spec a builder plans from. What you said is marked **decided**. What I chose so the spec is buildable is marked **my call**. Correct any call and we revise this file before an implementation plan.

Working package name: `ai-agent-sdk`. Rename is free and does not change the design.

## Intent

Build a production SDK that application code can depend on. A developer binds one OpenAI-compatible provider, calls chat in the shape of the OpenAI SDK, and can replace that provider with another without rewriting the call. Memory and traces are part of the product, present on every install, with no extra package and no setup step required for the defaults to work.

The product is the combination: an OpenAI-shaped client, swappable OpenAI-compatible providers, thread memory, request traces, and a tool loop. A create-app command scaffolds a runnable project the way Create Next App and Create Vite do. Later capabilities, starting with speech, attach the same way a provider does.

## Who it is for

A TypeScript developer who already knows the OpenAI chat completions client and wants the same calls to run against OpenAI, Groq, Mistral, Ollama, or Azure OpenAI. They want a thread to continue by id, and they want a record of each call without standing up an observability stack first.

## Goals

1. One client surface for chat completions, streaming and non-streaming, across the five providers below.
2. Replacing the provider is a constructor change. The chat call stays. Replacing memory is also a constructor change. The chat call and the agent call stay.
3. Memory and traces work on a fresh install with defaults.
4. An agent can call tools in a loop until the model answers or a step cap is hit.
5. A later capability (speech, and others of the same kind) can be added as another package without changing the chat core.
6. The default test suite passes with zero API keys.
7. `npm create ai-agent-sdk@latest` scaffolds a runnable TypeScript app bound to one of the five providers.

## Outside v1

- Speech, audio, images, embeddings, files, the Assistants API, the Responses API, and realtime.
- Providers that are not OpenAI-compatible on the wire (native Anthropic Messages, native Gemini).
- A hosted gateway, a vector store, retrieval, evals, a chat UI, and multi-agent handoffs.
- A streaming agent loop. The tool loop in v1 returns one final result after the steps finish.
- Message content other than a string. Image parts, audio parts, and content-part arrays are rejected with a typed error.
- Python, and any runtime without global `fetch`.
- Repair loops that re-ask the model when structured output fails validation.
- A memory service that is not a graph database the agent queries through the `Memory` interface.
- A hidden model call that extracts facts. Facts enter the graph when the agent calls `memory_remember`, or when application code calls `remember`.
- A long-running CLI inside the SDK (`ai-agent-sdk dev` as a server). The create command is one shot, then the generated app's own scripts run it.
- Extra scaffolds that emit a Next.js app, a Vite frontend, or any other web framework. v1 ships one Node template.

## Anti-goals

These count as failure even if the tests pass:

- A thin `fetch` wrapper with five URLs and no stable contract.
- A framework that requires the application to be structured in our style.
- Traces or logs that record API keys, `Authorization` headers, or `api-key` headers.
- Traces that record prompt or completion text unless the caller opts in.
- A provider swap that forces the chat call to change.
- A memory swap that forces the chat call or the agent call to change.
- Traces or logs that record a database password or a URI userinfo section.

## What you decided

- The quality bar is a product other people could depend on.
- Providers ship as plugins: `openai()`, `groq()`, `mistral()`, `ollama()`, `azureOpenAI()`. The OpenAI import is `ai-agent-sdk/openai`. Groq, Mistral, Ollama, Azure OpenAI, Neo4j, and Memgraph use that same subpath form.
- All five speak the OpenAI-compatible HTTP chat API. The core treats them as the same kind of endpoint.
- Dropping one provider in or replacing it with another leaves the calling code in place. The feel to match is the OpenAI SDK.
- Memory ships in the box as a local graph database, with tools the agent can call. A `Map` is not the store.
- Hosted graph databases plug in the same way providers do. An adapter takes the database link and credentials. Neo4j is one of those adapters.
- `neo4j()` with no arguments reads `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` from the environment. A field passed in the argument object overrides that field's environment value. The same rule applies to provider keys.
- Tool input, tool output, environment values, and client options are validated with Zod. Unknown keys fail.
- An agent is built with `tool()` and `new Agent()`, then started with `run()`. The shape matches the OpenAI Agents SDK sample.
- Full traces ship in the box.
- Speech and similar later features drop in beside the core.
- A project is created from the command line the way a Next or Vite app is created.

## Calls I made

Correct these in review. Until you do, the rest of this document treats them as requirements.

| # | Call |
| --- | --- |
| 1 | Language is TypeScript. Packages are ESM. Chat calls need global `fetch` (Node 20+, and edge runtimes that provide `fetch`). The default graph memory is a native addon, so it runs on Node 20+. |
| 2 | The compatible surface is `client.chat.completions.create`. `stream: true` returns an async iterable of OpenAI chat chunks. There is no separate `stream` method. |
| 3 | A provider is bound on the client: `createClient({ provider })`. Swapping providers means constructing another client. |
| 4 | Memory and tracing are built into the core package and enabled by default. They are implemented as internal middleware so a later capability uses the same extension point. |
| 5 | Default memory is an on-disk graph in [Ladybug](https://ladybugdb.com/) (`@ladybugdb/core`), an embedded database descended from Kuzu. Thread messages and facts survive a process restart. A `Map` is not a memory implementation. |
| 6 | Traces redact secrets always, omit message text by default, and are readable in-process without a collector. If an OpenTelemetry tracer is registered, the same spans are emitted there. |
| 7 | The agent API is `tool()`, `new Agent()`, and `run()`, in the shape of the OpenAI Agents SDK. Tool arguments are the Zod schema on `parameters`. Agent structured output is the Zod schema on `outputType`. |
| 8 | The repository layout for implementation is a pnpm workspace under `packages/`. This wiki's `raw/` and `wiki/` stay as they are. |
| 9 | One shared contract test defines "OpenAI-compatible" for this SDK. Each provider package must pass it against a local mock. |
| 10 | The setup CLI is `create-ai-agent-sdk`, invoked as `npm create ai-agent-sdk@latest`. It writes one Node TypeScript app and installs dependencies. It does not generate a Next.js or Vite frontend. |
| 11 | v1 hosted adapters are Neo4j (`neo4j()`, including Neo4j Aura) and Memgraph (`memgraph()`). Both use the official `neo4j-driver` over Bolt. Another graph database is a later package with the same `Memory` methods. |
| 12 | The dependency is `zod` `^4.0.0`. SDK-owned objects use `z.strictObject`. Tool schemas are converted for the wire with `z.toJSONSchema(schema, { target: "draft-07" })`. |

## Packages

| Entry | Responsibility |
| --- | --- |
| `ai-agent-sdk` | Client, chat completions, streaming collect helper, `Memory` interface, Ladybug default, traces, `tool`, `Agent`, `run`, middleware, errors |
| `ai-agent-sdk/openai` | OpenAI provider |
| `ai-agent-sdk/groq` | Groq provider |
| `ai-agent-sdk/mistral` | Mistral provider |
| `ai-agent-sdk/ollama` | Ollama provider |
| `ai-agent-sdk/azure-openai` | Azure OpenAI provider |
| `ai-agent-sdk/neo4j` | Neo4j and Neo4j Aura memory adapter |
| `ai-agent-sdk/memgraph` | Memgraph memory adapter |
| `create-ai-agent-sdk` | One-shot scaffolder. Bin name `create-ai-agent-sdk`. |

These entries except the scaffolder are one npm package, `ai-agent-sdk`, with an `exports` map. The root entry does not import a provider or `neo4j-driver`. `neo4j-driver` is an optional peer dependency, used only by `ai-agent-sdk/neo4j` and `ai-agent-sdk/memgraph`. The package depends on `zod` `^4.0.0`, `@ladybugdb/core`, and `@opentelemetry/api`. The SDK does not start a collector or a database server.

## Public API

```ts
import { createClient } from "ai-agent-sdk";
import { openai } from "ai-agent-sdk/openai";
import { groq } from "ai-agent-sdk/groq";

const client = createClient({
  provider: openai(), // reads OPENAI_API_KEY
});

const completion = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
});

const groqClient = createClient({
  provider: groq(),
});

await groqClient.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [{ role: "user", content: "Hello" }],
});
```

The second call is the same method, the same request fields, and the same response shape. Only the client binding and the model id change.

### `createClient`

```ts
function createClient(options: {
  provider: Provider;
  memory?: Memory | false;       // default: on-disk Ladybug graph
  traces?: TracerOptions | false; // default: on, content omitted
  middleware?: Middleware[];
  timeoutMs?: number;            // default: 60_000
  maxRetries?: number;           // default: 2
}): Client;
```

`memory: false` and `traces: false` turn that subsystem off for the client. Omitting them leaves the defaults on.

### Chat request

`client.chat.completions.create` accepts this subset of the OpenAI chat completions request. The request is parsed with a `z.strictObject` schema. Unknown fields fail with `invalid_request`. They are not silently dropped and not forwarded.

| Field | Rule |
| --- | --- |
| `model` | Required string. For Azure this is the deployment name. |
| `messages` | Required. Roles: `system`, `user`, `assistant`, `tool`. `content` is a string. `tool` messages require `tool_call_id`. `assistant` messages may include `tool_calls`. |
| `temperature` | Optional number. |
| `top_p` | Optional number. |
| `max_tokens` | Optional integer. |
| `stop` | Optional string or array of strings. |
| `seed` | Optional integer. |
| `user` | Optional string. Sent to the provider. Stored on the trace as an attribute. |
| `tools` | Optional OpenAI function-tool array (`type: "function"`). |
| `tool_choice` | Optional `"none" \| "auto" \| "required" \| { type: "function", function: { name } }`. |
| `response_format` | Optional `{ type: "text" }`, `{ type: "json_object" }`, or `{ type: "json_schema", json_schema: { name, schema, strict? } }`. |
| `output` | Optional Zod schema. Our extension. The SDK turns it into `response_format` and parses `message.content`. Mutually exclusive with `response_format`. Mutually exclusive with `stream: true`. |
| `stream` | Optional boolean. Default `false`. |
| `threadId` | Optional string. Our extension. When set, memory loads and appends for that thread. |
| `signal` | Optional `AbortSignal`. |

`n` is outside the subset. Callers who need multiple choices send multiple requests.

### Chat response

Non-streaming responses match the OpenAI chat completion object for the fields we receive from the provider:

- `id`, `object`, `created`, `model`
- `choices[].index`, `choices[].message` (`role`, `content`, `tool_calls`), `choices[].finish_reason`
- `usage` when the provider sends it (`prompt_tokens`, `completion_tokens`, `total_tokens`)

Plus one extension field, `traceId: string`, on every response, including streams' final metadata via the collect helper below.

When `output` was passed, the response also has `output`, the value parsed from `choices[0].message.content`. The original string stays on `message.content`.

Streaming: `stream: true` returns `AsyncIterable<ChatCompletionChunk>` in the OpenAI chunk shape (`choices[].delta`). The iterable stops when the provider stream ends. Aborting the signal cancels the read.

```ts
function collectStream(
  stream: AsyncIterable<ChatCompletionChunk>,
): Promise<ChatCompletion>;
```

`collectStream` concatenates content deltas and assembles `tool_calls` into the same message shape as a non-streaming response.

### Provider factories

Every factory with no arguments reads its key and URL from the environment names in the table below. Each field in the argument object overrides that one environment value. Other fields still come from the environment. An empty string in the argument is a value, so it overrides and does not fall through.

```ts
openai();                              // OPENAI_API_KEY
openai({ apiKey: "sk-explicit" });     // argument wins over OPENAI_API_KEY
```

Every factory accepts:

```ts
type ProviderConfig = {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};
```

| Factory | Default base URL | Key |
| --- | --- | --- |
| `openai(config?)` | `https://api.openai.com/v1` | `config.apiKey` or `OPENAI_API_KEY`. Required at construction. |
| `groq(config?)` | `https://api.groq.com/openai/v1` | `config.apiKey` or `GROQ_API_KEY`. Required at construction. |
| `mistral(config?)` | `https://api.mistral.ai/v1` | `config.apiKey` or `MISTRAL_API_KEY`. Required at construction. |
| `ollama(config?)` | `config.baseURL` or `OLLAMA_BASE_URL` or `http://127.0.0.1:11434/v1` | Optional. A Bearer token is sent only when a key is present. |
| `azureOpenAI(config)` | Derived from endpoint | Required at construction. |

Azure config extends `ProviderConfig`:

```ts
type AzureConfig = ProviderConfig & {
  endpoint?: string;     // https://{resource}.openai.azure.com
  apiVersion?: string;   // default "2024-10-21"
};
```

`endpoint` comes from the argument or `AZURE_OPENAI_ENDPOINT`. The key comes from `apiKey` or `AZURE_OPENAI_API_KEY`. Both are required at construction.

Azure requests go to:

`{endpoint}/openai/deployments/{model}/chat/completions?api-version={apiVersion}`

with header `api-key`, not `Authorization: Bearer`. `model` is the deployment name and is also sent in the JSON body.

A missing required key or a missing Azure endpoint throws `SDKError` with code `missing_config` when the factory runs.

### Provider interface

```ts
interface Provider {
  readonly id: "openai" | "groq" | "mistral" | "ollama" | "azure-openai";
  chat(
    request: WireChatRequest,
    options: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<WireChatResponse>;
  chatStream(
    request: WireChatRequest,
    options: { signal?: AbortSignal; headers?: Record<string, string> },
  ): AsyncIterable<WireChatChunk>;
}
```

`WireChatRequest` is the OpenAI JSON body for the supported fields, without `threadId`, `signal`, or other SDK-only fields.

The four Bearer providers POST `{baseURL}/chat/completions` with `Authorization: Bearer {apiKey}` and `Content-Type: application/json`. Ollama omits `Authorization` when no key was configured. Azure uses the URL and header above.

HTTP handling lives in one shared helper inside core, `postChat`, which provider packages call. Providers differ by base URL, auth header, and Azure's path. They do not reimplement streaming parse logic.

### Errors

```ts
class SDKError extends Error {
  readonly code:
    | "missing_config"
    | "invalid_request"
    | "provider_error"
    | "timeout"
    | "aborted"
    | "invalid_output"
    | "tool_failed"
    | "max_steps"
    | "unsupported_runtime"
    | "memory_error";
  readonly provider?: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly traceId?: string;
}
```

Provider HTTP errors become `provider_error` and keep `status` plus the provider's `error.message` when the body is JSON of the OpenAI error shape. The raw body is available as `cause` for programmers and is never written to a trace.

### Retries and timeouts

- Default timeout is 60 seconds, measured until response headers for both modes. Streaming then has an additional 60 seconds of idle time between chunks. The overall streaming cap is 10 minutes. Any of these firing aborts the attempt with `timeout`.
- `signal` aborting produces `aborted` and does not retry.
- Retryable failures: network errors, HTTP 408, 409, 429, and 500–599, on attempts that have not yet delivered a stream chunk.
- Default `maxRetries` is 2 (three attempts total). Backoff is 200ms, then 800ms, plus up to 100ms of jitter. A `Retry-After` header (seconds or HTTP-date) overrides the backoff for 429 and 503 when it is under 10 seconds. Larger `Retry-After` values are not waited out; the error is returned.
- Once a stream has yielded a chunk, that attempt is not retried.
- A retry can duplicate a generation the provider already accepted. That limit is documented on `createClient`.

### Memory

Default memory is `createGraphMemory`. It opens a Ladybug database file and keeps one connection. All queries run through one queue so two calls cannot use that connection at the same time. Ladybug is a dependency of `ai-agent-sdk`.

```ts
function createGraphMemory(options?: {
  path?: string;          // default: ".ai-agent-sdk/memory.lbdb"
  maxMessages?: number;   // default: 50
}): Memory;
```

The default path is relative to the process working directory. Parent directories are created when the file is opened. `createClient` with `memory` omitted calls `createGraphMemory()` with those defaults.

If the native addon cannot load, `createClient` throws `SDKError` `unsupported_runtime` unless the caller passed `memory: false` or a custom `Memory`. There is no `Map` fallback.

```ts
interface Memory {
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
```

`createGraphMemory` implements all four methods. A custom store may implement only `load` and `append`.

Schema, created when the file is first opened:

- `Thread` node: `id` string, primary key.
- `Message` node: `id` string primary key, `threadId` string, `seq` int, `role` string, `content` string, `toolCallId` string, `toolCalls` string (JSON).
- `Entity` node: `id` string primary key, `name` string. `id` and `name` are the trimmed, lowercased subject or object.
- Relation `HAS_MESSAGE` from `Thread` to `Message`.
- Relation `RELATION` from `Entity` to `Entity`, with `predicate` string, `threadId` string, `createdAt` string (ISO-8601).

When `threadId` is set:

1. Load every `Message` on that thread, ordered by `seq`.
2. Choose what to send. Include up to 20 stored system messages, oldest first. Then include the newest non-system messages until the sent list reaches `maxMessages`. Rows that are not sent stay stored.
3. Send that list, then the new request messages. The request's own messages are not trimmed.
4. On success, append the request messages and the assistant message (or, for a stream, the collected assistant message). `seq` is one greater than the current max for that thread, starting at 1.
5. On failure, append nothing.

When `threadId` is omitted, the call does not read or write messages. `memory_search` can still see facts stored earlier.

`remember` merges the two entities and writes one `RELATION`. The same subject, predicate, object, and thread id a second time does not create a second edge. `threadId` may be an empty string when the caller has no thread.

`search` lowercases `query` and returns relations whose subject, predicate, or object contains that string. `limit` defaults to 10 when a tool calls it, and the method itself requires a limit. The maximum limit is 50. Results are ordered by `createdAt` descending.

`createClient({ memory })` replaces the default store. `memory: false` disables loading, appending, and the memory tools. Passing `neo4j()` or `memgraph()` leaves `chat.completions.create`, `run()`, `threadId`, `memory_remember`, and `memory_search` unchanged.

#### Hosted adapters

```ts
import { neo4j } from "ai-agent-sdk/neo4j";

createClient({
  provider: openai(),
  memory: neo4j(),
});

createClient({
  provider: openai(),
  memory: neo4j({
    uri: "neo4j+s://xxxx.databases.neo4j.io",
    username: "neo4j",
    password: process.env.NEO4J_PASSWORD,
  }),
});
```

The first call reads `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` from the environment. The second call uses the `uri` and `username` arguments. `password` is the argument that was passed. `database` was omitted, so it still comes from `NEO4J_DATABASE`, then `"neo4j"`. `memgraph()` follows the same field-by-field rule with the `MEMGRAPH_*` names.

```ts
function neo4j(config?: {
  uri?: string;
  username?: string;
  password?: string;
  database?: string;
  maxMessages?: number;
}): Memory;

function memgraph(config?: {
  uri?: string;
  username?: string;
  password?: string;
  maxMessages?: number;
}): Memory;
```

| Adapter | Link | Credentials | Defaults |
| --- | --- | --- | --- |
| `neo4j` | `uri` or `NEO4J_URI` | `username` or `NEO4J_USERNAME`, `password` or `NEO4J_PASSWORD` | `database` or `NEO4J_DATABASE` or `"neo4j"`. No default URI. |
| `memgraph` | `uri` or `MEMGRAPH_URI` | `username` or `MEMGRAPH_USERNAME`, `password` or `MEMGRAPH_PASSWORD` | URI `bolt://127.0.0.1:7687`. Username and password may be omitted. |

`uri`, `username`, and `password` are required for Neo4j at construction. A missing one throws `missing_config`. Memgraph requires a URI only after the default above is applied.

The URI is a host link: `bolt://`, `bolt+s://`, `neo4j://`, or `neo4j+s://`. A URI that contains userinfo (`scheme://user:pass@host`) throws `invalid_request`. Credentials are the separate arguments, so a logged URI cannot contain the password.

Each adapter opens one driver at construction and checks connectivity. A refused connection or a rejected login throws `memory_error`. Later query failures throw `memory_error` and do not append a partial turn.

The logical graph matches the Ladybug section: labels `Thread`, `Message`, and `Entity`; relationships `HAS_MESSAGE` and `RELATION` with `predicate`, `threadId`, and `createdAt`. Neo4j creates a uniqueness constraint on `Thread.id`, `Message.id`, and `Entity.id`. Memgraph creates the same constraints when the server accepts them. Writes use `MERGE` for entities and for the exact subject, predicate, object, and thread id. Reads order messages by `seq` and facts by `createdAt` descending, with the same window and search rules as Ladybug.

`maxMessages` defaults to 50 on every adapter.

#### Memory tools

When the bound memory implements `remember` and `search`, `run()` adds these tools to the agent's tool list, and handles them itself:

| Tool | Arguments | Result |
| --- | --- | --- |
| `memory_remember` | `subject`, `predicate`, `object` (required strings) | `{ ok: true }` |
| `memory_search` | `query` (required string), `limit` (optional integer) | `{ facts: Array<{ subject, predicate, object }> }` |

`memory_remember` stores `threadId` from the `run()` options when one was passed. A user tool named `memory_remember` or `memory_search` makes `run()` throw `invalid_request` before the first model call. A custom memory without `remember` and `search` does not add these tools. The SDK's own parameter schemas for these two tools are the strict objects in the validation section.

### Traces

Every `chat.completions.create` and every `run()` produces a trace even when the call fails.

In-process buffer: the last 200 spans, newest kept, readable with `client.traces.list(): readonly Span[]`. `client.traces.clear()` empties the buffer. The buffer is per client.

```ts
type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: "chat.completions" | "chat.completions.attempt" | "agent.run" | "agent.tool";
  startTime: string; // ISO-8601
  endTime: string;
  attributes: Record<string, string | number | boolean>;
  status: "ok" | "error";
  errorCode?: string;
};
```

Attributes always set when known: `provider`, `model`, `stream`, `http.status`, `attempt`, `threadId` (present only when the caller passed one), `usage.prompt_tokens`, `usage.completion_tokens`. Tool spans add `tool.name` and `tool.ok`.

Never set: header values, API keys, message content, tool arguments, tool results.

`createClient({ traces: { content: true } })` adds `messages` and `output` attributes containing the text. This is off by default. `traces: false` disables buffer writes and OpenTelemetry exports for that client.

When `trace.getTracer` from `@opentelemetry/api` returns a tracer with a real provider registered by the application, each span is also emitted there with the same names and attributes. The SDK never calls `NodeSDK` or configures an exporter.

`client.chat.completions.create` still returns the provider's completion. The trace is a side effect. `traceId` on the result matches the span.

### Validation

`zod` `^4.0.0` is the validator. SDK-owned objects use `z.strictObject`, so an unknown key fails. Schemas do not coerce: the string `"5"` does not become the number `5`.

A Zod failure becomes `SDKError`. The message lists the issue path and the Zod issue code. It does not include the received value, so a key or password cannot leak through a validation error.

| Boundary | Schema | Failure |
| --- | --- | --- |
| `createClient` options | strict object | `invalid_request` |
| Provider and memory config after environment overrides are merged | strict object per factory | `missing_config` when a required string is missing or empty. `invalid_request` for a wrong type, an unknown key, or a URI whose scheme is outside `bolt`, `bolt+s`, `neo4j`, and `neo4j+s`. |
| `chat.completions.create` request | strict object of the documented fields | `invalid_request` |
| Tool `parameters` before `execute` | the tool's Zod schema | `tool_failed`. `execute` is not called. |
| `run()` `outputType`, and `chat.completions.create` `output`, on `message.content` | the caller's Zod schema | `invalid_output` |
| Provider HTTP JSON | loose object, then copy the documented fields | `provider_error` when the documented fields are missing. Extra provider fields do not fail the parse. |

`memory_remember` arguments are `z.strictObject({ subject: z.string().min(1), predicate: z.string().min(1), object: z.string().min(1) })`. `memory_search` arguments are `z.strictObject({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() })`. A model argument that fails either schema finishes that tool call with `tool_failed`.

### Agent

`tool`, `Agent`, and `run` are exported from `ai-agent-sdk`.

```ts
import * as z from "zod";
import { Agent, tool, run, createClient } from "ai-agent-sdk";
import { openai } from "ai-agent-sdk/openai";

const client = createClient({
  provider: openai(),
});

const executeSQL = tool({
  name: "Execute_sql",
  description: "Execute SQL queries",
  parameters: z.object({
    sqlQuery: z.string().describe("SQL query to execute"),
  }),
  execute: async ({ sqlQuery }) => {
    return {
      status: "success",
      result: sqlQuery,
    };
  },
});

const sqlAgent = new Agent({
  name: "SQL Agent",
  instructions: "Write one SQL query for the user's question.",
  client,
  model: "gpt-4o-mini",
  outputType: z.object({
    sqlQuery: z.string().optional().describe("The SQL query that answers the user's question"),
  }),
  tools: [executeSQL],
});

const result = await run(sqlAgent, "How many users signed up today?");
result.finalOutput;
// { sqlQuery: "select count(*) from users where signed_up_at >= current_date" }
```

```ts
function tool<P extends z.ZodType>(definition: {
  name: string;
  description: string;
  parameters: P;
  execute: (args: z.infer<P>) => Promise<unknown> | unknown;
}): Tool<P>;

class Agent<T = string> {
  constructor(config: {
    name: string;
    instructions: string;
    client: Client;
    model: string;
    tools?: Tool[];
    outputType?: z.ZodType<T>;
    maxSteps?: number;
  });
}

function run<T>(
  agent: Agent<T>,
  input: string,
  options?: { threadId?: string },
): Promise<{
  finalOutput: T;
  traceId: string;
  messages: ChatMessage[];
  steps: number;
  stopReason: "stop" | "max_steps" | "missing_execute" | "tool_failed";
}>;
```

`client` is the `createClient` result, so the agent uses that provider, memory, and traces. `model` is the model id string. `instructions` is sent as the system message. `input` is sent as one user message. `maxSteps` defaults to 5.

`name` on a tool matches `^[a-zA-Z0-9_-]{1,64}$`. Duplicate names in `tools` throw `invalid_request` before the first model call. `parameters`, `execute`, and `outputType` are never sent as those property names.

The model only sees the parameters on the Zod object. For `Execute_sql`, the HTTP body contains:

```json
{
  "type": "function",
  "function": {
    "name": "Execute_sql",
    "description": "Execute SQL queries",
    "parameters": {
      "type": "object",
      "properties": {
        "sqlQuery": { "type": "string", "description": "SQL query to execute" }
      },
      "required": ["sqlQuery"]
    }
  }
}
```

`parameters` on the wire is `z.toJSONSchema(definition.parameters, { target: "draft-07" })`. A field that is not on that schema is not offered to the model.

The model returns `tool_calls[].function.arguments` as a string, for example `"{\"sqlQuery\":\"select 1\"}"`. The SDK runs `JSON.parse` on that string, then `parameters.safeParse`. `execute` receives `{ sqlQuery: "select 1" }`, not the string. `z.object` drops unknown keys before `execute`. `z.strictObject` rejects them and the run finishes with `tool_failed` without calling `execute`.

`execute`'s return value is `JSON.stringify`'d and sent back as the tool message. A value that cannot be serialized, a throw, or a string longer than 100,000 characters finishes the run with `tool_failed`. The return value is not checked against a second schema.

Rules:

- Each model call counts as one step.
- A step with no `tool_calls` finishes with `stopReason: "stop"`.
- Invalid JSON arguments, or a failed `parameters` parse, finish the run with `tool_failed` and do not call `execute`.
- Tools in one response run concurrently. Their tool messages are appended in the same order as `tool_calls`.
- A tool name the agent does not have finishes with `missing_execute`. The loop does not invent a tool result.
- Hitting `maxSteps` while the model still wants tools finishes with `max_steps` and returns the result. It does not throw.
- `threadId` stores the transcript, including tool messages, through the memory rules. `instructions` is stored as a system message.
- The loop uses non-streaming chat on `agent.client`.
- When `outputType` is omitted, `finalOutput` is the final `message.content` string.

### Structured output

The provider returns text. `message.content` is a string. Structure is produced by a second step in the SDK, after the HTTP response is in memory.

```ts
const completion = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Weather in Paris as JSON" }],
  output: z.strictObject({
    city: z.string(),
    tempC: z.number(),
  }),
});

completion.choices[0].message.content;
// '{"city":"Paris","tempC":18}'

completion.output;
// { city: "Paris", tempC: 18 }
```

Steps when `output` is set on `chat.completions.create`, and the same steps when `Agent` was given `outputType`:

1. Build `response_format` as `{ type: "json_schema", json_schema: { name: "output", schema: z.toJSONSchema(schema, { target: "draft-07" }), strict: true } }`. On a chat call, passing both `output` and `response_format` throws `invalid_request`. Passing `output` with `stream: true` throws `invalid_request`.
2. Read `choices[0].message.content`. A missing string throws `invalid_output`.
3. `JSON.parse` that string. A parse error throws `invalid_output`.
4. Parse the value with the Zod schema (`output` or `outputType`). A Zod failure throws `invalid_output`. The thrown message lists the issue path and code, and does not include the received value.
5. On a chat call, store the parsed value on `completion.output`. The original string stays on `message.content`. On `run()`, store it on `result.finalOutput`.

`run()` uses those steps on the finishing assistant message (`stopReason: "stop"`). There is no second model call to repair a bad string. With no `outputType`, `finalOutput` stays the content string and these steps are skipped.

`response_format: { type: "json_object" }` on a chat request is forwarded as the OpenAI field. The SDK does not parse it unless `output` was also set, and both together are `invalid_request`, so `json_object` stays a raw string on `message.content`.

Providers that reject `json_schema` return `provider_error`. The SDK does not invent a JSON object from prose.

### Middleware

```ts
type Middleware = (
  context: {
    operation: "chat" | "agent";
    providerId: string;
    threadId?: string;
    request: WireChatRequest;
  },
  next: () => Promise<WireChatResponse>,
) => Promise<WireChatResponse>;
```

Order: tracing middleware, then memory middleware, then user middleware in array order, then the provider call. User middleware can see the wire request and the wire response. It cannot see `execute` functions.

Memory and tracing are this same interface internally. A future speech capability is a new optional method on a provider plus a client namespace (for example `client.audio.speech.create`) added in a later version. v1 does not add that method. The rule for later work is: a capability that is another HTTP API on a provider is a new provider method; a capability that wraps chat is middleware.

### Extension rule for later drop-ins

A new provider package implements `Provider` and is passed to `createClient`. No core change is required for another OpenAI-compatible host that fits the Bearer `POST /chat/completions` helper.

A new graph database implements `Memory`, including `remember` and `search`, and is passed as `memory`. No core change is required.

A new modality (speech) waits until a version that adds the method to the provider interface as optional. Core feature-detects it. v1's `Provider` type has `chat` and `chatStream` only, so speech cannot be smuggled through chat.

## Create CLI

The package `create-ai-agent-sdk` is the setup command. npm maps `npm create ai-agent-sdk@latest` to that package. `npx create-ai-agent-sdk@latest` and `pnpm create ai-agent-sdk` are the same bin.

```text
npm create ai-agent-sdk@latest my-agent -- --provider openai
```

The directory argument is optional in a terminal. The provider flag is optional in a terminal. Both are required when stdin is not a TTY, so a script never waits on a prompt.

### Prompts

Asked only for values the flags did not set, and only on a TTY:

1. Project directory. Default: `ai-agent-app`.
2. Provider. One of `openai`, `groq`, `mistral`, `ollama`, `azure-openai`. Default: `openai`.
3. Memory. One of `ladybug`, `neo4j`, `memgraph`. Default: `ladybug`.

There is one template. The provider choice changes the model import, the factory call, the model string, and the provider variable names in `.env.example`. The memory choice changes the memory import and the memory variables in `.env.example`. The file list stays the same.

### Flags

| Flag | Effect |
| --- | --- |
| `[directory]` | Target directory, relative to the current working directory. |
| `--provider <id>` | Skips the provider prompt. |
| `--memory <id>` | `ladybug`, `neo4j`, or `memgraph`. Skips the memory prompt. Default `ladybug` when stdin is not a TTY and the flag is omitted. |
| `--no-install` | Writes files and does not run a package manager. |
| `--no-agent` | Omits `src/agent.ts` and the `agent` script. |

Unknown flags exit with code `1` and write nothing.

### Directory rules

- A missing directory is created.
- An existing empty directory is used.
- An existing non-empty directory exits with code `1` and writes nothing.
- The command never writes outside the target directory.

### Files written

```text
<directory>/
  package.json
  tsconfig.json
  .gitignore
  .env.example
  README.md
  src/index.ts
  src/agent.ts          # omitted with --no-agent
```

`package.json` is ESM (`"type": "module"`) and names the package after the directory. Scripts:

- `dev` runs `src/index.ts` with `tsx` (no separate build step).
- `agent` runs `src/agent.ts` with `tsx`, unless `--no-agent`.

Dependencies: `ai-agent-sdk`, `zod`, and `dotenv`. When memory is `neo4j` or `memgraph`, the app also depends on `neo4j-driver`. Dev dependencies: `typescript` and `tsx`. Versions are the versions this CLI was released beside, written as caret ranges. The template does not pin `latest` at runtime.

`.gitignore` includes `.env`, `node_modules`, `dist`, and `.ai-agent-sdk/`.

`.env.example` contains empty values, never a real key. The CLI does not ask for an API key.

| Provider | Variables in `.env.example` | Model string in the template |
| --- | --- | --- |
| `openai` | `OPENAI_API_KEY=` | `gpt-4o-mini` |
| `groq` | `GROQ_API_KEY=` | `llama-3.3-70b-versatile` |
| `mistral` | `MISTRAL_API_KEY=` | `mistral-small-latest` |
| `ollama` | `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1` | `llama3.2` |
| `azure-openai` | `AZURE_OPENAI_API_KEY=` and `AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com` | `gpt-4o-mini` |

`src/index.ts` loads `dotenv/config`, builds a client with the chosen provider factory and no arguments (so keys come from the environment), sends one user message `"Hello"`, and prints `choices[0].message.content` and `traceId`. For `ladybug` it omits `memory` and uses the core default. For `neo4j` it passes `neo4j()` from `ai-agent-sdk/neo4j`. For `memgraph` it passes `memgraph()` from `ai-agent-sdk/memgraph`. Those memory factories take no arguments in the template, so the link and credentials come from the environment.

`src/agent.ts` builds an agent with `tool()`, `new Agent()`, and `run()`. The tool is `echo`, with `parameters: z.object({ text: z.string() })`, and `execute` returns `{ echoed: args.text }`. `maxSteps` is `5`. The user message asks the model to echo the word `hello`. The file prints `result.stopReason`, `result.finalOutput`, and `result.traceId`. The generated app depends on `zod`.

`.env.example` for `neo4j` adds `NEO4J_URI=neo4j+s://YOUR_INSTANCE.databases.neo4j.io`, `NEO4J_USERNAME=neo4j`, and `NEO4J_PASSWORD=`. For `memgraph` it adds `MEMGRAPH_URI=bolt://127.0.0.1:7687`, `MEMGRAPH_USERNAME=`, and `MEMGRAPH_PASSWORD=`. Values are empty of secrets. The CLI does not ask for a password.

The README in the generated app states, in order: copy `.env.example` to `.env`, fill the key and any database credentials, run `npm run dev`, run `npm run agent`. The `ladybug` README says the graph file is `.ai-agent-sdk/memory.lbdb`. The hosted README says the URI is the database link. It names whichever package manager performed the install.

### Install step

Unless `--no-install`, the CLI installs dependencies after the files are written. It picks the package manager from `npm_config_user_agent` (npm, pnpm, yarn, or bun). When that variable is absent, it uses npm. A failed install leaves the files in place, prints the install command, and exits with code `1`.

Templates are files inside the CLI package. The command does not download a scaffold from the network. The only network use is the dependency install.

## Security and privacy

- Keys and database passwords are read from arguments or environment variables. They are held on the provider or memory object.
- Errors, traces, and thrown messages never include key material, database passwords, or the contents of `Authorization` or `api-key`.
- Message text is absent from traces unless `traces.content` is true.
- Ladybug writes a database file on disk and does not phone home. That file contains message text and facts in plaintext. A hosted adapter sends that same graph data to the URI. It does not also write a Ladybug file. Traces still omit message text unless `traces.content` is true.
- The create CLI writes only inside the target directory. It never writes an API key and never sends one.

## Quality bar

- TypeScript `strict` is on. Public types are exported from each package entry.
- The default test command uses no network and no API keys.
- A shared fixture server (or fetch mock) implements the OpenAI chat completions subset, including an SSE stream, a 429 followed by success, and an error body. `openai`, `groq`, `mistral`, and `ollama` all pass one contract file against it. Azure passes the same response assertions against its own URL and `api-key` header.
- Documented behaviors have tests: provider swap, memory round-trip, memory trim, a fact that survives a second `createGraphMemory` on the same file, `memory_search` finding that fact, Neo4j and Memgraph Cypher for `remember` and `search` against a stubbed driver, Neo4j `missing_config`, an unknown chat-request field, a `z.strictObject` tool parameter that does not call `execute` for an unknown key, trace redaction of a database password, retry bounds, abort, tool loop stop reasons, schema rejection, missing config. Ladybug tests use a temporary directory, not the default path. The default suite does not open a Bolt socket.
- A README quickstart shows a chat call and the same call with a different provider. The quickstart is under 40 lines.
- CLI tests run with `--no-install` in a temp directory and assert the file list, the provider import, the model string, and that `.env.example` has no secret. They also assert a non-empty target exits `1` with the target unchanged. No network.

## Acceptance for v1

v1 is done when all of the following are true:

1. The five factories construct a `Provider`.
2. The same `chat.completions.create` request and response contract works for all five against the mock, including `stream: true`.
3. Two clients opened on the same graph file, with the same `threadId`, send the first turn's messages again on the second call, including after the first client has been discarded.
4. `remember({ subject: "ada", predicate: "likes", object: "graphs" })` on one connection is returned by `search("graphs", 10)` on a new connection to the same file.
5. `client.traces.list()` contains a span for a successful call and for a failed call, with no key and no message text.
6. `run(agent, input)` executes a `tool()` and stops, and it stops with `max_steps` when the model keeps calling tools.
7. `chat.completions.create` with `output: z.strictObject({ answer: z.string() })` sets `completion.output` to `{ answer: "yes" }` when `message.content` is `'{"answer":"yes"}'`, and throws `invalid_output` when the content is `not json`. A tool whose `parameters` is `z.strictObject({ sqlQuery: z.string() })` does not call `execute` when the arguments string is `{"sqlQuery":"select 1","extra":true}`. `run()` with `outputType: z.object({ sqlQuery: z.string().optional() })` sets `finalOutput.sqlQuery` when the final content is `'{"sqlQuery":"select 1"}'`.
8. `pnpm test` passes without network access.
9. `create-ai-agent-sdk my-agent --provider groq --memory neo4j --no-install` writes a project whose `src/index.ts` imports `ai-agent-sdk/groq` and `ai-agent-sdk/neo4j`, and whose `.env.example` contains `GROQ_API_KEY=` and `NEO4J_URI=`.
10. A stubbed `neo4j({ uri, username, password })` `remember` writes subject, predicate, and object, and `search` reads them back through the stub. Omitting `password` throws `missing_config` when `NEO4J_PASSWORD` is unset. `neo4j({ uri: "neo4j+s://explicit.example" })` uses that URI when `NEO4J_URI` is a different value, and still reads username and password from the environment. No Bolt socket is opened.

## Left to the builder

- Internal file split, as long as the package boundaries and the exported signatures above stay.
- Choice of test runner and HTTP mock library.
- Exact wording of error messages, as long as `code` is stable.
- Whether a subpath re-exports types from the package root.

## How to read this draft

The design stands if the calls table matches what you want. The highest-leverage places to correct are the language and runtime, the `chat.completions.create` surface, Ladybug as the local engine, Neo4j and Memgraph as the hosted adapters, and whether the create command should scaffold a Node app or a Next.js or Vite app.
