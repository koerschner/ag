---
description: Agents may drive my client Mac's (or phone's) desktop only when the thing exists only there
on: cua
code: rule.ts
enabled: true
---
Agents work on ag through APIs, CLIs, MCP tools, or computer use on ag-mac's own desktop. Driving the client
Mac I sit at (computer use there, or ssh + osascript/Hammerspoon UI automation) is allowed only when the thing
exists solely on the client: a dialog or permission prompt showing on its screen, iPhone Mirroring, a setting
or app of the client itself that the task is about, or my own screen as the deliverable (I asked to have
windows opened or arranged there). Never because an app or account is already signed in on the client: the fix
then is to get that access onto ag. Allow it only when that's judged likely (p ≥ 0.7); for an ssh command, only
judge it at all if it really drives the desktop (p ≥ 0.5). If the judgment fails, block (fail closed).

Code: Jev nouls "client-only?" (and, for ssh commands, "drives the desktop?") on the command, the agent's
justification and its session's goal. ag-client-cua-gate does the rest (approval tokens, the access session it
spins out on a block). Turning this rule off lets every client run through.
