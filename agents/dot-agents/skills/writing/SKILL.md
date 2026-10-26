---
name: writing
description: Write or rewrite any prose other people will read - UI and product copy, error and empty-state text, emails, Slack/Discord/Linear/GitHub messages and comments, PR and issue bodies, release notes, docs and READMEs, commit message bodies others read. The wording comes from Gemini through TrueFoundry via the ag write CLI, not from your own model. Use before drafting, and again whenever you change the voice or the facts of text that is about to be published.
---

# Writing prose people will read (`ag write`)

The words other people read come from Gemini through TrueFoundry, not from your own model. You gather the facts, brief Gemini with `ag write` (`ag-write`; default model `gemini-4-argon`, override with `--model` or `$AG_WRITE_MODEL`), check what comes back, and publish it.

## Covered and not covered

- **Covered:** UI and product copy, error and empty-state text, emails, Slack/Discord/Linear/GitHub messages and comments, PR and issue bodies, release notes, docs and READMEs, commit message bodies others read. Drafts in the user's voice too.
- **Not covered:** code, identifiers, commands, logs, data, and your own conversational replies to the user in chat. Short structured strings that are really data (labels copied from a spec, branch names) don't need it either.

## The loop

1. **Gather the facts yourself.** Gemini only knows what you give it: every fact, link (full URLs), identifier, template, and the old copy if you're replacing text.
2. **Write:** put them in files and brief Gemini:

   ```sh
   ag write -k "PR description" -c /tmp/brief.md -c /tmp/template.md "<what it's for, who reads it, tone, length>"
   ```

   `-k` names the kind of text, `-c` adds a context file (repeatable), `-n 3` returns variants separated by a `-----` line, `-o` writes to a file.
3. **Rewrite** an existing draft plainly, keeping every fact:

   ```sh
   ag write --rewrite -k "issue" < draft.md
   ```

   When a skill hands a draft to a fresh subagent for a plain rewrite (e.g. `arcade-plain-rewrite`), run `ag write --rewrite -k "<kind>" --instruction "<the skill's instruction, filled in>"` as that subagent.
4. **Check it against the facts.** Put back anything wrong or dropped (facts, links, identifiers, template headings). Keep these edits minimal so the voice stays Gemini's.
5. **Publish** with the AI attribution line on top (`ag write` never adds it), naming the session's own model, since your session publishes it. Read back what was posted.

## When the text changes after Gemini wrote it

Small fixes (a wrong number, a missing link) are yours to make. Anything bigger goes back through `ag write`, for example:

- **A change of voice.** Attributed text speaks as the assistant, not the user, so a draft written in the user's voice ("I switched…") has to be restated in the assistant's voice before it's published with the attribution line. Run `ag write --rewrite -k "<kind>" --instruction "Restate this in the voice of an AI assistant writing on <user>'s behalf; keep every fact" < draft.md`.
- **New or changed facts** (the situation moved on since the draft: a step got done, a decision changed). Update the brief and run it again, or rewrite the draft with the new facts as a `-c` file.
- **Merging drafts** or restructuring sections.

## If it fails

If `ag write` fails (gateway down, auth), write the text yourself and say so in your reply to the user.
