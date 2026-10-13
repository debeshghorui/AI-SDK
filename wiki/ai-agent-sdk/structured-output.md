# Structured Output

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

The provider returns text. `message.content` stays a string. Structure is a second step in the SDK, after the HTTP response is in memory. There is no repair loop that re-asks the model.

## Chat and agent

On `chat.completions.create`, the caller passes `output` as a Zod schema. On `Agent`, the same role is `outputType`. The steps are the same:

1. Build `response_format` as `json_schema`, named `output`, with `z.toJSONSchema(schema, { target: "draft-07" })` and `strict: true`. On a chat call, `output` together with `response_format`, or together with `stream: true`, throws `invalid_request`.
2. Read `choices[0].message.content`. A missing string throws `invalid_output`.
3. `JSON.parse` that string. A parse error throws `invalid_output`.
4. Parse the value with the Zod schema. A Zod failure throws `invalid_output`. The message lists the issue path and code, not the received value.
5. On a chat call, store the parsed value on `completion.output` and leave the original string on `message.content`. On `run()`, store it on `result.finalOutput`.

`run()` uses those steps only on the finishing assistant message (`stopReason: "stop"`). With no `outputType`, `finalOutput` stays the content string.

`response_format: { type: "json_object" }` is forwarded as the OpenAI field and stays a raw string on `message.content`. It cannot be combined with `output`. Providers that reject `json_schema` return `provider_error`. The SDK does not invent a JSON object from prose.

Tool arguments are a different boundary. They are parsed with the tool's Zod schema before `execute`. A failure there is `tool_failed`, and `execute` is not called. See [Agent loop](agent-loop.md).

## See Also

- [Chat contract](chat-contract.md)
- [Agent loop](agent-loop.md)
