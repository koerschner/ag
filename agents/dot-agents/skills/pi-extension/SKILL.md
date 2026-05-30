---
name: pi-extension
description: Build or modify a Pi extension. Use this whenever the user wants a custom slash command, extension tool, lifecycle hook, context filtering, session persistence, UI prompt, model/provider integration, or anything placed in ~/.pi/agent/extensions/. This skill is especially relevant when the user says “create a pi extension”, mentions /reload, wants custom command behavior, or needs extension code that uses Pi APIs rather than app code.
argument-hint: "[extension idea, command name, or behavior]"
---

Build a Pi extension for: $ARGUMENTS

## Goal

Implement the extension itself, not just a vague plan. Default to a working minimal extension and add complexity only when the request truly needs it.

This skill is tailored for Nat's setup and should assume:
- **global extension placement** by default
- extensions live in `~/.pi/agent/extensions/`
- the user can test with `/reload`

## Default behavior

1. **Clarify missing requirements first.**
   - Ask short, targeted questions when behavior is ambiguous.
   - Prefer 2-5 precise questions over a long interview.
   - If a question can be deferred without risking rework, make a sensible default and say so.
   - If AskUserQuestionTool is available, use it. Otherwise ask inline.

2. **Choose the simplest viable extension shape.**
   - Use a **single `.ts` file** for small commands, hooks, or tools.
   - Use a **directory with `index.ts`** only when the extension has helper modules, assets, or npm dependencies.
   - Add `package.json` only when dependencies are actually needed.

3. **Place the extension globally unless the user explicitly asks otherwise.**
   - Preferred path: `~/.pi/agent/extensions/<name>.ts`
   - If multi-file: `~/.pi/agent/extensions/<name>/index.ts`

4. **Implement, then explain how to test it.**
   - Show the exact file path created or changed.
   - Tell the user to run `/reload` in Pi.
   - Give 1-3 concrete test commands or interactions.

## How to decide the implementation pattern

Choose the mechanism that best matches the request:

- **Custom slash command** → `pi.registerCommand()`
- **LLM-callable capability** → `pi.registerTool()`
- **Intercept or rewrite typed user input** → `pi.on("input", ...)`
- **Change what the LLM sees each turn** → `pi.on("context", ...)`
- **Inject extra instructions for a turn** → `pi.on("before_agent_start", ...)`
- **React to tool use** → `pi.on("tool_call")`, `pi.on("tool_result")`, or execution lifecycle events
- **Persist extension-only state** → `pi.appendEntry()` or custom session entries that do not participate in LLM context
- **Prompt the user interactively** → `ctx.ui.confirm`, `ctx.ui.input`, `ctx.ui.select`, or custom UI only if necessary
- **Need a one-off model/provider call from the extension** → read the relevant Pi provider docs before coding

When several approaches could work, prefer the one that is:
1. easiest to reason about,
2. least invasive to normal agent flow,
3. easiest to reload and test.

## Required implementation style

- Keep the extension **minimal and pragmatic**.
- Avoid custom UI, renderers, or extra abstraction unless the request clearly benefits from them.
- Reuse Pi's current model, thinking level, session, and command system instead of inventing parallel mechanisms.
- Do not introduce background daemons, external services, or extra files unless required.
- Keep comments focused on the non-obvious parts.

## Pi-specific guidance

### File placement

Default to global extension paths:
- `~/.pi/agent/extensions/<name>.ts`
- `~/.pi/agent/extensions/<name>/index.ts`

For quick experiments, Pi can also run `pi -e ./path.ts`, but for the user's normal workflow prefer the global extension path so `/reload` works naturally.

### Common extension skeleton

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Example command",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}`, "info");
    },
  });
}
```

### Persistence rule

If the user wants something to be **saved** but **not automatically sent back to the main agent in later turns**, do **not** store it as a normal user/assistant message that remains in context by default.

Prefer one of these:
- `pi.appendEntry()` for extension-owned state
- a custom message or entry plus a `context` handler that filters it out from future LLM calls

Be explicit about which data is:
- persisted to the session,
- displayed to the user,
- included in future model context,
- excluded from future model context.

### Commands vs tools

- If the user literally wants `/something`, implement a **command** first.
- Add a tool only when the LLM itself needs to call that capability later.
- Do not turn every command into a tool.

### Model-aware behavior

If the extension should use the active Pi model or thinking level, prefer Pi APIs for the current runtime state rather than hardcoding a provider/model.

If the task requires a direct provider-level LLM call, verify the exact API shape in docs before writing code.

## When to read Pi docs before implementing

You do **not** need to re-read docs for basic command/tool/event work that is already well-covered here.

Read the docs when the request depends on less-common or easy-to-misremember APIs, especially:
- direct model/provider calls or `streamSimple`
- custom providers
- custom TUI rendering or components
- session storage / context / tree / compaction details
- dynamic tools or provider registration

Relevant docs:
- `~/.local/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `~/.local/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- `~/.local/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
- `~/.local/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`

Relevant examples:
- `.../examples/extensions/send-user-message.ts`
- `.../examples/extensions/input-transform.ts`
- `.../examples/extensions/dynamic-tools.ts`
- `.../examples/extensions/custom-provider-*/`
- `.../examples/extensions/README.md`

## Workflow

### 1. Understand the request

Extract the essentials:
- what triggers the behavior,
- whether it is a command, tool, hook, or UI flow,
- what should persist,
- what should remain visible only,
- whether future agent turns should know about it.

If the request mentions a command, identify:
- command name,
- args format,
- idle vs streaming behavior,
- visible output behavior.

### 2. Choose the lightest architecture

Before coding, briefly decide:
- single file or directory,
- command/tool/event combination,
- whether persistence is needed,
- whether docs need to be read for API accuracy.

### 3. Implement directly

Create or edit the extension files.

Favor code that is:
- easy to reload,
- obvious to debug,
- consistent with Pi examples,
- safe under repeated `/reload` cycles.

### 4. Sanity-check the behavior

Mentally check:
- command names match the requested slash command,
- state survives or does not survive exactly as intended,
- hidden state is not accidentally included in later context,
- there is no unnecessary dependency or ceremony.

### 5. Hand off clearly

Always end with:
- exact file paths changed,
- a 1-2 sentence summary of what the extension does,
- a reminder to run `/reload`,
- a short test recipe.

## Response format

Use this structure when delivering the work:

```text
Built:
- ~/.pi/agent/extensions/<path>

What it does:
- ...

How to test:
1. Run /reload in Pi
2. ...
3. ...

Notes:
- Mention any assumptions or follow-up questions
```

## Good defaults

- Prefer global extension placement.
- Prefer one file.
- Prefer commands over tools when the request is explicitly slash-command driven.
- Prefer persisted custom state over polluting the conversation.
- Prefer asking one good clarifying question instead of shipping the wrong behavior.
- Prefer `/reload` instructions over elaborate test harnesses unless the user asks for them.
