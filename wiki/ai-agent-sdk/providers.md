# Providers

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

Five factories plug into `createClient`. They share one chat contract. They differ by base URL, credential, and, for Azure, by path and auth header.

## Factories

Each factory with no arguments reads its key and URL from the environment. A field on the argument object overrides that one environment value. Other fields still come from the environment. An empty string in the argument is a value, so it overrides and does not fall through.

| Factory | Import | Default base URL | Key |
| --- | --- | --- | --- |
| `openai()` | `ai-agent-sdk/openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY`, required at construction |
| `groq()` | `ai-agent-sdk/groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY`, required |
| `mistral()` | `ai-agent-sdk/mistral` | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY`, required |
| `ollama()` | `ai-agent-sdk/ollama` | `OLLAMA_BASE_URL` or `http://127.0.0.1:11434/v1` | Optional. A Bearer token is sent only when a key is present |
| `azureOpenAI()` | `ai-agent-sdk/azure-openai` | Derived from the endpoint | `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT`, both required |

Every factory accepts `apiKey`, `baseURL`, `headers`, and a custom `fetch`. Azure also accepts `endpoint` and `apiVersion` (default `2024-10-21`). A missing required key or Azure endpoint throws `SDKError` `missing_config` when the factory runs.

Provider ids are `openai`, `groq`, `mistral`, `ollama`, and `azure-openai`.

## Wire differences

The four Bearer providers POST `{baseURL}/chat/completions` with `Authorization: Bearer` and `Content-Type: application/json`. Ollama omits `Authorization` when no key was configured.

Azure posts to `{endpoint}/openai/deployments/{model}/chat/completions?api-version={apiVersion}` with header `api-key`. `model` is the deployment name and is also sent in the JSON body.

HTTP handling lives in one core helper, `postChat`. Providers do not reimplement streaming parse logic. One shared contract test defines "OpenAI-compatible" for this SDK. Each provider package must pass it against a local mock. Azure passes the same response assertions against its own URL and header.

Swapping providers means constructing another client. The chat method, request fields, and response shape stay.

## See Also

- [AI Agent SDK](product.md)
- [Chat contract](chat-contract.md)
- [Graph memory](graph-memory.md)
