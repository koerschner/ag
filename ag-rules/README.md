# ag-rules

A personal UX layer on top of Ag: shortcuts and standing behaviors, each written as a rule in plain English
that boils down to code, so it runs the same way every time instead of depending on an agent remembering an
instruction.

**Where rules live.** Your rules are folders in **`~/.ag/ag-rules/`**, one per rule. ag also ships **default
rules** in `~/ag/ag-rules/` (the judgments Ag makes with Jev: when an archived chat is done, where an
inbox capture goes, what New item text is for, whether client computer use is allowed, whether a tab needs a new
name), so you can see exactly what Ag decides and how. To change or turn off a default, `ag-rules eject <name>`
copies it into `~/.ag/ag-rules/`, where it replaces the default; edit it there (`enabled: false` turns it off).
The search order is `AG_RULES_PATH` (colon-separated; default `~/ag/ag-rules:~/.ag/ag-rules`); a later
directory replaces same-named rules of an earlier one. This folder also holds the engine: `types.ts` (the
contract of every hook) and `engine.ts` (how TypeScript runtimes find and run rules). The user's `~/.ag/ag-rules`
comes from their dotfiles (stow package `ag`: `dotfiles/ag/dot-ag/ag-rules/`), so `ag-rules eject` copies into
that folder and stow links it into place.

```
~/.ag/ag-rules/
  square-brackets/
    rule.md       # front matter + the rule in plain English (the spec)
    rule.ts       # the code it names
  quick-entry/
    rule.md
    keys.json
```

```
---
description: one line
on: prompt | keys | hammerspoon | capture | new-item | answer | cua | tab-name   # the hook (below)
app: ag-dash                         # keys only: which app
code: rule.ts | keys.json | rule.lua # relative to the rule's folder
enabled: true
sessions: interactive                # prompt only: `all` also runs in headless Pi (routines, pi -p)
---
The rule, in plain English.
```

Ask an agent to add or change a rule: it edits `rule.md` and the code together (they must say the same thing),
commits and syncs (`ag sync dotfiles` for the user's). `ag-rules list | show <name> | keys <app> | path | eject <name>`;
ag-dash → profile menu → ag-rules. A rule's code never imports ag's files (rules live outside the repo): what it
may use comes in its `ag` argument (`types.ts`), e.g. `ag.jev(state, questions)`.

## Hooks

| on | runs | code | runtime |
|---|---|---|---|
| `prompt` | every prompt to a Pi session before the agent sees it: typed, ag-inbox (incl. the phone's Shortcuts), `ag send`/`ag spawn`, ag-tickler wake-ups | `.ts`, default export a `PromptRule` (`types.ts`): leave it, rewrite it, swallow it, spawn sessions, notify | Pi extension `pi/dot-pi/agent/extensions/ag-rules.ts` (rules load when a session starts) |
| `keys` `app: ag-dash` | ag-dash's keyboard shortcuts; its shortcuts sheet is generated from the labels | `.json` keymap (format in `ag-dash/web/src/lib/keys.ts`), naming actions the page defines (`ag-dash/web/src/ui/keyboard.ts`) | ag-dash serves `ag-rules keys ag-dash` at `/api/ag-rules/keys`; the page dispatches (it picks up changes on its next load) |
| `keys` `app: ag-dash-app` | the ag-dash Mac app: system-wide shortcuts, modifier-only chords (`lcmd+rcmd`), the quick entry box (`when: entry`) | `.json`; actions `toggle`, `quickEntry`, `quickEntryWithShot`; in the box `send`, `sendPin`, `close` | `macos-apps/ag-dash/app/hotkeys.js` (re-reads the rules when they change) |
| `keys` `app: ag-session` | Ag's session (tmux) shortcuts: ⌘ keys on a Mac, Ctrl+B chords everywhere | `.json` (`keys`, `prefix`, `tmux`) | Hammerspoon (`ag.lua`) maps ⌘ keys to chords; tmux binds them in `tmux/dot-config/ag/ag.tmux.conf`; `ag-shortcuts-check` verifies both |
| `hammerspoon` | Mac client behavior outside Ag's own apps (e.g. pasting into terminals) | `.lua` chunk, gets `agLib` (`focusedWindowIsAg`, `flagsMatch`, `isHost`), returns a table to keep alive | `hammerspoon/dot-hammerspoon/ag.lua` on (re)load (`ag sync` reloads it when a rule's `.lua` changes) |
| `capture` | each ag-inbox capture: is it new context for an open session? | `.ts` `CaptureRule` → follow / hint / new + the session (default `inbox-follow-on`) | `ag-inbox` (no rule: always a new session) |
| `new-item` | text in ag-dash's New item box: find a session, or new work? | `.ts` `NewItemRule` → find / new (default `new-item-intent`) | `ag-dash` `POST /api/new` (no rule: new) |
| `answer` | a chat archived while working answered: is it done? | `.ts` `AnswerRule` → done (default `ag-dash-judge-done`) | `ag-dash` (no rule: never done, so it comes back pinned) |
| `cua` | may an agent drive the client Mac's or phone's desktop? | `.ts` `CuaRule` → allow + reason (default `ag-client-cua-gate`) | `ag-client-cua-gate` (no rule: allowed; a rule that fails: blocked) |
| `tab-name` | after each prompt: does the tab's label still name the session? | `.ts` `TabNameRule` → keep (default `tab-name-fit`) | Pi extension `ag-tab-name.ts` (no rule: keep) |

**Adding a hook:** give the runtime a loader that asks `ag-rules list --json` (or `ag-rules keys <app>`; in
TypeScript, `engine.ts`'s `runRule(hook, input)`) for the enabled rules of that hook, so every runtime sees the
same rules; decide what happens when no rule answers; add the hook's type to `types.ts`; expose named actions rather than letting
rules reach into the app; add a row here and a line in `ag-rules --help`.

## What isn't an ag-rule (and why)

- **iOS Shortcuts** (`ios-shortcuts/`): they live in the Shortcuts app on the phone and can only be edited
  there; the files are recipes. What they send reaches the ag-inbox, so prompt rules apply to it.
- **General Mac and editor shortcuts** in dotfiles (window management, app launchers, instant Meet, Ctrl→Esc,
  Ghostty, nvim, zsh, personal tmux): machine config, not on top of Ag.
- **Judgment calls** ("when I mention a screenshot, pull it with `ag-shot`"): no deterministic test, so they stay
  instructions in `agents.md/`.
- **Claude Code and Codex sessions**: the prompt hook is Pi's; they don't run prompt rules.
