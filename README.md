# LLM Wiki

A local knowledge base maintained by the coding agent. Sources stay immutable in `raw/`. The agent compiles them into interlinked markdown in `wiki/`. The contract is [`AGENTS.md`](AGENTS.md), following Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

The first source is that idea itself, compiled into the pages under `wiki/`.

## Use it

In Cursor, talk to the agent in ordinary language:

- **Ingest** a URL, file, or paste: "Ingest https://example.com/paper".
- **Query** the vault: "What do we know about how a wiki differs from RAG?"
- **Lint** the vault: "Lint the wiki".

Good answers stay in the conversation until you ask to file them. Filed answers become archive pages and are not rewritten when later sources arrive.

Open the folder in Obsidian to browse links and the graph. Markdown links are on, and attachments are stored in `raw/assets/`.

## Checks

```bash
python3 scripts/wiki.py lint
python3 scripts/wiki.py search "compounding"
```

`lint` checks the index, relative links, and raw-source references. `lint --fix` repairs missing index rows, marks missing files, and rewrites a broken link when exactly one file has that name. Judgment calls (contradictions, orphans, stale claims) stay in the lint report for the agent.

## Layout

```text
AGENTS.md          schema: ingest, query, lint
raw/<topic>/       immutable sources
wiki/index.md      catalog
wiki/log.md        append-only operations
wiki/<topic>/      compiled articles, one level deep
schema/templates/  page formats
scripts/wiki.py    search and deterministic lint
```
