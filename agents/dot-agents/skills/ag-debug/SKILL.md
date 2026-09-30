---
name: ag-debug
description: Nathan says "ag debug" (or runs /ag-debug) - something in Ag itself is broken or misbehaving (a tool, service, script, skill, rule, machine, or how an agent acted). Extract the meta issue from the conversation and spin out a new Ag Debug session that root-causes and fixes it, then reports back. Also use in that spun-out session (prompt starts "Ag debug:").
---

# Ag debug

"ag debug" from Nathan means: there's a problem with Ag itself, not with the
task at hand. Maybe a tool failed, a service is down, a link opened the wrong
thing, a skill or rule led an agent astray, or an agent behaved badly. The
issue to debug is the **meta issue** (what in Ag caused this), not the task.

(Related: "friction" = Nathan had to step in for something Ag should have done
itself; that's the `fix-friction` skill. If it's clearly friction, use that.)

Two roles. Work out which one you are:

- **You're in the session where it happened** (Nathan said "ag debug" or ran
  `/ag-debug`): do **Spin out**, then carry on with your task.
- **Your prompt starts with "Ag debug:"**: you're the debugger. Do **Debug**.

## Spin out (the session where it happened)

1. Extract the meta issue from Nathan's words and the conversation: what Ag
   component misbehaved (tool, command, service, machine, skill, AGENTS.md rule,
   agent behavior), what was expected, what happened instead. Nathan's words
   after "ag debug" are the main hint. If it's genuinely unclear, ask one short
   question; otherwise don't.
2. Write a self-contained brief and POST it to the ag inbox as a new session:

   ```bash
   curl -sS -H 'content-type: text/plain' --data-binary @/tmp/ag-debug-brief.md 'http://ag:7373/prompt?new=1'
   ```

   The brief starts with `Ag debug: <one-line meta issue>`, then includes:
   Nathan's exact words; what happened, with commands, errors, and output quoted
   verbatim; what was already tried; the machine (`hostname`) and cwd; your
   session file (`$PI_SESSION_FILE`) so the debugger can read the transcript;
   and an instruction to load the `ag-debug` skill and report back to your
   session when done or blocked.
3. Tell Nathan in one line what meta issue you extracted and link the new
   session (the inbox response's `tab` → `herdr-link <tab>`). Then carry on
   with the original task, working around the issue if it's safe.

## Debug (the Ag Debug session)

1. **Read the originating transcript** (the session file in the brief) if the
   brief isn't enough.
2. **Reproduce** the problem. Check the obvious layers: the tool's own logs
   (`journalctl --user -u <unit>`, `~/Library/Logs` on the Macs via `mac run`),
   service status, recent commits in `~/ag` and dotfiles (`git log -p`), and
   whether each machine is synced.
3. **Find the root cause** and fix it at the most central layer (ag or dotfiles
   code/config, then an AGENTS.md rule in `agents.md/sections/`, then a skill).
   Follow the `dotfiles-change` skill: commit, push, and sync every machine.
   Keep the fix small and scoped to the issue.
4. **If the fix needs Nathan** (a login, a grant, a decision), ask once, clearly
   and kindly, and wait with a `needsNathan: true` tickler `check`.
5. **Verify** on the real path that it's fixed.
6. **Report back** to the originating session (see "Split out" in AGENTS.md for
   finding its pane by session file): cause and fix in two or three sentences,
   with the commit. Tell Nathan the same, then end with `DONE`.
