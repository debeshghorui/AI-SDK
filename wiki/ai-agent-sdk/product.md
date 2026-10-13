# AI Agent SDK

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

`ai-agent-sdk` is a TypeScript product other applications can depend on. One OpenAI-shaped chat client talks to any of five OpenAI-compatible providers. Memory, traces, and a tool loop ship in the same package and work on a fresh install.

## What ships together

The product is the combination, not a fetch wrapper. A caller binds a provider with `createClient({ provider })`, then calls `client.chat.completions.create`. Replacing the provider or the memory store is a constructor change. The chat call and the agent call stay.

Defaults are on. Omitting `memory` opens an on-disk [graph](graph-memory.md). Omitting `traces` records spans in process and leaves message text out. `memory: false` and `traces: false` turn those subsystems off.

The audience is a TypeScript developer who already knows the OpenAI chat completions client and wants the same calls against OpenAI, Groq, Mistral, Ollama, or Azure OpenAI, plus a thread that continues by id and a record of each call without standing up an observability stack.

## Shape of v1

Language is TypeScript, packages are ESM, and chat needs global `fetch`. The default graph is a native addon, so that path is Node 20+. One npm package, `ai-agent-sdk`, exposes the core and the provider and memory subpaths. `create-ai-agent-sdk` is a separate one-shot scaffolder. The root entry does not import a provider or `neo4j-driver`.

Dependencies named in the draft are `zod` `^4.0.0`, `@ladybugdb/core`, and `@opentelemetry/api`. `neo4j-driver` is an optional peer used only by the Neo4j and Memgraph entries. The SDK does not start a collector or a database server.

Validation uses Zod 4. SDK-owned objects are `z.strictObject`. Unknown keys fail. Schemas do not coerce. A Zod failure becomes `SDKError` and lists the issue path and code, not the received value.

## What v1 refuses

Speech, images, embeddings, files, Assistants, Responses, and realtime are later. So are native Anthropic and Gemini, a hosted gateway, a vector store, retrieval, evals, a chat UI, and multi-agent handoffs. The tool loop returns one final result; it does not stream. Message content is a string. There is no repair loop that re-asks the model when structured output fails, and no hidden model call that extracts facts. The create command writes one Node app, not a Next.js or Vite frontend.

Failure even if tests pass: a thin URL list with no stable contract, a framework that dictates application structure, traces that record keys, `Authorization`, `api-key`, a database password, or URI userinfo, and a provider or memory swap that forces the call site to change.

## How later capabilities attach

Another OpenAI-compatible host implements `Provider` and is passed to `createClient`. Another graph database implements `Memory` and is passed as `memory`. A modality such as speech waits for a version that adds an optional provider method. v1's `Provider` has `chat` and `chatStream` only. A capability that wraps chat is [middleware](traces.md); a capability that is another HTTP API is a new provider method.

This vault's `raw/` and `wiki/` stay beside the package workspace. The draft treats that layout as fixed.

## See Also

- [Providers](providers.md)
- [Chat contract](chat-contract.md)
- [Graph memory](graph-memory.md)
- [Traces](traces.md)
- [Agent loop](agent-loop.md)
- [Structured output](structured-output.md)
- [Create CLI](create-cli.md)
