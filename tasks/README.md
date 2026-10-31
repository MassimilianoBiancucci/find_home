# tasks/

Planning and history for each piece of work. `guide/` describes the code **as it is today**; `tasks/` keeps
**why and how** it got there. Never move plans or progress into `guide/`.

## Layout of a task

```
tasks/<slug>/
  QA_planning.md      questions, answers, reasoning, summary (advanced-planner format)
  notes/              research findings, data extracts
  scripts/            analysis scripts used while planning
  plan.md             simple plan, or
  master_plan.md      + plans/subplan_NN_<name>.md for large tasks
  STATUS.md           state (planned | in-progress | done | dropped), outcome, follow-ups
```

## Conventions

- Slug: `verb-object` in kebab case (`verify-sites`, `routing-providers`).
- One task folder per deliverable. Follow-ups go to [BACKLOG.md](BACKLOG.md) first, then get a folder when started.
- A task is `done` when its plan is implemented, the smoke check passes and the guide is updated in the same commit.
