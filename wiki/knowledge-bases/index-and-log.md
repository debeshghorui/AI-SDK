# Index and Log

> Sources: Andrej Karpathy, 2026-04-04
> Raw: [LLM Wiki](../../raw/knowledge-bases/2026-04-04-llm-wiki.md)

## Overview

Two special files make a growing wiki navigable. The index is a catalog of pages. The log is a timeline of operations. They answer different questions and both get updated by the maintainer.

## Index

[`index.md`](../index.md) lists every article with a link, a one-line summary, and the date its knowledge last changed, grouped by topic. Update it on every ingest. A query starts here, then opens the pages that look relevant. Karpathy reports this works at moderate scale — on the order of 100 sources and hundreds of pages — without an embedding index.

## Log

[`log.md`](../log.md) is append-only: ingests, filed queries, and lint passes. Entries start with a fixed prefix such as `## [2026-04-02] ingest | Article Title`, so `grep "^## \[" wiki/log.md | tail -5` shows the latest operations. The log is how a later session sees what changed recently.

## Search

The index is the default lookup. When it gets too coarse, add search over the markdown. Karpathy suggests qmd for on-device hybrid search, or a simpler script. This vault ships `scripts/wiki.py search` as that simpler step. It ranks pages by query terms. It does not synthesize an answer.

## See Also

- [Wiki Operations](wiki-operations.md)
- [LLM Wiki](llm-wiki.md)
- [Wiki versus RAG](wiki-versus-rag.md)
