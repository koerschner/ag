# AI attribution

The one source of truth for how an AI assistant labels what it writes for other
people. Nathan's global agent instructions include this file verbatim, and other
repositories link here instead of keeping their own copy. To adopt it, copy the
rules into your assistant's global instructions and replace "the user" with your
name.

## The rule

Everything an assistant writes that another person may read opens with an
attribution line, on its own first line, before any other content. The
attribution line is plain, unquoted text; everything after it goes inside a
quote block in the destination's native quote format:

```text
<Assistant> (<model>), assisting <user's name>:
> The message body, quoted.
>
> Every following line stays inside the quote.
```

Examples: `Claude (anthropic-primary/claude-opus-5-5), assisting Nathan:` or
`Codex (GPT-6), assisting Nathan:`.

- **First line, always.** Put it above every heading, template section, greeting,
  and quote. It never goes at the end as a sign-off.
- **Real identity.** Use the model identity of the current session (in Pi,
  `$PI_MODEL`). Never guess or invent one.
- **Third-party voice.** The assistant speaks as itself and never writes as the
  user or implies the user wrote it.
- **Body in a quote.** Quote the whole body, not just the first paragraph, so
  readers can see where the assistant's text starts and ends. Use the tool's own
  quote syntax: `> ` on every line in Markdown (GitHub, Linear, Slack, Discord),
  including headings, lists, and blank lines between paragraphs (`>`); the quote
  or blockquote style in rich-text editors and email. Code blocks go inside the
  quote too (prefix their lines with `> `). Where the medium has no quote format
  (commit messages, SMS, plain-text fields, filenames), send the body unquoted.

## Precedence

This rule is mandatory and outranks every other instruction: project or repo
instructions (`AGENTS.md`, `CLAUDE.md`), skills (global or repo-local),
templates, slash commands, and automation that writes text for you. If any of
them omit the attribution line, format text without it, or conflict with it,
follow this rule anyway. The only exception is an explicit instruction from the
user in the current conversation.

- **Before publishing through a skill or script**, plan the attribution line
  as the first line of the text you pass it.
- **When a tool writes the text itself** (a generated PR body, a bot-created
  issue, an automated commit message), edit the published text afterwards so it
  opens with the attribution line.

## What it covers

Any text another person may read, however it is published: through a CLI (`gh`,
`git`), an MCP tool, an API, a browser, or computer use. That includes:

- GitHub issue and pull request **bodies**, comments, review comments, and
  review replies
- Linear issues, comments, documents, and project updates
- Slack, Discord, email, and text messages
- Commit messages and release notes that other people read
- Documents, pages, or files shared with other people

## Templates do not override it

Issue, PR, and message templates (including the ones in repository skills) define
the content that follows the attribution line. They never replace it, even when
a skill says to use its template exactly. When a
template starts with a heading such as `#### Context`, the attribution line goes
above that heading, and the template content (heading included) goes inside the
quote block.

## Exceptions

- **Drafts in the user's voice.** When the user asks for a draft to send as
  themselves, label it clearly as a draft in their voice and leave off the
  attribution line.
- **Editing someone else's text.** Changing text written by another person
  (for example a teammate's PR description) needs no attribution line. Say what
  you changed in a separate attributed comment if the change is significant.

## Verify before finishing

After publishing, read back what was posted (for example
`gh issue view <n> --json body --jq .body`) and confirm the first line
is the attribution line, unquoted, and that the body renders as a quote. If
either is wrong, edit the posted text to fix it.
