# Guide skeleton and page templates

Every repo uses the same four parts. Start flat; branch into subfolders when a part grows.

```
guide/
  overview.md
  architecture/
    introduction.md          short tour of the main components and the request flow
    <topic>.md               one page per flow or subsystem
  principles/
    <area>_principles.md     e.g. prompting_principles.md, telemetry_principles.md
  issues/
    issues.md                known limits, grouped by area
```

Grown example:

```
guide/
  overview.md
  architecture/
    introduction.md
    flows/customer_identification.md
    flows/summaries.md
  principles/
    prompting/agent_descriptions.md
    prompting/shared_prompts.md
    telemetry.md
    knowledge_base.md
  issues/
    issues.md
```

## overview.md

```markdown
# Guide

One paragraph: what the guide is and that it wins over older notes in the repo.

Read [<principles page>](principles/<page>.md) before <kind of change>.

## What the application is
Two or three paragraphs: purpose, users, main flows, main external systems.

## Directory map
| Path | Content |
|---|---|
| [`src/...`](../src/...) | ... |

## Guide index
- [architecture/introduction.md](architecture/introduction.md): ...
- [principles/<page>.md](principles/<page>.md): ...
- [issues/issues.md](issues/issues.md): known limits.
```

## Architecture page

```markdown
# Architecture: <topic>

One paragraph: what this part does and when it runs. Link to the introduction.

## <Component or step>
What it does, where the code is ([`file`](../../src/...)), what it reads and writes.

(Optional) a mermaid diagram of the flow.

## Where the code lives
| Concern | File |
|---|---|
```

Describe the code as it is. No "will", no "now", no history.

## Principle

```markdown
## <N>. <Short name>

**Rule.** One or two sentences: what every change must do or avoid.

**Why.** The reason, in terms of what breaks or degrades without it.

**Bad.** A concrete example, ideally a real commit (`abc1234`).

**Good.** What it looks like when the rule is followed.

**Enforced by.** The test that checks it ([`test_x.py`](../../src/tests/...)), or "Review" when no test can.
```

A principles page may end with a short pre-merge checklist for its area.

Examples of areas worth a principle: one telemetry path for all agents (no per-agent telemetry), how prompts and agent descriptions are written, rules for a family of agents, how the knowledge base is queried and cited, configuration over code for scope and access.

## Issue entry

```markdown
### <Short title> ([#<id>](<GitHub issue link>), if one exists)
**Impact: high | medium | low.** What goes wrong, and when ([`file`](../../src/...)).
**Fix direction:** one or two sentences.
```

Known limits and pending fixes belong here: things that are open now and that an agent should know before touching the area. Plans, progress and to-do lists do not. Delete an entry when it is fixed; no archive. Important entries can also have a GitHub issue, created only after the user agrees.
