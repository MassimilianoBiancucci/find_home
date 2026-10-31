---
name: guide
description: Read and maintain this repo's guide/ folder, the reviewed description of the codebase as it is today (architecture, principles, known issues). Use it before or during a code change to find the architecture and principles that apply, when a code change is done to update the guide in the same PR, after a merge or rebase to realign the guide with the code, when a principle may need to change, or to create a guide in a repo that has none.
---

# Guide

The guide is the `guide/` folder at the root of the repository being changed. In a workspace with several repos, it is the `guide/` of the repo you are working in. It describes that repository **as it is today**: what it does, how it is built, the principles every change follows, and the known issues to keep in mind. It is written for people and for coding agents.

The guide is an add-on to however you already work. Plan, design, debug or run QA sessions your own way, with any agent. Use the guide as a reference whenever it helps, and leave it true when your change is done. It is not an archive and not a process.

## Rules

1. **Current state only.** No change logs, task notes, QA transcripts, dates or "now/recently". History lives in git and in PR descriptions.
2. **Same PR.** The guide changes in the same PR as the code it describes.
3. **Who wins when code and guide disagree.**
   - `principles/`: the code is wrong. Fix the code, or propose a principle change (see below).
   - `overview.md`, `architecture/`: the guide is out of date. Fix the guide.
   - `issues/`: check the code; update or remove the entry.
4. **Principles are a team agreement.** Never edit `principles/` on your own initiative or as a side effect. A change is proposed to the user and reviewed with the teammates who work on the repo.
5. **Load little.** Read the overview, then only the pages that cover the task.

## Layout

```
guide/
  overview.md      entry point: what the app is, directory map, page index, what to read before which change
  architecture/    how it is built today: components, flows, where the code lives
  principles/      the line we hold: what to do, what to optimise, what to avoid; each rule with Why and Enforced by
  issues/          known limits that affect how code must be written (tracking stays in the issue tracker)
```

Each part branches into subfolders as the repo grows (`principles/prompting/`, `principles/telemetry.md`, `architecture/flows/`). Templates for every page type: [references/skeleton.md](references/skeleton.md).

## Reading: before or during a task

1. Read `guide/overview.md`.
2. From its index and directory map, pick the pages that cover the files or area you will touch. Read those in full. Do not load the rest.
3. Read every principle that applies to those files. If the task would break one, say so **before** writing code: name the principle, then offer a way that respects it, or a principle change for team review.
4. When debugging or touching a known weak spot, read the matching `issues/` entries.

If there is no `guide/` folder, say so and offer to create one (see Starting a guide).

## Updating: when a code change is done

Do this pass when the code change is complete: before committing or opening the PR, or when the user says they are done. If the user is about to finish without it, remind them once.

1. List what changed: `git diff --name-only <base>...HEAD` plus `git status --short` for uncommitted work. `<base>` is the target branch (ask if unclear; default `main`).
2. For each changed file, find guide pages that mention it, its folder or its main names: `grep -rln "<path, module or class>" guide/`. Also check pages whose topic covers the change even without a direct link.
3. Rewrite what the change made untrue: text, diagrams, directory map, links, names. Describe the result ("X does Y"), never the change ("X now does Y since #123").
4. A new component, flow, agent or integration: extend the matching architecture page (or add one) and the overview index.
5. A known issue fixed: delete its entry; the PR records the fix. A new known limit: add a short entry.
6. A principle affected: stop and follow **Changing a principle**.
7. Run the checks locally:
   - `python3 <this skill's folder>/scripts/check_links.py --guide-dir <repo>/guide` (the skill's folder is where this file is, e.g. `.github/skills/guide/` or `.claude/skills/guide/`)
   - the tests named under "Enforced by" in the principles that cover the changed files.
8. Report in a few lines: pages updated, and anything left for the user to decide.

If the change touches nothing the guide describes, say "guide checked, no update needed" and stop.

## After a merge or rebase

Guide files conflict like code, and can also go silently out of date when the other branch changed what they describe.

1. Resolve code conflicts first.
2. For each conflict in `guide/`, read both versions and the merged code, and write the text that is true **now**. Keep both sides' additions when both still hold.
3. Then run the Updating pass against the new base, so pages your branch edited also reflect what the other branch changed. To list what the other side changed: `git diff --name-only $(git merge-base HEAD <base>) <base>`.
4. Run the link check.

## Changing a principle

Principles set the direction for everyone working on the repo, so they change only by agreement.

1. Tell the user which principle no longer fits and why, and propose the new wording in the principle format (Rule, Why, Bad, Good, Enforced by).
2. Edit the principle only after the user agrees, in the same PR as the code, together with its test.
3. Ask the user to call it out at the top of the PR description ("Principle change: <name>: <one line>") and to request review from the teammates or code owners of the repo. Never let a principle change ride along unannounced.

## Starting a guide in a new repo

Follow [references/bootstrap.md](references/bootstrap.md). In short: create the skeleton, write the overview and architecture from the code, and only **propose** principles and issues for the user to confirm. Never invent a principle.

## Writing style

- Short, plain sentences. One definition per concept.
- Link code with relative paths from the page (`../../src/core/config.py`), so the link check can verify them.
- No dates or narratives. The only history allowed is a commit hash in a principle's Bad example.
- Split a page into a subfolder when it passes about 400 lines or covers two topics, and update the overview index.
