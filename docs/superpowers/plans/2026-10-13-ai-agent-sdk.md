# AI Agent SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ai-agent-sdk`, an OpenAI-shaped chat client with swappable OpenAI-compatible providers, default graph memory, traces, a tool loop, and `create-ai-agent-sdk`.

**Architecture:** One pnpm package, `ai-agent-sdk`, with an `exports` map. Core owns validation, HTTP, retries, memory, traces, and the agent loop. Provider and hosted-memory subpaths are thin factories over that core. `create-ai-agent-sdk` is a second package that copies a local template. `raw/` and `wiki/` stay untouched.

**Tech Stack:** TypeScript strict, ESM, Node 20+, pnpm workspace, Vitest, `zod` `^4.0.0`, `@ladybugdb/core`, `@opentelemetry/api`, optional peer `neo4j-driver`.

**Spec:** [prd.md](../../../prd.md)

**Execution already chosen:** one task per conversation turn in this session. Do not start the next task in the same turn. Commit steps below run only when the user asks for a commit.

## Global Constraints

- Language is TypeScript. Packages are ESM. Chat calls need global `fetch` (Node 20+).
- The dependency is `zod` `^4.0.0`. SDK-owned objects use `z.strictObject`. Tool schemas are converted with `z.toJSONSchema(schema, { target: "draft-07" })`.
- The compatible surface is `client.chat.completions.create`. `stream: true` returns an async iterable. There is no separate `stream` method.
- A provider is bound with `createClient({ provider })`.
- Memory and tracing are in the core package and on by default. `memory: false` and `traces: false` turn that subsystem off.
- Default memory is Ladybug at `.ai-agent-sdk/memory.lbdb`. A `Map` is not a memory implementation.
- Traces redact secrets always, omit message text by default, and keep the last 200 spans in process.
- The agent API is `tool()`, `new Agent()`, and `run()`.
- Repository layout is a pnpm workspace under `packages/`. This wiki's `raw/` and `wiki/` stay as they are.
- One shared contract test defines OpenAI-compatible. Each provider passes it against a local mock. The default suite uses no network and no API keys.
- The setup CLI is `create-ai-agent-sdk`. v1 scaffolds one Node TypeScript app.
- v1 hosted adapters are `neo4j()` and `memgraph()`, both on `neo4j-driver`. The root entry does not import a provider or `neo4j-driver`.
- Unknown keys fail. Schemas do not coerce. Zod failure messages list the issue path and the Zod issue code, and do not include the received value.
- Public error `code` values are exactly: `missing_config`, `invalid_request`, `provider_error`, `timeout`, `aborted`, `invalid_output`, `tool_failed`, `max_steps`, `unsupported_runtime`, `memory_error`.

## Builder calls

- Test runner is Vitest. Tests import TypeScript source. No HTTP mock library: contract tests use `node:http`.
- The library compiles with `tsc` to `dist/` for publish. Tests run against `src/` via the package `exports` during development (`"exports"` point at `./src/...`).
- `SDKError` is constructed as `new SDKError(code, message, extra?)`. `extra` may hold `provider`, `status`, `requestId`, `traceId`, and `cause`. `cause` is set on the `Error` and is never copied into a trace.

## Review Focus

These inputs are the ones most likely to hurt a caller. Each one has a test on the task that owns the code.

1. An API key, `Authorization` value, or `api-key` value must never appear in a span attribute or an `SDKError` message. Test on Task 9 and Task 4.
2. An unknown chat-request field must throw `invalid_request` and must not be sent on the wire. Test on Task 3 and Task 7.
3. After a stream has yielded one chunk, a later failure must not start another attempt. Test on Task 4.
4. `messages[].content` as an array must throw `invalid_request`. Test on Task 3.
5. A graph URI with userinfo (`bolt://user:secret@host`) must throw `invalid_request`, and `secret` must not appear in the error message. Test on Task 13.

## File map

```text
package.json                          private workspace root
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
packages/ai-agent-sdk/package.json
packages/ai-agent-sdk/tsconfig.json
packages/ai-agent-sdk/src/index.ts
packages/ai-agent-sdk/src/errors.ts
packages/ai-agent-sdk/src/config.ts          env-or-argument merge
packages/ai-agent-sdk/src/chat/schema.ts
packages/ai-agent-sdk/src/chat/types.ts
packages/ai-agent-sdk/src/http/post-chat.ts
packages/ai-agent-sdk/src/provider.ts        Provider type + postChat binding
packages/ai-agent-sdk/src/providers/openai.ts
packages/ai-agent-sdk/src/providers/groq.ts
packages/ai-agent-sdk/src/providers/mistral.ts
packages/ai-agent-sdk/src/providers/ollama.ts
packages/ai-agent-sdk/src/providers/azure-openai.ts
packages/ai-agent-sdk/src/client.ts
packages/ai-agent-sdk/src/chat/collect.ts
packages/ai-agent-sdk/src/output.ts
packages/ai-agent-sdk/src/traces.ts
packages/ai-agent-sdk/src/middleware.ts
packages/ai-agent-sdk/src/memory/types.ts
packages/ai-agent-sdk/src/memory/window.ts
packages/ai-agent-sdk/src/memory/graph.ts
packages/ai-agent-sdk/src/memory/bolt.ts     shared Cypher for neo4j and memgraph
packages/ai-agent-sdk/src/neo4j.ts
packages/ai-agent-sdk/src/memgraph.ts
packages/ai-agent-sdk/src/agent/tool.ts
packages/ai-agent-sdk/src/agent/run.ts
packages/ai-agent-sdk/test/contract/server.ts
packages/create-ai-agent-sdk/               Task 16
README.md                                   Task 17
```

---

### Task 1: Workspace and SDKError

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/ai-agent-sdk/package.json`, `packages/ai-agent-sdk/tsconfig.json`
- Create: `packages/ai-agent-sdk/src/errors.ts`, `packages/ai-agent-sdk/src/index.ts`
- Test: `packages/ai-agent-sdk/test/errors.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SDKError`, `SDKErrorCode`. `new SDKError(code, message, extra?)`. `extra` keys are `provider?`, `status?`, `requestId?`, `traceId?`, `cause?`. `error.code` is the first argument. `error.name` is `"SDKError"`. `error.cause` is `extra.cause` when set.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { SDKError } from "ai-agent-sdk";

describe("SDKError", () => {
  it("keeps a stable code and does not copy cause into the message", () => {
    const error = new SDKError("missing_config", "OPENAI_API_KEY is required", {
      provider: "openai",
      cause: "sk-live-secret",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SDKError");
    expect(error.code).toBe("missing_config");
    expect(error.provider).toBe("openai");
    expect(error.cause).toBe("sk-live-secret");
    expect(error.message).not.toContain("sk-live-secret");
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run packages/ai-agent-sdk/test/errors.test.ts`
Expected: FAIL because `ai-agent-sdk` is not defined yet.

- [x] **Step 3: Add the workspace and `SDKError`**

Root `package.json` is private, `"type": "module"`, package manager `pnpm`, script `test` is `vitest run`. `pnpm-workspace.yaml` includes `packages/*`. `tsconfig.base.json` sets `strict`, `module` `NodeNext`, `moduleResolution` `NodeNext`, `target` `ES2022`. The package depends on `zod` `^4.0.0` and `typescript` and `vitest` as dev dependencies at the root. `packages/ai-agent-sdk` name is `ai-agent-sdk`, `"type": "module"`, `engines.node` `>=20`, export `"."` to `./src/index.ts`. `src/index.ts` exports `SDKError` and `SDKErrorCode` only.

- [x] **Step 4: Run the test and confirm it passes**

Run: `pnpm test`
Expected: PASS. No network.

- [ ] **Step 5: Commit**

Only if the user asks. Message: `feat: add workspace and SDKError`.

### Task 2: Config merge and provider factories

**Files:**
- Create: `packages/ai-agent-sdk/src/config.ts`
- Create: `packages/ai-agent-sdk/src/provider.ts`
- Create: `packages/ai-agent-sdk/src/providers/openai.ts` and the groq, mistral, ollama, azure-openai siblings
- Modify: `packages/ai-agent-sdk/package.json` exports
- Test: `packages/ai-agent-sdk/test/providers.test.ts`

**Interfaces:**
- Consumes: `SDKError`
- Produces:
  - `readConfig(env, args, fields)` where each field is `{ key, env?, required?, default? }`. An argument key that is present, including `""`, wins. A missing argument falls through to env, then `default`. Unknown argument keys throw `invalid_request`. A required string that is missing or `""` after merge throws `missing_config`. The thrown message names the env var or field and does not include any secret value.
  - `Provider` as in the spec (`id`, `chat`, `chatStream`).
  - `openai`, `groq`, `mistral`, `ollama`, `azureOpenAI` with the spec's default base URLs, env names, and Azure path ` {endpoint}/openai/deployments/{model}/chat/completions?api-version={apiVersion} `. Azure default `apiVersion` is `"2024-10-21"`. Azure auth header is `api-key`. The other four use `Authorization: Bearer {apiKey}` except Ollama, which omits `Authorization` when no key is set.
  - Factories do not call the network. They return a `Provider` whose `chat` / `chatStream` close over the resolved URL and headers and call `postChat` once Task 4 exists. Until Task 4, `chat` and `chatStream` throw `SDKError` `unsupported_runtime` with message `"postChat is not wired"`. That throw is replaced in Task 4.

- [x] **Step 1: Write the failing test**

Assert: `openai()` with `OPENAI_API_KEY` unset throws `missing_config` and the message does not contain a sample key. `openai({ apiKey: "" })` throws `missing_config` even when `OPENAI_API_KEY` is set. `openai({ apiKey: "sk-explicit", extra: true })` throws `invalid_request`. `ollama()` does not throw when no key is set. `azureOpenAI()` throws `missing_config` when endpoint or key is absent. `azureOpenAI({ endpoint: "https://example.openai.azure.com", apiKey: "k" })` returns `id === "azure-openai"`.

- [x] **Step 2: Run that test and confirm it fails**

Run: `pnpm exec vitest run packages/ai-agent-sdk/test/providers.test.ts`

- [x] **Step 3: Implement the factories and exports**

Subpath exports: `./openai`, `./groq`, `./mistral`, `./ollama`, `./azure-openai`. Root `src/index.ts` does not import them.

- [x] **Step 4: Run `pnpm test`**

Expected: PASS.

- [ ] **Step 5: Commit** only if the user asks. Message: `feat: add provider factories`.

### Task 3: Chat request schema

**Files:**
- Create: `packages/ai-agent-sdk/src/chat/schema.ts`, `packages/ai-agent-sdk/src/chat/types.ts`
- Test: `packages/ai-agent-sdk/test/chat-schema.test.ts`

**Interfaces:**
- Consumes: `SDKError`
- Produces: `parseChatRequest(input: unknown): ParsedChatRequest`. `ParsedChatRequest` has `wire` (OpenAI body: no `threadId`, `signal`, `output`) and `threadId?: string`, `signal?: AbortSignal`, `output?: ZodType`. Failure is `SDKError` `invalid_request`. Message format: `` `${path}: ${zodCode}` `` joined by `; `. No received value.

Fields are the spec table: `model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `user`, `tools`, `tool_choice`, `response_format`, `output`, `stream`, `threadId`, `signal`. `content` is `z.string()` only. `tool` messages require `tool_call_id`. `output` and `response_format` together are `invalid_request`. `output` and `stream: true` together are `invalid_request`.

- [x] **Step 1: Write the failing tests**

`parseChatRequest({ model: "m", messages: [{ role: "user", content: "Hi" }], n: 2 })` throws `invalid_request`. `content: ["text"]` throws `invalid_request` and the message contains `messages.0.content` and does not contain `text`. `stream: true` plus a Zod `output` throws `invalid_request`. A valid request's `wire` has no `threadId`.

- [x] **Step 2: Run the test and confirm it fails**
- [x] **Step 3: Implement `parseChatRequest`**
- [x] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: validate chat requests`.

### Task 4: postChat, retries, timeouts, abort

**Files:**
- Create: `packages/ai-agent-sdk/src/http/post-chat.ts`
- Create: `packages/ai-agent-sdk/test/contract/server.ts`
- Modify: provider `chat` / `chatStream` to call `postChat`
- Test: `packages/ai-agent-sdk/test/post-chat.test.ts`

**Interfaces:**
- Consumes: `Provider` headers and URL from Task 2, `SDKError`
- Produces: `postChat(target, body, options) -> Promise<WireChatResponse>` and `postChatStream(...) -> AsyncIterable<WireChatChunk>`. `target` is `{ url, headers, fetch?, timeoutMs?, maxRetries? }`. Defaults: `timeoutMs` 60_000, `maxRetries` 2. Backoff 200ms then 800ms, plus jitter in `[0, 100]`. `Retry-After` under 10 seconds replaces that delay for 429 and 503. A larger `Retry-After` returns the error. Retry network errors, 408, 409, 429, 500–599, only before the first stream chunk. Abort is `aborted` and is not retried. Header timeout and idle timeout (60s between chunks, 10 minute overall stream cap) are `timeout`. Non-2xx JSON of the OpenAI error shape becomes `provider_error` with `status` and `error.message`. The raw body is `cause` only.

- [x] **Step 1: Write the failing tests** against `node:http`

429 then 200 succeeds and the test observes two requests. A stream that writes one SSE chunk and then 500 does not open a second request. `Retry-After: 30` on 429 does not wait 30s (assert elapsed < 2s with fake timers or a deadline). An error JSON body `{ error: { message: "nope" } }` becomes `provider_error`, and the `SDKError` message does not contain the `Authorization` header the test sent (`Bearer sk-test`).

- [x] **Step 2: Run the test and confirm it fails**
- [x] **Step 3: Implement `postChat` and point the five factories at it**
- [x] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: add chat HTTP helper`.

### Task 5: Provider contract

**Files:**
- Test: `packages/ai-agent-sdk/test/contract/providers.test.ts`
- Modify: `packages/ai-agent-sdk/test/contract/server.ts` so it can serve the OpenAI subset, an SSE stream, a 429 then success, and an error body

**Interfaces:**
- Consumes: the five factories and `postChat`
- Produces: one contract file. `openai`, `groq`, `mistral`, and `ollama` hit the same mock with `Authorization: Bearer`. Azure hits `{endpoint}/openai/deployments/{model}/chat/completions?api-version=2024-10-21` with header `api-key` and no `Authorization`.

- [ ] **Step 1: Write the contract**

Each Bearer provider POSTs `/chat/completions`. Ollama with no key sends no `Authorization`. A successful body returns `choices[0].message.content`. `stream: true` yields a content delta. The request body the mock records has no `threadId`.

- [ ] **Step 2: Run it and confirm it fails only if a provider is wrong**
- [ ] **Step 3: Fix the provider that fails**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `test: share the provider contract`.

### Task 6: createClient chat completions

**Files:**
- Create: `packages/ai-agent-sdk/src/client.ts`, `packages/ai-agent-sdk/src/middleware.ts`
- Modify: `packages/ai-agent-sdk/src/index.ts`
- Test: `packages/ai-agent-sdk/test/client.test.ts`

**Interfaces:**
- Consumes: `parseChatRequest`, `Provider`, `SDKError`
- Produces: `createClient(options) -> Client` with `client.chat.completions.create`. Options schema is a strict object: `provider`, `memory?`, `traces?`, `middleware?`, `timeoutMs?` default `60_000`, `maxRetries?` default `2`. Unknown option keys are `invalid_request`. This task passes `memory: false` in tests so Ladybug is not opened. `traces` may be omitted; the buffer can be a no-op until Task 9, but `traceId` is already a string on the response. User middleware runs after the built-in slots, in array order, and sees the wire request. The wire body must not contain an unknown field rejected in Task 3.

- [ ] **Step 1: Write the failing test**

A fake `Provider` records the body. `create({ model, messages, threadId })` sends no `threadId`. `create({ ..., surprise: true })` throws `invalid_request` and the fake provider is not called. Two clients with `openai` and `groq` fakes accept the same `create` argument shape.

- [ ] **Step 2: Run the test and confirm it fails**
- [ ] **Step 3: Implement `createClient` for non-streaming chat**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: add createClient chat completions`.

### Task 7: Streaming collect

**Files:**
- Create: `packages/ai-agent-sdk/src/chat/collect.ts`
- Modify: `packages/ai-agent-sdk/src/client.ts`, `src/index.ts`
- Test: `packages/ai-agent-sdk/test/collect.test.ts`

**Interfaces:**
- Consumes: `ChatCompletionChunk`
- Produces: `collectStream(stream) -> Promise<ChatCompletion>`. Concatenate `delta.content`. Assemble `delta.tool_calls` by index into `message.tool_calls`. Copy `id`, `model`, `usage`, and `traceId` from the last chunk that has them, or from a final chunk. Aborting the request signal cancels the read.

- [ ] **Step 1: Write the failing test** with three chunks: content `"Hel"` `"lo"`, then a finish chunk. Expect `message.content === "Hello"`. A second test assembles two tool-call argument fragments.
- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement `collectStream` and `stream: true` on the client**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: collect chat streams`.

### Task 8: Structured output

**Files:**
- Create: `packages/ai-agent-sdk/src/output.ts`
- Modify: `client.ts`
- Test: `packages/ai-agent-sdk/test/output.test.ts`

**Interfaces:**
- Consumes: `parseChatRequest`
- Produces: when `output` is set, the wire `response_format` is `{ type: "json_schema", json_schema: { name: "output", schema, strict: true } }` using `z.toJSONSchema(schema, { target: "draft-07" })`. `completion.output` is the parsed value. `message.content` stays the original string. Missing content, invalid JSON, or a Zod failure throws `invalid_output` with path and Zod code, and without the received value.

- [ ] **Step 1: Write the failing test**

`output: z.strictObject({ answer: z.string() })` and content `'{"answer":"yes"}'` yields `output` `{ answer: "yes" }`. Content `not json` throws `invalid_output`. The message does not contain `not json`.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the parse step**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: parse structured chat output`.

### Task 9: Traces

**Files:**
- Create: `packages/ai-agent-sdk/src/traces.ts`
- Modify: `client.ts`, `package.json` to depend on `@opentelemetry/api`
- Test: `packages/ai-agent-sdk/test/traces.test.ts`

**Interfaces:**
- Consumes: `createClient`
- Produces: `client.traces.list(): readonly Span[]` and `clear()`. Last 200 spans, per client. Every `create` writes a span named `chat.completions` even on failure, plus `chat.completions.attempt`. Attributes only from the spec list. Never headers, keys, message text, tool arguments, or tool results. `traces: { content: true }` adds `messages` and `output`. `traces: false` writes nothing and does not export. If `trace.getTracer` has a real provider, emit the same spans. Do not call `NodeSDK`.

- [ ] **Step 1: Write the failing tests**

A success and a `provider_error` both appear in `list()`. The span JSON does not contain `sk-test` or `Hello` when the request used that key and that message. `traces: { content: true }` includes `Hello`. A password string `db-secret` passed only as a header is absent.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the buffer and redaction**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: record redacted traces`.

### Task 10: Memory window

**Files:**
- Create: `packages/ai-agent-sdk/src/memory/types.ts`, `packages/ai-agent-sdk/src/memory/window.ts`
- Test: `packages/ai-agent-sdk/test/memory-window.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`
- Produces: `Memory` as in the spec. `selectMessages(stored, maxMessages): ChatMessage[]` keeps up to 20 system messages, oldest first, then the newest non-system messages until the sent list length is `maxMessages`. Rows that do not fit stay out of the returned array. The request's own messages are not an input to this function.

- [ ] **Step 1: Write the failing test**

30 stored messages, 5 of them system, `maxMessages` 10. The result has the system messages that fit the rule and length 10.
- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement `selectMessages`**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: select the memory window`.

### Task 11: Ladybug graph memory

**Files:**
- Create: `packages/ai-agent-sdk/src/memory/graph.ts`
- Modify: `client.ts`, `package.json` (`@ladybugdb/core`)
- Test: `packages/ai-agent-sdk/test/graph-memory.test.ts`

**Interfaces:**
- Consumes: `Memory`, `selectMessages`, `SDKError`
- Produces: `createGraphMemory({ path?, maxMessages? })`. Default path `.ai-agent-sdk/memory.lbdb`, default `maxMessages` 50. One connection, one queue. Schema from the spec (`Thread`, `Message`, `Entity`, `HAS_MESSAGE`, `RELATION`). `remember` is idempotent for the same subject, predicate, object, and thread id. `search` lowercases the query, contains-match, order `createdAt` descending, max limit 50. `createClient()` with `memory` omitted calls `createGraphMemory()`. If the addon fails to load, `createClient` throws `unsupported_runtime` unless `memory: false` or a custom `Memory` was passed. Tests use `os.tmpdir()`, never the default path.

- [ ] **Step 1: Write the failing tests**

Append and load round-trip. A second `createGraphMemory` on the same file returns the first turn. `remember({ subject: "ada", predicate: "likes", object: "graphs" })` then a new connection `search("graphs", 10)` returns that triple. A failed chat (fake provider throws) leaves the thread empty.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the store and the client load/append path**

On `threadId`: load, `selectMessages`, send selected plus the new request messages, append request messages and the assistant message only after success. `seq` starts at 1.

- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: store threads in Ladybug`.

### Task 12: Neo4j and Memgraph adapters

**Files:**
- Create: `packages/ai-agent-sdk/src/memory/bolt.ts`, `src/neo4j.ts`, `src/memgraph.ts`
- Modify: `package.json` optional peer `neo4j-driver`, exports `./neo4j` and `./memgraph`
- Test: `packages/ai-agent-sdk/test/bolt-memory.test.ts`

**Interfaces:**
- Consumes: `Memory`, `readConfig`
- Produces: `neo4j(config?)` and `memgraph(config?)` with the spec's env names and defaults. Allowed schemes: `bolt`, `bolt+s`, `neo4j`, `neo4j+s`. Userinfo throws `invalid_request` and the message must not contain the password. Missing Neo4j uri, username, or password throws `missing_config`. Memgraph URI defaults to `bolt://127.0.0.1:7687`. Tests stub the driver. No Bolt socket. `remember` and `search` use the same logical graph as Ladybug. An argument field overrides only that field.

- [ ] **Step 1: Write the failing tests**

`neo4j({ uri: "neo4j+s://user:secret@host" })` throws `invalid_request` and the message does not contain `secret`. `neo4j({ uri: "neo4j+s://explicit.example" })` with `NEO4J_URI` set to something else uses the argument URI and still reads username and password from the env. Omitting `password` with `NEO4J_PASSWORD` unset throws `missing_config`. A stubbed `remember` then `search` returns the triple.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement both adapters**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: add Neo4j and Memgraph memory`.

### Task 13: Agent loop

**Files:**
- Create: `packages/ai-agent-sdk/src/agent/tool.ts`, `packages/ai-agent-sdk/src/agent/run.ts`
- Modify: `src/index.ts`
- Test: `packages/ai-agent-sdk/test/agent.test.ts`

**Interfaces:**
- Consumes: `createClient`, `SDKError`
- Produces: `tool`, `Agent`, `run` with the spec signatures. `maxSteps` default 5. Tool name matches `^[a-zA-Z0-9_-]{1,64}$`. Duplicate names throw `invalid_request` before the first model call. Wire tools are `{ type: "function", function: { name, description, parameters } }` where `parameters` is `z.toJSONSchema(schema, { target: "draft-07" })`. Arguments are `JSON.parse` then `parameters.safeParse`. `z.strictObject` unknown keys finish `tool_failed` and do not call `execute`. Tools in one response run concurrently; tool messages keep `tool_calls` order. Unknown tool name finishes `missing_execute`. `max_steps` returns and does not throw. `outputType` uses the Task 8 parse on the finishing message. No `outputType` means `finalOutput` is `message.content`. Spans `agent.run` and `agent.tool` go through Task 9. Tool spans have `tool.name` and `tool.ok` only.

- [ ] **Step 1: Write the failing tests**

A fake model returns one tool call `{"sqlQuery":"select 1","extra":true}` for `z.strictObject({ sqlQuery: z.string() })`. `execute` is not called. `stopReason` is `tool_failed`. A second test returns a tool call then a final content `'{"sqlQuery":"select 1"}'` with `outputType: z.object({ sqlQuery: z.string().optional() })` and expects `finalOutput.sqlQuery`. A third test keeps returning tool calls and expects `stopReason` `max_steps` when `maxSteps` is 2.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the loop, non-streaming only**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: add the agent tool loop`.

### Task 14: Memory tools

**Files:**
- Modify: `packages/ai-agent-sdk/src/agent/run.ts`
- Test: `packages/ai-agent-sdk/test/memory-tools.test.ts`

**Interfaces:**
- Consumes: `Memory.remember`, `Memory.search`, `run`
- Produces: when both methods exist, `run` adds `memory_remember` and `memory_search` and handles them itself. Schemas are the spec's strict objects. A user tool with either name throws `invalid_request` before the first model call. A memory without both methods does not add the tools. `memory_remember` stores `threadId` from `run` options. `memory_search` default limit is 10.

- [ ] **Step 1: Write the failing test** with an in-memory `Memory` fake. The model calls `memory_remember` then `memory_search`. The fake sees the fact. A user tool named `memory_search` throws `invalid_request`.
- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the two tools**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: add memory tools to the agent`.

### Task 15: create-ai-agent-sdk

**Files:**
- Create: `packages/create-ai-agent-sdk/` including `bin`, template files, and `test/cli.test.ts`

**Interfaces:**
- Consumes: nothing from the SDK runtime except the import strings it writes
- Produces: bin `create-ai-agent-sdk`. Flags and files are the spec's Create CLI section. Non-TTY requires directory and provider. `--memory` defaults to `ladybug` when not a TTY and the flag is omitted. Unknown flags exit 1 and write nothing. Non-empty target exits 1 and is unchanged. `--no-install` writes files only. `.env.example` has no secret. Templates are files in the package.

- [ ] **Step 1: Write the failing test**

Run the bin with `my-agent --provider groq --memory neo4j --no-install` in a temp directory. `src/index.ts` imports `ai-agent-sdk/groq` and `ai-agent-sdk/neo4j`. `.env.example` contains `GROQ_API_KEY=` and `NEO4J_URI=`. A second run into a non-empty directory exits 1 and does not change a sentinel file.

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement the CLI and the one Node template**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `feat: scaffold a Node app`.

### Task 16: README quickstart

**Files:**
- Create: `README.md`
- Test: `packages/ai-agent-sdk/test/readme.test.ts`

**Interfaces:**
- Produces: a quickstart under 40 lines that shows one chat call and the same call with a different provider.

- [ ] **Step 1: Write a test that the README exists, the quickstart fence is under 40 lines, and it contains `chat.completions.create` twice and two provider imports**
- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Write the README**
- [ ] **Step 4: Run `pnpm test`**
- [ ] **Step 5: Commit** only if asked. Message: `docs: add the quickstart`.

## Spec coverage

| Spec section | Task |
| --- | --- |
| Packages, ESM, Node 20, zod 4 | 1 |
| Provider factories, Azure URL, missing_config | 2 |
| Chat request subset, unknown fields, non-string content | 3 |
| Retries, timeouts, abort, provider_error | 4 |
| Shared contract, five providers | 5 |
| createClient, middleware order, provider swap | 6 |
| stream and collectStream | 7 |
| output / outputType parse | 8, 13 |
| Traces, redaction, OpenTelemetry | 9 |
| Memory window | 10 |
| Ladybug default, restart, no Map fallback | 11 |
| Neo4j, Memgraph, userinfo, stubbed driver | 12 |
| tool, Agent, run, stop reasons | 13 |
| memory_remember, memory_search | 14 |
| create CLI | 15 |
| README under 40 lines | 16 |
| Speech, images, Responses API, streaming agent, Next.js scaffold | out of v1, no task |

## Self-review

- Types line up: `SDKError`, `Provider`, `parseChatRequest`, `postChat`, `createClient`, `collectStream`, `Memory`, `selectMessages`, `createGraphMemory`, `neo4j`, `memgraph`, `tool`, `Agent`, `run`.
- Review Focus items 1–5 are tests on Tasks 9, 4, 3, and 12.
- Later tasks name the assertion and the signature. They do not paste the function body. The retry delays and the memory window rule are the spec's values, copied once.
