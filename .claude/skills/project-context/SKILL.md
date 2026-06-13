---
name: project-context
description: >-
  Build and maintain a living, cross-session context document for a
  software/design project, stored as Markdown in the project's own git repo
  (root file at documents/index.md plus sub-documents). Use it automatically
  whenever working in a repo that has documents/index.md — read it first to
  resume without the user re-explaining. Also trigger when the user says things
  like "update the context", "record/fix this decision", "let's continue the
  project", or "pick up where we left off"; at the start and end of a working
  session to sync the index; and when the user asks to set up a context document
  for a new project from scratch.
---

# project-context

## What this skill is for

Long-running projects suffer one recurring pain: every new chat starts from
zero, and the user has to re-explain the whole project. This skill fixes that by
maintaining an explicit, user-owned context document in the project's git repo.
The document is the source of truth that any future session reads first, so work
resumes seamlessly.

The canonical root file is `documents/index.md` in the project repo. The current
project is **Outland** at `/Users/loo/repos/outland/` (root: `documents/index.md`).

## Core principles

- **The repo file is the source of truth.** Not chat memory, not your
  recollection. If it isn't written to `documents/`, it doesn't persist.
- **Index is a map, details live in sub-documents.** Keep `index.md` short and
  navigable; push depth into `decisions.md`, `mechanics.md`, etc.
- **Update after decisions, not after every message.** Capture significant
  decisions as they're made; sync the index at session end. Don't churn the file
  on every turn.
- **The user owns it.** Show changes before committing. Don't silently rewrite
  history.

## When the skill fires (triggers)

1. **Contextual (automatic).** Working in a repo that has `documents/index.md` →
   read it first at the start of work. This is the core "baton pass" mechanism.
2. **Explicit phrases.** "update the context", "record this decision", "continue
   the project", "pick up where we left off", "wrap up the session".
3. **Session boundaries.** At the start, read `index.md` and briefly confirm
   state with the user. At the end (or on "update the context"), sync `index.md`
   and offer to commit.
4. **New project from scratch.** An explicit request like "set up a context
   document for this project" activates the skill in creation mode. Absence of
   `index.md` alone does NOT auto-activate (the skill must not crawl every repo).

## Document structure

Five files. Sub-documents are created **lazily** — a file appears on disk only
when it has real content; until then it is marked "не создан / not created" in
the index's document map. No empty placeholders.

```
documents/
├── index.md          # map + pitch + status + decision summary + top open questions
├── decisions.md      # append-only decision log (lightweight ADR style)
├── open-questions.md # unresolved questions / the design tree's open nodes
├── mechanics.md      # project-specific deep content (glossary lives here as a section)
└── references.md     # external sources, links, data for calibration
```

A standalone `glossary.md` is split out only if the glossary section in
`mechanics.md` outgrows its place.

## index.md composition

Six core sections plus two digest sections:

1. **Pitch / central thesis** — 3–5 lines.
2. **Status** — stage, platform, active task.
3. **Document map** — table of files + status (created / not created).
4. **Decision summary** — one line per `D-XXX` → details in `decisions.md`.
5. **Top open questions** — current nodes only → details in `open-questions.md`.
6. **Changelog** — dates + one line each.
7. **Mechanics (digest)** + **References (digest)** — one line per item, each
   pointing to its sub-document. Kept for a self-sufficient entry point.

## Decision log format (lightweight ADR)

Append to `decisions.md`:

```markdown
## D-007 — <short title>   (YYYY-MM-DD, status: accepted)
**Context:** why this came up.
**Decision:** what we chose.
**Alternatives considered:** what we rejected and why.
```

## Workflow

**When resuming a project**
- Read `documents/index.md` first, then any sub-document relevant to the task.
- Briefly confirm the current state with the user before diving in.

**When a decision is made**
- Append an entry to `decisions.md`.
- Update the decision summary + top open questions in `index.md` if affected.

**At session end (or on "update the context")**
- Sync `index.md`: status, decision summary, top open questions, changelog line.
- Show a diff/summary of what changed.
- With user confirmation, commit: `context: <what changed>`.

## Persistence mechanics (environment-aware)

- **In Claude Code (primary):** read and write the files on disk directly.
  Create files that don't exist. After writing, summarize the change; commit only
  with user consent, and avoid committing into a dirty working tree without asking.
- **In a plain chat (no disk access):** you cannot write to `/Users/...`. Instead,
  output the full updated file content and tell the user exactly which path to
  save it to.

## Length budget

Keep `index.md` under ~300 lines. When a section outgrows that, move depth into a
sub-document and leave a one-line pointer in the index.
