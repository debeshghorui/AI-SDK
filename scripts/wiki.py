#!/usr/bin/env python3
"""Search and lint the markdown wiki. Synthesis stays with the agent."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIKI = ROOT / "wiki"
RAW = ROOT / "raw"
SKIP_NAMES = {"index.md", "log.md"}
LINK_RE = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


@dataclass
class Issue:
    code: str
    path: Path
    message: str
    fix: str | None = None


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)
    fixed: list[str] = field(default_factory=list)

    def add(self, code: str, path: Path, message: str, fix: str | None = None) -> None:
        self.issues.append(Issue(code, path, message, fix))


def rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def wiki_articles() -> list[Path]:
    if not WIKI.exists():
        return []
    return sorted(
        p
        for p in WIKI.rglob("*.md")
        if p.is_file() and p.name not in SKIP_NAMES and "templates" not in p.parts
    )


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def strip_code_fences(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def links_in(text: str) -> list[tuple[str, str]]:
    return [(label, target) for label, target in LINK_RE.findall(strip_code_fences(text))]


def is_external(target: str) -> bool:
    return target.startswith(("http://", "https://", "mailto:", "#"))


def resolve_link(source: Path, target: str) -> Path | None:
    path_part = target.split("#", 1)[0]
    if not path_part or is_external(target):
        return None
    return (source.parent / path_part).resolve()


def article_updated(path: Path) -> str:
    text = read(path)
    match = re.search(r"^>\s*Updated:\s*(\d{4}-\d{2}-\d{2})\s*$", text, re.M)
    if match:
        return match.group(1)
    archived = re.search(r"^>\s*Archived:\s*(\d{4}-\d{2}-\d{2})\s*$", text, re.M)
    if archived:
        return archived.group(1)
    return date.fromtimestamp(path.stat().st_mtime).isoformat()


def article_summary(path: Path) -> str:
    for line in read(path).splitlines():
        if line.startswith("## "):
            continue
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith(">"):
            sentence = re.split(r"(?<=[.!?])\s", stripped, maxsplit=1)[0]
            return sentence[:140]
    return "(no summary)"


def index_rows(text: str) -> list[tuple[str, str]]:
    rows = []
    for label, target in links_in(text):
        if target.startswith(("http://", "https://")):
            continue
        rows.append((label, target))
    return rows


def files_by_name(root: Path) -> dict[str, list[Path]]:
    found: dict[str, list[Path]] = defaultdict(list)
    if root.exists():
        for path in root.rglob("*"):
            if path.is_file() and not path.name.startswith("."):
                found[path.name].append(path)
    return found


def metadata_line(text: str, name: str) -> str | None:
    match = re.search(rf"^>\s*{name}:\s*(.+)$", text, re.M)
    return match.group(1).strip() if match else None


def lint(fix: bool) -> Report:
    report = Report()
    articles = wiki_articles()
    index_path = WIKI / "index.md"
    by_name = files_by_name(WIKI)
    raw_by_name = files_by_name(RAW)

    if not index_path.exists():
        report.add("index", WIKI, "wiki/index.md is missing")
        return report

    index_text = read(index_path)
    indexed: dict[Path, str] = {}
    for label, target in index_rows(index_text):
        resolved = resolve_link(index_path, target)
        if resolved is None:
            continue
        indexed[resolved] = label
        if not resolved.exists():
            report.add(
                "missing-file",
                index_path,
                f"index entry [{label}]({target}) does not exist",
                fix=target,
            )

    article_set = {p.resolve() for p in articles}
    for path in articles:
        if path.resolve() not in indexed:
            report.add(
                "unindexed",
                path,
                "article is not listed in wiki/index.md",
            )

    if fix:
        index_text, notes = apply_index_fixes(index_text, index_path, report, article_set)
        if notes:
            write(index_path, index_text)
            report.fixed.extend(notes)

    for path in articles:
        text = read(path)
        raw_field = metadata_line(text, "Raw")
        replacements: list[tuple[str, str]] = []
        for label, target in links_in(text):
            if is_external(target):
                continue
            resolved = resolve_link(path, target)
            if resolved is None or resolved.exists():
                continue
            in_raw_field = raw_field is not None and target in raw_field
            catalog = raw_by_name if in_raw_field else by_name
            name = Path(target.split("#", 1)[0]).name
            matches = catalog.get(name, [])
            if len(matches) == 1:
                new_target = Path(os_relpath(matches[0], path.parent)).as_posix()
                anchor = target.split("#", 1)[1] if "#" in target else ""
                if anchor:
                    new_target = f"{new_target}#{anchor}"
                replacements.append((target, new_target))
                report.add(
                    "rewritable-link",
                    path,
                    f"[{label}]({target}) can move to {new_target}",
                    fix=new_target,
                )
            else:
                kind = "raw source" if in_raw_field else "wiki page"
                report.add(
                    "broken-link",
                    path,
                    f"[{label}]({target}) has {len(matches)} {kind} matches",
                )
        if fix and replacements:
            updated = text
            for old, new in replacements:
                updated = updated.replace(f"]({old})", f"]({new})", 1)
            if updated != text:
                write(path, updated)
                report.fixed.append(f"rewrote links in {rel(path)}")

    inbound = inbound_articles(articles)
    for path in articles:
        if path.resolve() not in inbound:
            report.add("orphan", path, "no other article links here")

    return report


def os_relpath(target: Path, start: Path) -> str:
    return Path(os_path_rel(target, start)).as_posix()


def os_path_rel(target: Path, start: Path) -> str:
    import os

    return os.path.relpath(target, start)


def apply_index_fixes(
    index_text: str,
    index_path: Path,
    report: Report,
    article_set: set[Path],
) -> tuple[str, list[str]]:
    notes: list[str] = []
    lines = index_text.splitlines()
    new_lines: list[str] = []
    for line in lines:
        if "[MISSING]" in line:
            new_lines.append(line)
            continue
        replaced = False
        for label, target in links_in(line):
            resolved = resolve_link(index_path, target)
            if resolved is not None and not resolved.exists() and "[MISSING]" not in line:
                line = line.replace("| ", "| ", 1)
                parts = [part.strip() for part in line.strip().strip("|").split("|")]
                if len(parts) == 3 and not parts[1].startswith("[MISSING]"):
                    parts[1] = f"[MISSING] {parts[1]}"
                    line = "| " + " | ".join(parts) + " |"
                    notes.append(f"marked missing: {target}")
                    replaced = True
        new_lines.append(line)
        _ = replaced

    text = "\n".join(new_lines)
    if index_text.endswith("\n"):
        text += "\n"

    indexed_now = set()
    for _, target in index_rows(text):
        resolved = resolve_link(index_path, target)
        if resolved is not None:
            indexed_now.add(resolved)

    additions: dict[str, list[str]] = defaultdict(list)
    for path in sorted(article_set):
        if path.resolve() in indexed_now:
            continue
        topic = path.parent.name
        link = Path(os_path_rel(path, WIKI)).as_posix()
        title = title_of(path)
        row = f"| [{title}]({link}) | (no summary) | {article_updated(path)} |"
        additions[topic].append(row)
        notes.append(f"indexed {link}")

    if additions:
        text = insert_rows(text, additions)

    return text, notes


def title_of(path: Path) -> str:
    for line in read(path).splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def insert_rows(text: str, additions: dict[str, list[str]]) -> str:
    lines = text.splitlines()
    output: list[str] = []
    current_topic: str | None = None
    seen_topics: set[str] = set()
    i = 0
    while i < len(lines):
        line = lines[i]
        heading = re.match(r"^##\s+(.+)$", line)
        if heading:
            flush_topic(output, current_topic, additions)
            current_topic = heading.group(1).strip()
            seen_topics.add(current_topic)
        output.append(line)
        i += 1
    flush_topic(output, current_topic, additions)
    for topic, rows in additions.items():
        if topic in seen_topics:
            continue
        if output and output[-1] != "":
            output.append("")
        output.append(f"## {topic}")
        output.append("")
        output.append("Added by lint. Replace this description.")
        output.append("")
        output.append("| Article | Summary | Updated |")
        output.append("|---------|---------|---------|")
        output.extend(rows)
    result = "\n".join(output)
    if not result.endswith("\n"):
        result += "\n"
    return result


def flush_topic(output: list[str], topic: str | None, additions: dict[str, list[str]]) -> None:
    if topic is None or topic not in additions:
        return
    rows = additions.pop(topic)
    while output and output[-1] == "":
        output.pop()
    output.extend(rows)
    output.append("")


def inbound_articles(articles: list[Path]) -> set[Path]:
    inbound: set[Path] = set()
    known = {p.resolve() for p in articles}
    for path in articles:
        for _, target in links_in(read(path)):
            resolved = resolve_link(path, target)
            if resolved is not None and resolved in known and resolved != path.resolve():
                inbound.add(resolved)
    return inbound


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def search(query: str, limit: int) -> int:
    terms = tokenize(query)
    if not terms:
        print("Provide a search query.", file=sys.stderr)
        return 2
    scored: list[tuple[int, Path, str]] = []
    for path in wiki_articles():
        text = read(path)
        title = title_of(path)
        haystack = tokenize(title + "\n" + text)
        if not haystack:
            continue
        counts = defaultdict(int)
        for token in haystack:
            counts[token] += 1
        score = sum(counts[term] for term in terms)
        title_tokens = set(tokenize(title))
        score += sum(3 for term in terms if term in title_tokens)
        if score:
            snippet = snippet_for(text, terms)
            scored.append((score, path, snippet))
    scored.sort(key=lambda item: (-item[0], rel(item[1])))
    if not scored:
        print("No wiki pages matched.")
        return 0
    for score, path, snippet in scored[:limit]:
        print(f"{score:3}  {rel(path)}")
        if snippet:
            print(f"     {snippet}")
    return 0


def snippet_for(text: str, terms: list[str]) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith(">"):
            continue
        lower = stripped.lower()
        if any(term in lower for term in terms):
            return stripped[:160]
    return ""


def print_report(report: Report) -> int:
    counts: dict[str, int] = defaultdict(int)
    for issue in report.issues:
        counts[issue.code] += 1
        print(f"{issue.code}: {rel(issue.path)}: {issue.message}")
    for note in report.fixed:
        print(f"fixed: {note}")
    total = len(report.issues)
    print(f"\n{total} issues, {len(report.fixed)} auto-fixed")
    for code in sorted(counts):
        print(f"  {code}: {counts[code]}")
    hard = [code for code in counts if code not in {"orphan", "rewritable-link"}]
    return 1 if hard else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Search and lint the LLM wiki.")
    sub = parser.add_subparsers(dest="command", required=True)

    lint_parser = sub.add_parser("lint", help="check index, links, and orphans")
    lint_parser.add_argument(
        "--fix",
        action="store_true",
        help="add missing index rows, mark missing files, rewrite unique broken links",
    )

    search_parser = sub.add_parser("search", help="rank wiki articles by query terms")
    search_parser.add_argument("query")
    search_parser.add_argument("--limit", type=int, default=10)

    args = parser.parse_args(argv)
    if args.command == "lint":
        return print_report(lint(args.fix))
    return search(args.query, args.limit)


if __name__ == "__main__":
    sys.exit(main())
