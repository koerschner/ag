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
