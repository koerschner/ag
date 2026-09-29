---
name: fix-friction
description: Nathan hit friction that Ag should have handled on its own (an agent asked him for a code, a login, a card, a fact, a click; a prompt or guard got in the way). Use when he runs /fix-friction or says "friction" / "ooh, friction", and in the Fix Friction session that spins out of it. Fixes the root cause at the core of Ag instead of just the one task, and logs it.
---

# Fix friction

"Friction" from Nathan means he had to step in for something Ag should handle
itself. The goal is to make that friction impossible next time for every agent
on every machine, not to get past it once.

There are two roles. Work out which one you are:

- **You're in the session where it happened** (Nathan just said "friction" or
  ran `/fix-friction`): do **Spin out** below, then keep doing your task. If the
  friction is blocking you right now and the quick way past it is safe (for
  example, reading the code from his email yourself), do that too.
- **Your prompt starts with "Fix friction:"**: you're the fixer. Do **Fix**.

## Spin out (the session where it happened)

1. Work out what the friction was from the conversation and Nathan's words: what
   you (or another agent) needed, what you asked him for or what stopped you,
   and what he had to do. If it's genuinely unclear, ask him one short question.
2. POST a self-contained brief to the ag inbox as a new session:

   ```bash
   curl -sS -H 'content-type: text/plain' --data-binary @/tmp/friction-brief.md 'http://ag:7373/prompt?new=1'
   ```

   The brief starts with `Fix friction: <one-line summary>`, then includes:
   Nathan's exact words, what happened (with commands, errors and dialog text
   quoted), what was tried, the machine it happened on, your session file
   (`$PI_SESSION_FILE`) so the fixer can read the transcript, and an instruction
   to report back to your session when done (see "Split out" in AGENTS.md for
   finding your pane).
3. Tell Nathan in one line that the fixer is on it, with its link
   (`herdr-link --grep 'Fix Friction|Friction'`, or the ag inbox response).
   Then carry on.

## Fix (the Fix Friction session)

1. **Read the originating transcript** if the brief isn't enough.
2. **Find the root cause and classify it**, one of:
   - missing credential or access (a vault item, login, token, account on ag)
   - missing tool or capability (no CLI/API/script for something agents need)
   - missing knowledge (a fact about Nathan or the setup that should be in AGENTS.md or a skill)
   - bad default or broken tool (something works but in a way that makes agents stop)
   - guard false positive (a safety check blocked something it should allow)
   - external (outside Ag's control; say so, then reduce the damage)
3. **Fix it at the most central layer**, preferring in this order:
   access and credentials on ag and the engine machines (vaults, logins, tokens)
   → an ag (or dotfiles) tool or config fix → an AGENTS.md rule or profile fact
   (`agents.md/sections/`) → a skill. Change the thing that caused it, not the
   one task. Keep fixes small; don't build a framework. Follow the machine-setup
   rules (`dotfiles-change` skill): commit, push, and sync every machine.
4. **If the fix needs Nathan** (a login, a grant, a secret, a decision on a broad
   permission), ask him clearly and kindly, once, explaining why, and wait with a
   `needsNathan: true` tickler `check` so you resume when he's done. Ask before
   granting anything broader than the friction needs.
5. **Verify** it's fixed: reproduce what failed and show it now works without
   Nathan.
6. **Log it** in `~/ag/friction.md` (committed with the fix).
   If the same friction is already there, add the date to that entry and
   rethink the fix, since it didn't hold. Entry format:

   ```markdown
   ## <short title>
   - Seen: 2026-09-29 (Cloud VM Setup)
   - Class: bad default
   - Cause: <one or two sentences>
   - Fix: <what changed, commit hash>
   - Check: <a command that proves it's still fixed, if there is one>
   ```

7. **Report back** to the originating session (per "Split out" in AGENTS.md)
   with the cause and fix in two or three sentences, tell Nathan the same, and
   end with `DONE`.

## Before asking Nathan anything (every agent, always)

Friction usually starts with an unnecessary question. Before asking Nathan for
something, try: the vaults (`op-ag`, `op-work`, `op-shared`), the "About
Nathan" profile and the rest of AGENTS.md, his email on ag (Chrome signed in to
his Gmail), past sessions (`rg` in `~/.pi/agent/sessions`), and the relevant
skills. Ask only if those come up empty, and say what you checked.
