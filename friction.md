# Friction log

Times Nathan had to step in for something Ag should handle by itself. Each
entry is fixed at the root by the `fix-friction` skill (run `/fix-friction` or
say "friction"). An entry that comes back means its fix didn't hold.

## "bun would like to access data from other apps" blocks op-*
- Seen: 2026-09-28, 2026-09-29 (Cloud VM Setup)
- Class: bad default
- Cause: `op` (and the wrapper's probe) opened 1Password's Group Container at startup, raising a macOS privacy prompt credited to bun that blocked every op-ag/op-work/op-shared call and wasn't remembered when denied.
- Fix: the wrappers run `op` with a private `HOME`, so nothing touches the Group Container (f81b69d).
- Check: `op-ag vault list` succeeds, and `log show --last 5m --predicate 'subsystem == "com.apple.TCC"' | grep -c AppData` prints 0.

## Email verification codes need Nathan
- Seen: 2026-09-28 (Cloud VM Setup: Hetzner signup; Tailscale purchase)
- Class: missing credential or access
- Cause: Chrome on ag was signed out of Google, so no agent could read Gmail.
- Fix: in progress (Inbox › Get Missing Access: sign Google back in on ag).
- Check: none yet.

## Ramp card not readable by agents
- Seen: 2026-09-28 (Cloud VM Setup)
- Class: missing credential or access
- Cause: the card lived only in accounts ag can't read.
- Fix: Nathan moved it into the Trilogy `ag-vault` vault, read with `op-work`.
- Check: `op-work item list --vault ag-vault | grep -i ramp`.

## macOS permission prompts block agents (screen capture, Automation, re-consent)
- Seen: 2026-09-29 (Roblox testing: screen recording on ag-mac)
- Class: missing knowledge + missing tool
- Cause: agents granted Screen Recording to the multiplexer binary and to ffmpeg's Cellar path and ran ffmpeg through `launchctl submit`, but every agent command on ag-mac is attributed to `/usr/libexec/sshd-keygen-wrapper` (agent shells start over SSH), so those grants never applied or broke on upgrade. TCC prompts and the monthly macOS 15+ "bypass the private window picker" alert live in UserNotificationCenter, which CUA refuses to click, so Nathan had to click by hand.
- Fix: grant everything to sshd-keygen-wrapper (stable, Apple-signed); `ag-access` checks grants and `ag-access allow` answers agent prompts through Accessibility; `ag-screen-approvals` pushes replayd's re-consent dates to 2100; docs/reference.md "macOS permissions for agents", ag-machine-ops skill.
- Check: `ag-access` exits 0, and `screencapture -x /tmp/t.png` works from any agent shell on ag-mac (`mac run`).
