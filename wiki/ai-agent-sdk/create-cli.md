# Create CLI

> Sources: Project draft, 2026-10-13
> Raw: [Product requirements](../../raw/ai-agent-sdk/2026-10-13-product-requirements.md)

## Overview

`create-ai-agent-sdk` scaffolds one Node TypeScript app, the way Create Next App and Create Vite do, then stops. `npm create ai-agent-sdk@latest`, `npx create-ai-agent-sdk@latest`, and `pnpm create ai-agent-sdk` are the same bin. It does not generate a Next.js or Vite frontend, and it does not stay running as a dev server.

## Prompts and flags

On a TTY it asks only for values the flags did not set: project directory (default `ai-agent-app`), provider (`openai`, `groq`, `mistral`, `ollama`, `azure-openai`; default `openai`), and memory (`ladybug`, `neo4j`, `memgraph`; default `ladybug`). Directory and provider are required when stdin is not a TTY, so a script never waits on a prompt. Non-TTY memory defaults to `ladybug` when `--memory` is omitted.

`--no-install` writes files and skips the package manager. `--no-agent` omits `src/agent.ts` and the `agent` script. Unknown flags exit `1` and write nothing. A missing directory is created. An empty directory is used. A non-empty directory exits `1` and writes nothing. The command never writes outside the target directory.

There is one template. The provider choice changes the model import, the factory call, the model string, and the provider variables in `.env.example`. The memory choice changes the memory import and the memory variables. The file list stays the same.

## What it writes

Files are `package.json` (ESM, named after the directory), `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`, `src/index.ts`, and `src/agent.ts` unless `--no-agent`. `dev` runs `src/index.ts` with `tsx`. Dependencies are `ai-agent-sdk`, `zod`, and `dotenv`, plus `neo4j-driver` when memory is Neo4j or Memgraph. Dev dependencies are `typescript` and `tsx`, pinned as caret ranges from the CLI's release, not `latest` at runtime.

`.gitignore` includes `.env`, `node_modules`, `dist`, and `.ai-agent-sdk/`. `.env.example` contains empty values, never a real key. The CLI does not ask for an API key or a database password. Template model strings are `gpt-4o-mini` (OpenAI and Azure), `llama-3.3-70b-versatile` (Groq), `mistral-small-latest` (Mistral), and `llama3.2` (Ollama). `src/index.ts` loads dotenv, builds a client with the chosen factory and no arguments, sends `"Hello"`, and prints content and `traceId`. Ladybug omits `memory` and uses the core default. Hosted memory passes `neo4j()` or `memgraph()` with no arguments so credentials come from the environment. `src/agent.ts` is an echo tool with `maxSteps` of 5.

Unless `--no-install`, the CLI installs after the files are written. It picks npm, pnpm, yarn, or bun from `npm_config_user_agent`, and otherwise uses npm. A failed install leaves the files, prints the install command, and exits `1`. Templates live inside the CLI package. The only network use is the dependency install.

## See Also

- [AI Agent SDK](product.md)
- [Providers](providers.md)
- [Graph memory](graph-memory.md)
