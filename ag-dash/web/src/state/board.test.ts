import { beforeEach, expect, test } from "bun:test";
import type { Board, Card } from "../lib/types";
import { ackOp, addOp, applyBoard, dropOp, useBoard, view } from "./board";

const card = (tab: string, extra: Partial<Card> = {}): Card => ({ tab, pane: tab, title: tab, status: "idle", statusSince: 1, pinned: false, needsYou: false, inbox: false, resolved: false, throb: false, ping: false, waiting: [], focused: false, tools: [], media: [], stats: { cost: 0, ctx: 0, turns: 0, tools: 0 }, ...extra });
const board = (rev: number, cards: Card[], boot = "b1"): Board => ({ cards, rev, boot, page: 1 });

beforeEach(() => useBoard.setState({ board: null, fresh: false, ops: [] }));

test("an op shows at once and holds until a board that includes it", () => {
	applyBoard(board(1, [card("a")]), false);
	const op = addOp("a", { pinned: true, pinnedAt: 5 });
	expect(view().byTab.get("a")?.pinned).toBe(true);
	ackOp(op, 3);
	applyBoard(board(2, [card("a")]), false); // older than the change: the op still covers it (no flicker back)
	expect(view().byTab.get("a")?.pinned).toBe(true);
	applyBoard(board(4, [card("a", { pinned: true, pinnedAt: 5 })]), false);
	expect(useBoard.getState().ops).toHaveLength(0);
	expect(view().byTab.get("a")?.pinned).toBe(true);
});

test("a failed op is dropped and the server's state shows again", () => {
	applyBoard(board(1, [card("a")]), false);
	const op = addOp("a", { title: "new" });
	expect(view().byTab.get("a")?.title).toBe("new");
	dropOp(op);
	expect(view().byTab.get("a")?.title).toBe("a");
});

test("archive hides at once; an answer from a restarted server holds until that run's newer board", () => {
	applyBoard(board(500, [card("a"), card("b")]), false);
	const op = addOp("a", { hidden: true });
	expect(view().cards.map((c) => c.tab)).toEqual(["b"]);
	ackOp(op, 3, "b2"); // the new run answered; the board on screen is still the old run's
	applyBoard(board(501, [card("a"), card("b")]), false);
	expect(view().cards.map((c) => c.tab)).toEqual(["b"]);
	applyBoard(board(4, [card("b")], "b2"), false);
	expect(useBoard.getState().ops).toHaveLength(0);
});

test("deltas reuse unchanged cards (same objects), and views are memoized", () => {
	applyBoard(board(1, [card("a"), card("b")]), false);
	const a1 = view().byTab.get("a");
	applyBoard({ ...board(2, [{ tab: "a", same: 1 } as any, card("b", { status: "working" })]) }, true);
	expect(view().byTab.get("a")).toBe(a1);
	expect(view().byTab.get("b")?.status).toBe("working");
	expect(view()).toBe(view());
});

test("a cached board doesn't count as fresh", () => {
	applyBoard(board(1, [card("a")]), false, true);
	expect(useBoard.getState().fresh).toBe(false);
	applyBoard(board(2, [card("a")]), false);
	expect(useBoard.getState().fresh).toBe(true);
});
