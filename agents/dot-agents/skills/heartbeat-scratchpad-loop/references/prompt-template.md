# Scratchpad prompt template

Fill this in at setup, create the task, then update it with the real `scheduledTaskId`. Each run rewrites the whole prompt (same shape) and mirrors it to `<dataroom>/scratchpad.md`. Keep it under ~4k chars.

```markdown
# Heartbeat: <title>

You are one wake of a self-editing heartbeat loop (skill: heartbeat-scratchpad-loop).
Your scheduledTaskId is <id>. Do NOT call list_scheduled_tasks.
Dataroom: ~/datarooms/<slug>/ (git repo; commit locally, never push).
Iteration: <n> of max <N>. Last run: <YYYY-MM-DD HH:MM TZ>.

## This run
1. Take the top item in Next actions. Do that one thing well with real tools.
2. Save results: sources/<date>-<slug>.md, update findings.md and index.md, commit "iter <n+1>: <what>".
3. Check the Stop condition. If met: call delete_scheduled_task with scheduledTaskId=<id>, commit, post a short summary, and stop.
4. Otherwise rewrite this whole prompt (iteration +1, fresh ranked state, absolute dates, < 4k chars), write it to scratchpad.md, commit, then call schedule_task with scheduledTaskId=<id> and prompt=<the rewritten prompt> (no other fields).
5. Notify the user only if: <threshold, e.g. a lead scores >= 8/10>.

## Current objective
<one or two sentences: what we're finding/monitoring and why>

## Sources/seeds
- <high-signal post URL> (why it's good)
- <niche search engine / aggregator>
- <site to reverse-engineer>

## Current state
- <what's known as of YYYY-MM-DD, compact conclusions>

## Ranked candidates/leads
1. <lead> - <score/why> - <source> (<YYYY-MM-DD>)
2. ...

## Deprioritized
- <lead> - <why dropped> (<YYYY-MM-DD>)

## Next actions
1. <the very next bespoke step>
2. ...
3. ...

## Guardrails
- One focused step per run; no bulk enrichment.
- X API is pay-per-use: at most <k> requests per run.
- No ag cua per run; no posting, messaging, or purchases.
- Conclusions here, details in the dataroom.

## Stop condition
Stop at the first of: iteration <N>; <target count> qualified findings; <YYYY-MM-DD>.
```

## Setup sketch (codemode)

```js
const st = tools["mcp__t3-code__schedule_task"];
const created = await st({ title: "Heartbeat: <title>", prompt: draft,
  schedule: { type: "interval", everyMs: 180000 }, bindToCurrentThread: true });
// read the id from the result, then embed it:
await st({ scheduledTaskId: id, prompt: draft.replaceAll("<id>", id) });
```
