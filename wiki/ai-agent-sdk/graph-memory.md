# Graph Memory

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

Memory is a graph, not a `Map`. The default is an on-disk Ladybug database (`@ladybugdb/core`), an embedded store descended from Kuzu. Hosted Neo4j (including Aura) and Memgraph plug in through the same `Memory` interface. Facts enter the graph when the agent calls `memory_remember`, or when application code calls `remember`. There is no hidden extraction call.

## Default store

`createGraphMemory` opens one Ladybug file and queues queries so two calls cannot use that connection at once. The default path is `.ai-agent-sdk/memory.lbdb` under the process working directory. `maxMessages` defaults to 50. `createClient` with `memory` omitted calls that function. If the native addon cannot load, `createClient` throws `unsupported_runtime` unless the caller passed `memory: false` or a custom `Memory`. There is no `Map` fallback.

## Interface and graph

Every store implements `load` and `append`. `remember` and `search` are optional. The default and the hosted adapters implement all four.

Nodes are `Thread` (`id`), `Message` (`id`, `threadId`, `seq`, `role`, `content`, `toolCallId`, `toolCalls` as JSON), and `Entity` (`id` and `name` are the trimmed, lowercased subject or object). `HAS_MESSAGE` links a thread to its messages. `RELATION` links two entities and carries `predicate`, `threadId`, and `createdAt`.

When `threadId` is set, the client loads messages by `seq`, sends up to 20 stored system messages (oldest first) plus the newest non-system messages until the sent list reaches `maxMessages`, then sends the new request messages untrimmed. On success it appends the request messages and the assistant message. On failure it appends nothing. Omitting `threadId` skips message reads and writes. `memory_search` can still see facts stored earlier.

`remember` merges the two entities and writes one edge. The same subject, predicate, object, and thread id a second time does not create a second edge. `search` lowercases the query and returns relations whose subject, predicate, or object contains that string, newest first. The method requires a limit. Tools default the limit to 10. The maximum is 50.

## Hosted adapters

`neo4j()` and `memgraph()` come from `ai-agent-sdk/neo4j` and `ai-agent-sdk/memgraph`. Both use `neo4j-driver` over Bolt. Passing either one leaves `chat.completions.create`, `run()`, `threadId`, and the memory tools unchanged.

Field-by-field, an argument overrides that environment variable and omitted fields still come from the environment. Neo4j reads `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` (default database `"neo4j"`). URI, username, and password are required. Memgraph reads `MEMGRAPH_*`, defaults the URI to `bolt://127.0.0.1:7687`, and may omit username and password.

Allowed schemes are `bolt`, `bolt+s`, `neo4j`, and `neo4j+s`. A URI with userinfo throws `invalid_request`, so a logged URI cannot contain the password. Each adapter opens one driver at construction and checks connectivity. A refused connection or a rejected login throws `memory_error`. Writes use `MERGE`. Neo4j creates uniqueness constraints on the three ids. Memgraph creates the same constraints when the server accepts them. `maxMessages` still defaults to 50.

## Tools

When the bound memory implements `remember` and `search`, `run()` adds `memory_remember` (`subject`, `predicate`, `object`) and `memory_search` (`query`, optional `limit`) and handles them itself. `memory_remember` returns `{ ok: true }` and stores the `run()` thread id when one was passed. A user tool with either name throws `invalid_request` before the first model call. A custom memory without those methods does not add the tools. `memory: false` disables loading, appending, and the tools.

## See Also

- [AI Agent SDK](product.md)
- [Agent loop](agent-loop.md)
- [Chat contract](chat-contract.md)
- [Create CLI](create-cli.md)
