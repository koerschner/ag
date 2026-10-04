// The sidebar's order: Pinned (newest pin first), then Chats (latest activity first).
//
// Rows never move under your pointer: while it's over the sidebar (or a chat's menu is open, a row is being renamed
// or dragged) the order is frozen; status dots and titles still update, chats that start meanwhile join at the end,
// and the list re-sorts the moment you leave. So a click always lands on the chat you aimed at.
import { create } from "zustand";
import type { Card } from "../lib/types";
import { useBoard, view } from "./board";

export const useOrder = create<{ frozen: string[] | null; hold: Set<string> }>(() => ({ frozen: null, hold: new Set() }));

export type Sections = { pinned: Card[]; rest: Card[] };
const memo = { sorted: null as Card[] | null, frozen: null as string[] | null, out: { pinned: [], rest: [] } as Sections };
export function sections(sorted: Card[], frozen: string[] | null): Sections {
	if (memo.sorted === sorted && memo.frozen === frozen) return memo.out;
	let pinned = sorted.filter((c) => c.pinned).sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0) || a.tab.localeCompare(b.tab, undefined, { numeric: true }));
	let rest = sorted.filter((c) => !c.pinned);
	if (frozen) {
		const at = new Map(frozen.map((t, i) => [t, i]));
		const by = (a: Card, b: Card) => (at.get(a.tab) ?? 1e9) - (at.get(b.tab) ?? 1e9);
		pinned = [...pinned].sort(by);
		rest = [...rest].sort(by);
	}
	const out = { pinned, rest };
	Object.assign(memo, { sorted, frozen, out });
	return out;
}
export const useSections = () => {
	const sorted = useBoard((s) => view(s).sorted);
	const frozen = useOrder((s) => s.frozen);
	return sections(sorted, frozen);
};
// The chats in the order the sidebar shows them (j/k, archive-and-next).
export function displayedOrder() {
	const { pinned, rest } = sections(view().sorted, useOrder.getState().frozen);
	return [...pinned, ...rest].map((c) => c.tab);
}

// Freeze for a reason ("pointer", "menu", "rename", "drag"); thaw when no reason is left.
export function hold(reason: string, on: boolean) {
	const { hold: h, frozen } = useOrder.getState();
	const next = new Set(h);
	if (on) next.add(reason);
	else next.delete(reason);
	if (next.size && !frozen) useOrder.setState({ hold: next, frozen: displayedOrder() });
	else if (!next.size && frozen) useOrder.setState({ hold: next, frozen: null });
	else useOrder.setState({ hold: next });
}
