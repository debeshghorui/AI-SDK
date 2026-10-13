# Traces

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

Every `chat.completions.create` and every `run()` produces a trace, including failures. The caller can read the last spans in process. Message text stays out unless the caller opts in. Secrets never appear.

## Buffer

Each client keeps the last 200 spans, newest kept. `client.traces.list()` returns them. `client.traces.clear()` empties the buffer. Span names are `chat.completions`, `chat.completions.attempt`, `agent.run`, and `agent.tool`. A span has `traceId`, `spanId`, optional `parentSpanId`, ISO-8601 start and end, attributes, status `ok` or `error`, and an optional `errorCode`.

Attributes set when known: `provider`, `model`, `stream`, `http.status`, `attempt`, `threadId` (only when the caller passed one), token usage, and on tool spans `tool.name` and `tool.ok`. Never set: header values, API keys, message content, tool arguments, or tool results.

`traces: { content: true }` adds `messages` and `output` text. That is off by default. `traces: false` disables the buffer and OpenTelemetry export for that client. `traceId` on the chat or agent result matches the span. The completion itself is still the provider's result. The trace is a side effect.

## OpenTelemetry

If the application has registered a real tracer and `trace.getTracer` from `@opentelemetry/api` returns it, the same spans are emitted there. The SDK never calls `NodeSDK` and never configures an exporter.

## Middleware order

Tracing and memory are internal middleware, so a later capability can use the same extension point. Order is tracing, then memory, then user middleware in array order, then the provider call. User middleware sees the wire request and the wire response. It cannot see `execute` functions.

## See Also

- [Chat contract](chat-contract.md)
- [AI Agent SDK](product.md)
- [Agent loop](agent-loop.md)
