# 2026-10-03: ag-engine out of memory, then rebooted mid-turn

Times are CDT (Sat Oct 3, 2026).

## What happened
- **4:20–4:23 PM**: ag-engine (32 GB, **no swap**) ran out of memory. Several sessions were type-checking at
  once: in the kernel's dump, 2× `tsgo` used 6.2 GB, `tsgolint` 2.5 GB, 15 `MainThread` (node/vite/vitest
  workers) 7.8 GB, and 25 Pi processes 5.5 GB. Timers slipped, so the machine was thrashing.
- **4:23:25 PM**: a global out-of-memory kill took `tsgo` (pid 435331), and memory recovered.
- **4:23:38 PM**: a Hetzner API `reboot_server` hit the engine (journal: "Power key pressed short"). Nothing in
  ag calls it, and no agent transcript on ag-engine, ag-mac or ag-client contains such a call, so it most
  likely came from the Hetzner console.
- After the reboot, ag-mux restored every tab, but Pi sessions came back asleep and nothing resumed the turns
  that were cut off. About 10 sessions sat looking done/idle ("stalled") until the user prompted them again.

## Fixes
- **Swap**: 16 GB `/swapfile`, `vm.swappiness=10` (bootstrap-linux), so spikes slow down instead of OOM.
- **Per-pane memory cap**: `systemd-user/…/tmux-spawn-.scope.d/ag-memory.conf` (MemoryHigh 10G, MemoryMax 14G).
  A runaway in one pane is throttled and killed inside that pane, not across the whole engine.
- **Interrupted turns resume**: when ag-mux restores the layout after the tmux server died, any Pi session whose
  transcript stops mid-turn (last message a prompt, tool result or running tool call, within the last 2 h)
  starts awake with a `kind="restart"` note telling it to check where it left off and continue.
- **ag-dash "engine down" page** asks people to wait a few minutes before rebooting from Hetzner.
- **ag-dash memory indicator** is labeled `engine mem`, turns amber/red under pressure, and shows details on hover.
