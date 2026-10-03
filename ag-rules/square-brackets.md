---
description: Text Nathan puts in [square brackets] becomes its own new session
on: prompt
code: square-brackets.ts
enabled: true
---
Whenever Nathan puts text in [square brackets] in a prompt, don't handle it inline: spin each bracketed note
out as a new Inbox session (`ag spawn`), with enough context to stand on its own, and carry on with the rest
of the prompt without it. Bracketed notes are often about the Ag system itself (the agent instructions, the
ag and dotfiles repos, how agents behave), so the new session is told that.

Not notes: markdown links and checkboxes, `code`, indexing like `arr[0]`, tags agents and tools add
(`[ag-parent: …]`, `[Image #1]`, `[Pasted text …]`), and prompts another agent wrote (they carry the
`[ag-parent: …]` footer). A prompt that is only a bracketed note is spun out and never reaches this session.
