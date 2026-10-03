---
name: pi-audit-reasoning
description: Audit where Pi agent time goes (model responses, shell, waiting/polling, MCP, subagents, failed requests, gaps) for one turn, one session, or the whole fleet of Pi sessions over a window, broken down by model and thinking level. Use for "audit this session", "where did the time go", "how much time is wasted", "which models/thinking levels should I use", or a weekly agent-efficiency review.
---

# Pi audit reasoning

Pi port of Patrick Skinner's `audit-reasoning` (github.com/PSkinnerTech/audit-reasoning, Codex-only). It keeps his accounting model: an **exclusive 0–100% distribution of active turn wall time**. Idle time between turns is excluded, overlaps between different categories go into their own bucket, and unclassified time is located between the events around it. It is a time distribution, **not an overthinking score**.

## Scope

| Ask | Command |
|---|---|
| last completed response (default) | `--scope last-completed` |
| this response so far (provisional) | `--scope current` |
| whole session | `--scope session` |
| a specific turn | `--list-turns`, then `--turn <user-message entry id>` |
| every Pi session over a window | `--scope fleet --since 7d` (also `24h`, `2w`, `2026-09-01`) |

A session defaults to `$PI_SESSION_FILE` (the calling session). Other sessions: `--session <path or unique id fragment>`. Never pick the newest file as a stand-in for "this session".

## Run

```bash
python3 ~/.agents/skills/pi-audit-reasoning/scripts/pi_audit_reasoning.py --scope fleet --since 7d
```

Standard library only; read-only. It writes a new directory under `~/.local/share/pi-audit-reasoning/` (or `--output DIR`) containing `report.md`, `report.html`, `audit.json`, `breakdown.csv`, `breakdown.svg` and `gap-intervals.csv`, and prints a JSON summary. Open `report.html` for the user with `show` and include the phone link it prints.

## Report

Summarize active time, scope, the category shares, the main gaps and the "Shell time by program" table. Fleet runs add **By model and thinking level** and **Longest sessions**. Keep recommendations proportional to the evidence:

- **Waiting (sleep / poll loops)** is bash time whose first real command is `sleep` or a `for`/`while`/`until` loop (usually CI polling). It is the most actionable number: an agent blocked in a poll loop could have been doing other work.
- A high **Model response** share does not by itself mean wasted thinking or show that a lower thinking level would help. The model-by-thinking comparison covers different tasks; it does not measure a speedup.
- Unclassified-time labels locate a gap (for example "Prompt → first model request" = extension hooks and input handling before the first request). They do not prove what caused it.

Read `references/measurement.md` for how each timestamp is derived and the known blind spots (parallel tool batches, no time-to-first-token, compaction starts). Reports contain metadata and timing only: never prompts, reasoning, message bodies or tool arguments. Shell commands are reduced to their program name plus a CLI subcommand such as `gh run`.
