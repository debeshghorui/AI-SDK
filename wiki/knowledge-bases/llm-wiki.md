# LLM Wiki

> Sources: Andrej Karpathy, 2026-04-04
> Raw: [LLM Wiki](../../raw/knowledge-bases/2026-04-04-llm-wiki.md)

## Overview

An LLM wiki is a persistent, interlinked markdown knowledge base that the model maintains as sources arrive. Synthesis happens at ingest time, so later questions read compiled pages instead of reassembling raw chunks.

## Claim

Retrieval-augmented generation finds fragments at question time and discards the synthesis afterward. A wiki compiles the source once: entity pages, topic summaries, contradictions, and cross-references stay on disk and get revised when new material conflicts with them. The artifact compounds. The human curates sources and asks questions. The model does the bookkeeping.

Karpathy's working setup puts the agent on one side and Obsidian on the other. Obsidian is the IDE, the model is the programmer, and the wiki is the codebase. The same shape fits research, reading notes, personal logs, and team knowledge, including a human review step when the domain needs one.

The original note is deliberately abstract. Directory layout, page types, and tools are local choices. This vault instantiates them in [`AGENTS.md`](../../AGENTS.md): `raw/` for immutable sources, `wiki/` for compiled pages, and three operations — ingest, query, and lint.

At moderate scale, about a hundred sources and a few hundred pages, [`wiki/index.md`](../index.md) is enough of a catalog to start a query. A search command, `scripts/wiki.py`, covers the next step. Karpathy points at qmd when hybrid search becomes worth it.

## Why the maintenance sticks

People abandon wikis because cross-references and contradiction tracking grow faster than the value of the pages. A model can update many pages in one pass and does not skip the bookkeeping. That is the practical reason the pattern works, and it is also why early mistakes matter: a wrong claim compounds the same way a right one does.

The precedent Karpathy names is Vannevar Bush's Memex (1945): a private store whose associative trails are as valuable as the documents. The open problem was who maintains the trails. In this pattern, the model does.

## See Also

- [Three Layers](three-layers.md)
- [Wiki Operations](wiki-operations.md)
- [Index and Log](index-and-log.md)
- [Wiki versus RAG](wiki-versus-rag.md)
- [Andrej Karpathy](../people/andrej-karpathy.md)
