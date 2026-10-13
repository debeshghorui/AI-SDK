# Knowledge Base Index

## knowledge-bases

How this vault compiles sources into maintained markdown.

| Article | Summary | Updated |
|---------|---------|---------|
| [LLM Wiki](knowledge-bases/llm-wiki.md) | A persistent wiki the model maintains so synthesis compounds instead of being redone per question. | 2026-10-13 |
| [Three Layers](knowledge-bases/three-layers.md) | Immutable raw sources, a model-owned wiki, and a schema that disciplines the maintainer. | 2026-10-13 |
| [Wiki Operations](knowledge-bases/wiki-operations.md) | Ingest compiles sources, query cites pages, and lint hunts drift; filed answers compound too. | 2026-10-13 |
| [Index and Log](knowledge-bases/index-and-log.md) | The index catalogs pages; the log is a parseable timeline of ingests, queries, and lint. | 2026-10-13 |
| [Wiki versus RAG](knowledge-bases/wiki-versus-rag.md) | RAG synthesizes at query time; a wiki compiles ahead of time and revises the compilation. | 2026-10-13 |

## people

Named people with a page of their own.

| Article | Summary | Updated |
|---------|---------|---------|
| [Andrej Karpathy](people/andrej-karpathy.md) | Author of the LLM Wiki gist; prefers one-source ingests beside Obsidian. | 2026-10-13 |

## ai-agent-sdk

The TypeScript SDK: one OpenAI-shaped client, swappable providers, graph memory, traces, and a tool loop.

| Article | Summary | Updated |
|---------|---------|---------|
| [AI Agent SDK](ai-agent-sdk/product.md) | One chat client, five OpenAI-compatible providers, graph memory, traces, and a tool loop in a single package. | 2026-10-13 |
| [Providers](ai-agent-sdk/providers.md) | OpenAI, Groq, Mistral, Ollama, and Azure OpenAI share one contract and differ by URL, key, and Azure's path. | 2026-10-13 |
| [Chat Contract](ai-agent-sdk/chat-contract.md) | `chat.completions.create` is a strict OpenAI subset plus `threadId`, `signal`, and `output`. | 2026-10-13 |
| [Graph Memory](ai-agent-sdk/graph-memory.md) | Ladybug is the on-disk default; Neo4j and Memgraph plug in through the same Memory interface. | 2026-10-13 |
| [Traces](ai-agent-sdk/traces.md) | Every call records an in-process span; secrets and message text stay out unless content is opted in. | 2026-10-13 |
| [Agent Loop](ai-agent-sdk/agent-loop.md) | `tool`, `Agent`, and `run` loop on non-streaming chat until the model answers or a step cap is hit. | 2026-10-13 |
| [Structured Output](ai-agent-sdk/structured-output.md) | A Zod schema becomes JSON Schema on the wire, then the SDK parses the returned string. | 2026-10-13 |
| [Create CLI](ai-agent-sdk/create-cli.md) | `create-ai-agent-sdk` writes one Node TypeScript app and does not stay running. | 2026-10-13 |
