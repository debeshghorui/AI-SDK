# LLM Wiki Schema

This repository is a personal knowledge base in the pattern from Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The human chooses sources and questions. The agent writes and maintains the wiki.

Knowledge is compiled once, then kept current. Do not re-derive the vault from raw files on every question.

## Layers

| Layer | Path | Rule |
| --- | --- | --- |
| Sources | `raw/` | Immutable. Read, never modify or delete. |
| Wiki | `wiki/` | Agent-owned markdown. Create, update, and cross-link it. |
| Schema | `AGENTS.md` | This file. Change it only when the user wants the workflow itself to change. |

`wiki/index.md` is the catalog. Read it before a query, and update it on every ingest and on lint fixes that add or relabel entries.

`wiki/log.md` is append-only. Each entry starts with `## [YYYY-MM-DD] ingest |`, `## [YYYY-MM-DD] query |`, or `## [YYYY-MM-DD] lint |` so `grep "^## \[" wiki/log.md` lists operations.

Templates live in `schema/templates/`. Match them.

## Layout

```text
raw/<topic>/YYYY-MM-DD-slug.md    immutable source
raw/assets/                       downloaded images
wiki/index.md
wiki/log.md
wiki/<topic>/<article>.md         one directory level only
```

Topics are a single path segment, kebab-case. Reuse an existing topic when the subject is close. Create a topic only for a distinct subject. `people/` is for named people. `knowledge-bases/` is for this vault's own method.

## Page conventions

- Standard markdown. Links inside `wiki/` and `raw/` are relative to the file that contains them.
- In conversation, cite pages with project-root paths, for example `[LLM Wiki](wiki/knowledge-bases/llm-wiki.md)`.
- Article metadata is a blockquote under the title: `Sources` and `Raw`. Archive pages use `Sources` and `Archived` and have no `Raw` field.
- `Sources` names the author or publication and a date, semicolon-separated.
- `Raw` links the immutable files, semicolon-separated. From `wiki/<topic>/` the prefix is `../../raw/<topic>/`.
- An article's Updated date is the day its knowledge last changed, not the filesystem mtime.
- Do not copy source text into articles. Distill it. Keep disagreements explicit, with each claim attributed.
- Archive pages are point-in-time answers. Never cascade-update them.

## Ingest

Trigger: the user supplies a URL, file, or pasted text and asks to add, ingest, file, or save it.

1. Read the source. If a tool cannot fetch it, ask the user to paste it.
2. Save `raw/<topic>/YYYY-MM-DD-descriptive-slug.md` using `schema/templates/raw.md`. Slug is kebab-case, at most 60 characters, from the title. Unknown publication date: omit the date prefix and set Published to `Unknown`. If the filename exists, append `-2`, `-3`, and so on. Collected is today's date. Preserve the wording.
3. Compile:
   - Same thesis as an existing article: merge, add the source to `Sources` and `Raw`, and refresh the sections the source changes.
   - New concept, entity, or comparison: create an article named for the idea, not for the filename of the source.
   - One source may update several articles. A single source often touches the summary, the entities, and the concepts.
4. When the new source contradicts a page, write both claims and name the sources. Do not silently overwrite the older claim.
5. Cascade: update every article whose claims change. Refresh each Updated date. Skip archive pages.
6. Update `wiki/index.md` for every touched article. Add a one-line topic description when the topic section is new.
7. Append to `wiki/log.md`:

```markdown
## [YYYY-MM-DD] ingest | <primary article title>
- Updated: <other article title>
```

Omit `- Updated:` lines when nothing else changed.

## Query

Trigger: a question about what the vault knows, a summary, a comparison, or "what do we know about".

1. Read `wiki/index.md`.
2. Open the relevant articles and answer from them. Prefer the wiki over outside knowledge. If the wiki is silent, say so, then add outside context only when it is clearly labeled as not in the vault.
3. Cite articles with project-root markdown links.
4. Do not write files for an ordinary answer.
5. When the user asks to file, save, or archive the answer, create a new page from `schema/templates/archive.md`. Never merge an archive into an existing article. Put it in the closest topic. In the index, prefix the summary with `[Archived]`. Log:

```markdown
## [YYYY-MM-DD] query | Archived: <page title>
```

## Lint

Trigger: lint, health check, or audit of the wiki.

1. Run `python3 scripts/wiki.py lint`.
2. Apply deterministic fixes yourself, or re-run `python3 scripts/wiki.py lint --fix` for the mechanical ones:
   - Article missing from the index: add a row. Summary `(no summary)` until you can write a real one.
   - Index row whose file is gone: prefix the summary with `[MISSING]`. Do not delete the row.
   - Broken relative link with exactly one file of that name elsewhere: rewrite the path.
   - `Raw` link with exactly one matching source elsewhere: rewrite the path.
3. Report, and do not auto-rewrite prose for: contradictions, stale claims, missing disagreement notes, orphan articles (no inbound link from another article), concepts mentioned often with no page, and archive pages whose cited articles changed after `Archived`.
4. Append:

```markdown
## [YYYY-MM-DD] lint | <N> issues found, <M> auto-fixed
```

`python3 scripts/wiki.py search <query>` lists likely pages. It does not replace reading them.

## Images

Store attachments in `raw/assets/`. Read the article text first, then open the images you need. Do not depend on remote image URLs remaining valid.

## What the human does

Curate sources, decide what matters, and ask questions. Bookkeeping, cross-references, the index, and the log belong to the agent.
