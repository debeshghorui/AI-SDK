# Wiki versus RAG

> Sources: Andrej Karpathy, 2026-04-04
> Raw: [LLM Wiki](../../raw/knowledge-bases/2026-04-04-llm-wiki.md)

## Overview

RAG retrieves raw fragments when a question arrives. An LLM wiki compiles claims, links, and disagreements ahead of time and revises that compilation as sources change. The useful difference is accumulation, not the file format.

## Comparison

| | RAG | LLM wiki |
| --- | --- | --- |
| What is stored | Raw documents and, usually, chunks or embeddings | Raw documents plus maintained markdown pages |
| When synthesis happens | At query time, then discarded | At ingest, then kept |
| Cross-references | Recomputed from whatever chunks were retrieved | Already written, and updated when a new source arrives |
| Contradictions | Whichever chunk the retriever surfaces | Flagged on the pages, with the older claim still visible |
| Cost that grows | Repeated retrieval and re-synthesis | Maintenance of pages, which the model absorbs |
| Scale note from the source | The usual way people use uploads and NotebookLM | The index file is enough around 100 sources and hundreds of pages |

Karpathy's objection to the RAG-shaped workflow is specific: a question that needs five documents forces the model to find and join those fragments again, and nothing is built up. NotebookLM, ChatGPT file uploads, and most RAG systems work that way.

The wiki does not replace raw sources. They stay immutable underneath the pages. Query-time retrieval is still available — the index, and later a search tool — but it retrieves compiled pages first.

## What this comparison does not claim

The source does not report a benchmark against a RAG system. It argues from the maintenance burden: humans drop wikis because bookkeeping outgrows the value, and a model can touch many pages in one pass. Whether that produces better answers on a given corpus is a separate measurement.

## See Also

- [LLM Wiki](llm-wiki.md)
- [Index and Log](index-and-log.md)
- [Wiki Operations](wiki-operations.md)
