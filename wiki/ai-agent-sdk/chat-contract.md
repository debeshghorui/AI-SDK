# Chat Contract

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

The public surface is `client.chat.completions.create`. `stream: true` returns an async iterable of OpenAI chat chunks. There is no separate stream method. Unknown request fields fail with `invalid_request`. They are not dropped and not forwarded.

## Client

`createClient` takes a required `provider`, optional `memory` and `traces`, optional `middleware`, `timeoutMs` (default 60 seconds), and `maxRetries` (default 2, meaning three attempts). The provider is bound on the client. A swap is a new client.

## Request

The request is a strict object. `model` and `messages` are required. Roles are `system`, `user`, `assistant`, and `tool`. `content` is a string. `tool` messages require `tool_call_id`. Assistant messages may include `tool_calls`. Optional OpenAI fields in the subset are `temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `user`, `tools` (function tools only), `tool_choice`, `response_format`, and `stream`.

Three fields are SDK extensions and stay off the wire body: `threadId` (memory loads and appends for that thread), `signal` (`AbortSignal`), and `output` (a Zod schema). `output` is mutually exclusive with `response_format` and with `stream: true`. `n` is outside the subset. Callers who need multiple choices send multiple requests.

`WireChatRequest` is the JSON body without `threadId`, `signal`, or `output`.

## Response and errors

A non-streaming response keeps the OpenAI fields the provider sends: `id`, `object`, `created`, `model`, `choices` (`index`, `message`, `finish_reason`), and `usage` when present. Every response also has `traceId`. When `output` was passed, `output` is the value parsed from `choices[0].message.content`, and the original string stays on `message.content`.

`collectStream` concatenates content deltas and assembles `tool_calls` into the same message shape as a non-streaming response.

`SDKError` codes are `missing_config`, `invalid_request`, `provider_error`, `timeout`, `aborted`, `invalid_output`, `tool_failed`, `max_steps`, `unsupported_runtime`, and `memory_error`. Provider HTTP errors become `provider_error` and keep `status` plus the provider's `error.message` when the body matches the OpenAI error shape. The raw body is `cause` and is never written to a trace.

## Timeouts and retries

The default timeout is 60 seconds until response headers. Streaming then allows 60 seconds of idle time between chunks, with an overall cap of 10 minutes. Aborting `signal` yields `aborted` and does not retry.

Retryable failures are network errors, HTTP 408, 409, 429, and 500–599, on attempts that have not yet delivered a stream chunk. Backoff is 200ms, then 800ms, plus up to 100ms of jitter. A `Retry-After` under 10 seconds overrides that backoff for 429 and 503. A larger value is not waited out. Once a stream has yielded a chunk, that attempt is not retried. A retry can duplicate a generation the provider already accepted.

## See Also

- [Providers](providers.md)
- [Structured output](structured-output.md)
- [Graph memory](graph-memory.md)
- [Traces](traces.md)
