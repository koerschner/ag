---
name: heartbeat-scratchpad-loop
description: Run a self-editing heartbeat loop - a recurring T3 scheduled task that wakes the same thread every N minutes, does one focused research or monitoring step, saves results to a git dataroom, and rewrites its own prompt (the scratchpad) with fresher ranked state. Use for "heartbeat", "self-editing loop", "recurring research loop", "scratchpad automation", "keep digging every N minutes", rare-token / alpha research (hunting high-value, little-seen information), or monitoring something over time.
---

# Heartbeat scratchpad loop

The **thread** is the execution surface, **tools** are the action surface, and the **scheduled task's prompt is the scratchpad**. A recurring heartbeat wakes the same thread; each wake does one focused, bespoke step, then rewrites the task's own prompt so the next wake starts from fresher, more compact state. Ported from a Codex pattern ("self-editing heartbeats with seeds", which used `automation_update`).

Every wake:
1. **Scope** the next step from the scratchpad (top of *Next actions*).
2. **Execute** it with real tools (one item, done well, beats bulk enrichment).
3. **Save** results to the dataroom and commit.
4. **Rewrite** the scratchpad (ranked, compact, absolute dates) and update the task's prompt with it.
5. **Stop** if the stop condition is met: delete the task and report.

## The heartbeat: T3 `schedule_task`

Use T3's scheduled tasks (in codemode: `tools["mcp__t3-code__schedule_task"]`, plus `delete_scheduled_task`, `list_scheduled_tasks`, `run_scheduled_task_now`). They run server-side, so they survive Pi hibernation, and a run fires only when no turn is active in the thread (runs never stack).

`schedule_task` args:
- `prompt`: the scratchpad (see the template).
- `schedule`: `{ type: "interval", everyMs }`, `everyMs >= 60000`.
- `bindToCurrentThread` (default `true`): runs post into this thread. Keep it true.
- `title`, `enabled`.
- `scheduledTaskId`: update an existing task in place; only the fields you pass change.

### Setup (once, by the agent the user asked)

1. Agree the objective, seeds, cadence and stop condition with the user (or take them from the request).
2. Create the dataroom (below) and write `scratchpad.md` from [references/prompt-template.md](references/prompt-template.md).
3. `schedule_task` with the prompt, interval and a short title. Note the returned `scheduledTaskId`.
4. **Immediately update it** (`scheduledTaskId` + `prompt`) so the prompt contains its own id: "Your scheduledTaskId is `<id>`; at the end of this run call schedule_task with scheduledTaskId=`<id>` and the rewritten prompt." A scheduled run must **never** call `list_scheduled_tasks` to find itself.
5. Optionally `run_scheduled_task_now` for the first step, then tell the user the title, id, cadence, stop condition and dataroom path.

### Each run

- Pass only `scheduledTaskId` and `prompt` when rewriting (leave schedule and title alone unless deliberately changing cadence).
- Mirror the new prompt to `<dataroom>/scratchpad.md` in the same commit.
- If a run errors mid-way, still rewrite the scratchpad with what happened (so the next wake doesn't repeat a dead end).

### Fallbacks

- **Short in-session loops only:** Pi's `schedule_prompt` tool (pi-schedule-prompt; `action: "update"` by `jobId`). It dies with the Pi process and can't create jobs from inside a scheduled run.
- **Detached cron** (each run a fresh session, no shared thread): an ag routine (`ag routine new`), with the scratchpad in the dataroom file instead of the prompt.
- **Not ag-tickler**: it's one-shot.

## Dataroom (durable memory)

Default `~/datarooms/<slug>/`, a git repo (`git init` if missing):

- `scratchpad.md`: mirror of the current prompt.
- `findings.md`: ranked conclusions with sources and dates (not dumps).
- `sources/`: raw captures worth keeping (one file per item, named by date + slug).
- `index.md`: one line per source/finding, for quick lookup.

Commit each meaningful step (`git add -A && git commit -m "iter N: <what>"`). This repo belongs to the loop: local commits need no approval. **Don't add a remote or push** unless the user asks. The prompt is short-term memory; the dataroom is long-term memory.

## Scratchpad rules

Sections (in order): **Current objective, Sources/seeds, Current state, Ranked candidates/leads, Deprioritized, Next actions, Guardrails, Stop condition**, plus the self-ID line and an **iteration counter**.

- Short-term memory, not a transcript. Overwrite stale sections; don't append logs.
- Ranked bullets. Conclusions, not dumps (details live in the dataroom).
- Absolute dates (`2026-10-27`), never "yesterday".
- Keep it under ~4k chars; demote or drop to stay there.
- One task owns one subproblem.

## Tools for the step

- Web: `brave-search` skill (search + content extraction).
- X: `x-api` skill (`xurl` / `x` MCP). Pay-per-use: budget reads, prefer targeted search over timelines.
- Pages and reverse-engineering sites: `browser-tools` or `playwright-interactive`, headless on ag-engine.
- Code, docs, papers, datasets: `nia`.
- Logged-in pages only: `ag cua` (ag-mac, queued, slow). Never per heartbeat; use it once to build programmatic access, or for a rare high-value item.

## Seeding: "what good looks like"

Seeds steer the loop better than instructions. Give it:
- High-signal posts (e.g. tweets whose replies contain experts), to follow outward.
- Niche search engines, aggregators, indexes, and directories.
- Sites to reverse-engineer (their sources, APIs, linked communities).

The goal is **rare tokens**: high-value, information-dense, little-seen content. Bespoke per-item actions (read the thread, chase the citation, check the author's other work) beat bulk enrichment. Allow **entropy**: let it follow promising leads off-seed; for breadth, run k parallel loops with different seeds and compare.

## Multiple loops

Split into several tasks (scout / validator / monitor / coordinator) only when the subproblems are genuinely separable. Each owns its own scratchpad and dataroom subfolder; the coordinator reads their findings files, not their prompts.

## Cost guardrails

- Cadence: default 2-5 min (`everyMs` 120000-300000). 1 min only when each step is cheap.
- Always an explicit stop condition: max iterations and/or a target count and/or an expiry date (absolute). The iteration counter lives in the scratchpad.
- At stop: `delete_scheduled_task`, final commit, short summary in the thread.
- Notify the user (`ag-text`, or just a message in the thread) only past a stated threshold (e.g. a candidate scoring above X), not every run.

## Where to run it

Run each loop in its **own thread/session**, not in a busy working thread (runs wait for idle turns and fill the thread). If it shouldn't sync to Nessie, start that session with the `piPrivate` provider or `ag private`.
