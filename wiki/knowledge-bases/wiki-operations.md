# Wiki Operations

> Sources: Andrej Karpathy, 2026-04-04
> Raw: [LLM Wiki](../../raw/knowledge-bases/2026-04-04-llm-wiki.md)

## Overview

Three operations keep the vault useful: ingest compiles a source into pages, query answers from those pages, and lint hunts drift. Explorations are filed back so they compound the same way sources do.

## Ingest

Drop a source into `raw/` and have the model process it. The flow Karpathy describes: read the source, discuss takeaways, write a summary, update the index, update entity and concept pages, append to the log. One source might touch 10 to 15 pages.

He prefers one source at a time, with the human reading the summary and steering emphasis. Batch ingest with less supervision is also valid. Whichever style you use, write it into the schema so the next session repeats it. This vault's rule is in [`AGENTS.md`](../../AGENTS.md): one source, merge when the thesis already has a page, create a page when the concept is new, and record contradictions instead of overwriting them.

## Query

Search the wiki, read the pages, and answer with citations. The product can be a markdown page, a comparison table, slides, a chart, or a canvas. The part that matters for compounding is filing a good answer back into the wiki. A comparison or connection that exists only in chat history is lost. Ordinary answers in this vault stay in the conversation until you ask to file them. A filed answer is an archive page: a snapshot, not a page that later ingests rewrite.

## Lint

Periodically check for contradictions, claims a newer source has superseded, orphan pages, concepts that deserve a page, missing cross-references, and gaps a search could fill. The model should also suggest the next question and the next source. `python3 scripts/wiki.py lint` covers the mechanical half (index rows, relative links, raw references). Contradictions and stale claims still need a reading pass.

## See Also

- [LLM Wiki](llm-wiki.md)
- [Index and Log](index-and-log.md)
- [Three Layers](three-layers.md)
