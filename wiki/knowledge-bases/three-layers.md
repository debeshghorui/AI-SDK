# Three Layers

> Sources: Andrej Karpathy, 2026-04-04
> Raw: [LLM Wiki](../../raw/knowledge-bases/2026-04-04-llm-wiki.md)

## Overview

The vault has three layers with different owners. Sources are immutable, the wiki is model-written, and the schema tells the model how to behave.

## Raw sources

`raw/` holds articles, papers, images, and data files. The model reads them and does not edit them. They are the source of truth. When a page and a source disagree, the source wins until a newer source supersedes it, and the disagreement stays visible on the page.

Images belong in `raw/assets/` so a page does not depend on a remote URL. Read the surrounding text first, then open the images the text refers to.

## Wiki

`wiki/` holds summaries, entity pages, concept pages, comparisons, and filed answers. The model creates and updates these, including cross-references. The human reads them. One source often changes many pages: the summary, the people and organizations, and the concepts that source touches.

## Schema

The schema is the configuration file that turns a general chatbot into a wiki maintainer. Karpathy names `CLAUDE.md` for Claude Code and `AGENTS.md` for Codex. This vault uses [`AGENTS.md`](../../AGENTS.md) at the repository root, which Cursor loads as agent instructions. It records conventions and the ingest, query, and lint workflows. It should change only when the workflow itself changes, and the human and the model evolve it together.

## See Also

- [LLM Wiki](llm-wiki.md)
- [Wiki Operations](wiki-operations.md)
- [Andrej Karpathy](../people/andrej-karpathy.md)
