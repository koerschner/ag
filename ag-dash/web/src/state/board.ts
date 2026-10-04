// The board: ag-dash's (the server's) copy, plus this page's optimistic changes on top ("ops").
//
// Coherence rule: the screen always shows server board ⊕ ops. An op is added the moment you act (pin, rename,
// mark waiting, archive…), so the change shows at once; the request then answers with the board revision that
// includes it, and the op is dropped once a board at least that new has arrived. So a change never flickers
// back (an older board arriving after you acted can't undo it on screen) and never sticks if it failed (the op is
// dropped and a toast says why).
import { create } from "zustand";
import { lastAt } from "../lib/format";
import type { Board, Card, Waiting } from "../lib/types";

export type Patch = { pinned?: boolean; pinnedAt?: number; title?: string; needsYou?: boolean; hidden?: boolean; waiting?: boolean };
export type Op = { id: string; tab: string; patch: Patch; at: number; rev?: number; boot?: string };

type BoardState = {
	board: Board | null;
	fresh: boolean; // a board from ag-dash itself has arrived (not only this device's saved copy)
	ops: Op[];
};
export const useBoard = create<BoardState>(() => ({ board: null, fresh: false, ops: [] }));

const OP_TTL = 30_000; // an op whose request never answered stops covering the server's state after this

export function applyBoard(b: Board, delta: boolean, cached = false) {
	const { board: prev, ops } = useBoard.getState();
	if (delta && prev) {
		const old = new Map(prev.cards.map((c) => [c.tab, c]));
		b = { ...b, cards: b.cards.map((c) => ((c as any).same ? old.get(c.tab) : c)).filter(Boolean) as Card[] };
	}
	// Keep the card objects that didn't change, so rows that didn't change don't redraw.
	if (prev && !delta) {
		const old = new Map(prev.cards.map((c) => [c.tab, c]));
		const same = (a: Card, x?: Card) => !!x && JSON.stringify(a) === JSON.stringify(x);
		b = { ...b, cards: b.cards.map((c) => (same(c, old.get(c.tab)) ? old.get(c.tab)! : c)) };
	}
	useBoard.setState({ board: b, fresh: useBoard.getState().fresh || !cached, ops: cached ? ops : prune(ops, b) });
}

function prune(ops: Op[], b: Board) {
	const now = Date.now();
	const tabs = new Set(b.cards.map((c) => c.tab));
	const next = ops.filter((o) => {
		// Acked: until a board newer than the answer's (the answer's rev normally includes the change; if that poll failed
		// it doesn't, so wait one more), and never longer than OP_TTL.
		// A board from another server run (the stream hasn't reconnected since a restart) can't tell, so it holds too.
		if (o.rev !== undefined) return (o.boot !== b.boot || b.rev <= o.rev) && now - o.at < OP_TTL;
		if (o.patch.hidden) return tabs.has(o.tab) || now - o.at < OP_TTL; // archived, close not sent yet (Undo window)
		return now - o.at < OP_TTL;
	});
	return next.length === ops.length ? ops : next;
}

export function addOp(tab: string, patch: Patch): Op {
	const op: Op = { id: crypto.randomUUID?.() ?? String(Math.random()), tab, patch, at: Date.now() };
	useBoard.setState((s) => ({ ops: [...s.ops, op] }));
	return op;
}
// rev and boot come from the answer: the server run that applied the change (it may have restarted since the
// board on screen arrived).
export function ackOp(op: Op, rev?: number, boot?: string) {
	const b = useBoard.getState().board;
	useBoard.setState((s) => ({ ops: prune(s.ops.map((o) => (o.id === op.id ? { ...o, rev: rev ?? b?.rev ?? 0, boot: boot ?? b?.boot } : o)), s.board ?? { cards: [], rev: 0, boot: "", page: 0 }) }));
}
export function dropOp(op: Op) {
	useBoard.setState((s) => ({ ops: s.ops.filter((o) => o.id !== op.id) }));
}
// Pruning also runs on a timer, so an op whose answer was lost stops covering the board even when nothing changes.
setInterval(() => {
	const { board, ops } = useBoard.getState();
	if (board && ops.length) {
		const next = prune(ops, board);
		if (next !== ops) useBoard.setState({ ops: next });
	}
}, 5000);

// ---------- the view: server ⊕ ops ----------
const MANUAL_WAIT: Waiting = { title: "Marked waiting", kind: "manual", detail: "asked the session to schedule its wake-up" };
const patched = new WeakMap<Card, { key: string; out: Card }>();
function patch(c: Card, p: Patch): Card {
	const key = JSON.stringify(p);
	const hit = patched.get(c);
	if (hit?.key === key) return hit.out;
	const out: Card = { ...c };
	if (p.pinned !== undefined) ((out.pinned = p.pinned), (out.pinnedAt = p.pinned ? (p.pinnedAt ?? c.pinnedAt) : undefined));
	if (p.title !== undefined) out.title = p.title;
	if (p.needsYou !== undefined) out.needsYou = p.needsYou;
	if (p.waiting !== undefined) out.waiting = p.waiting ? (c.waiting?.length ? c.waiting : [MANUAL_WAIT]) : [];
	patched.set(c, { key, out });
	return out;
}

export type View = { cards: Card[]; byTab: Map<string, Card>; bySid: Map<string, Card>; sorted: Card[] };
const EMPTY: View = { cards: [], byTab: new Map(), bySid: new Map(), sorted: [] };
let memo: { board: Board | null; ops: Op[]; view: View } = { board: null, ops: [], view: EMPTY };
export function view(s: BoardState = useBoard.getState()): View {
	if (memo.board === s.board && memo.ops === s.ops) return memo.view;
	const byOp = new Map<string, Patch>();
	for (const o of s.ops) byOp.set(o.tab, { ...byOp.get(o.tab), ...o.patch });
	const cards: Card[] = [];
	for (const c of s.board?.cards ?? []) {
		const p = byOp.get(c.tab);
		if (p?.hidden) continue;
		cards.push(p ? patch(c, p) : c);
	}
	const v: View = {
		cards,
		byTab: new Map(cards.map((c) => [c.tab, c])),
		bySid: new Map(cards.filter((c) => c.sid).map((c) => [c.sid!, c])),
		sorted: [...cards].sort((a, b) => lastAt(b) - lastAt(a)),
	};
	memo = { board: s.board, ops: s.ops, view: v };
	return v;
}
export const useView = () => useBoard(view);
export const useCard = (tab?: string | null) => useBoard((s) => (tab ? view(s).byTab.get(tab) : undefined));
export const cardByTab = (tab: string) => view().byTab.get(tab);
