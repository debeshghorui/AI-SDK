# Agent Loop

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

An agent is `tool()`, `new Agent()`, and `run()`, in the shape of the OpenAI Agents SDK. The agent uses the provider, memory, and traces of the `Client` it is given. The loop is non-streaming and returns one final result.

## Definitions

`tool()` takes `name`, `description`, a Zod `parameters` schema, and `execute`. A tool name matches `^[a-zA-Z0-9_-]{1,64}$`. Duplicate names throw `invalid_request` before the first model call. `parameters`, `execute`, and `outputType` are never sent under those property names. The model sees `parameters` as JSON Schema from `z.toJSONSchema(schema, { target: "draft-07" })`.

`Agent` takes `name`, `instructions`, `client`, `model`, optional `tools`, optional `outputType`, and `maxSteps` (default 5). `instructions` is the system message. `run(agent, input)` sends `input` as one user message. Options may include `threadId`, which stores the transcript, including tool messages, through the [memory](graph-memory.md) rules.

`run` returns `finalOutput`, `traceId`, `messages`, `steps`, and `stopReason`.

## Loop rules

Each model call is one step. A step with no `tool_calls` finishes with `stopReason: "stop"`. Tools in one response run concurrently. Their tool messages are appended in `tool_calls` order.

The model returns `tool_calls[].function.arguments` as a string. The SDK `JSON.parse`s it, then `parameters.safeParse`. `execute` receives the parsed object. `z.object` drops unknown keys. `z.strictObject` rejects them and the run finishes with `tool_failed` without calling `execute`. Invalid JSON or a failed parse does the same.

`execute`'s return value is `JSON.stringify`'d into the tool message. A value that cannot be serialized, a throw, or a string longer than 100,000 characters finishes with `tool_failed`. The return value is not checked against a second schema. A tool name the agent does not have finishes with `missing_execute`. The loop does not invent a tool result.

Hitting `maxSteps` while the model still wants tools finishes with `max_steps` and returns the result. It does not throw. When `outputType` is omitted, `finalOutput` is the final `message.content` string. When it is set, the [structured output](structured-output.md) steps run on the finishing assistant message. There is no second model call to repair a bad string.

If the bound memory implements `remember` and `search`, `run()` adds [memory tools](graph-memory.md) and handles them itself.

## See Also

- [Structured output](structured-output.md)
- [Graph memory](graph-memory.md)
- [Traces](traces.md)
- [Chat contract](chat-contract.md)
