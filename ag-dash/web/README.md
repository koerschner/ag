# ag-dash's page

The app at `http://ag:7376/chat` (desktop, the iPhone home screen, and the Mac app in `macos-apps/ag-dash`):
React 19 + TypeScript, the React Compiler, Zustand, TanStack Virtual. The server is `bin/dot-local/bin/ag-dash`;
it serves `dist/`, which is **committed**, so no machine needs a build step. After changing `src/`, run
`bun run build` and commit `dist/` with it. Open pages reload onto a new build by themselves once nothing is
being typed or tapped.

```sh
cd ag-dash/web && bun install
bun run check          # types, unit tests, build
bun run dev            # hot reload on :7390, API proxied to AG_DASH_API (default the real ag-dash)
node tests/e2e.mjs     # end to end on a passive test instance (see the file); mobile: the mobile-review skill
```

To try a branch against live sessions without touching the real ag-dash, run a passive instance of the branch's
server: `AG_DASH_PORT=7386 AG_DASH_PASSIVE=1 AG_DASH_STATE_DIR=/tmp/agdash-test bun bin/dot-local/bin/ag-dash`
(it never pings, nudges or closes anything on its own; your clicks still act on the real sessions).

## How it stays coherent

- **One view of the board:** the server's board plus this page's pending changes (`state/board.ts`). An action
  shows at once, its request answers with the board revision (`rev`) that includes it, and the change holds until
  a board at least that new arrives. It never flickers back, and a failure undoes it with a toast.
- **Nothing moves under the pointer:** the sidebar and lists freeze their order while the pointer is over them
  (or a menu, rename or drag is open) and re-sort when it leaves (`state/order.ts`).
- **Scrolling never jumps:** a chat loads whole, and after that only its end changes (refreshes fetch from the last
  turn on), media reserve their height, so nothing above what you're reading ever moves. The browser owns the scroll
  position; the page only follows the bottom, and stops the moment you scroll up (`ui/useScroll.ts`, `state/tx.ts`).
  Don't reintroduce paging older history in above the reader, or JS that corrects scrollTop while you scroll.
- **Transcripts redraw only what changed:** items carry the server's stable keys; a refresh keeps every unchanged
  item object, so React skips unchanged turns (`state/tx.ts`, `ui/Thread.tsx`). Unchanged refreshes are a 304.
- **Never stuck:** the board and recent transcripts are kept on the device (IndexedDB) and painted at once; what
  you send waits in an outbox until ag-dash confirms it; the event stream reconnects and catches up.
