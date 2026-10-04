import { expect, test } from "bun:test";
import { buildTurns, exploreCounts, groupSteps, stepKind, stepsDetail } from "./turns";
import type { TxItem } from "./types";

const u = (k: string, text: string, ts = 1): TxItem => ({ k, role: "user", ts, text });
const a = (k: string, text: string, ts = 2): TxItem => ({ k, role: "assistant", ts, text });
const tool = (k: string, name: string, extra: object = {}, ts = 2): TxItem => ({ k, role: "tool", ts, name, detail: "", ...extra }) as TxItem;

test("a finished turn: work folds into steps, the last text is the answer", () => {
	const t = buildTurns([u("1", "hi"), { k: "2.0", role: "thinking", ts: 2, text: "hmm" }, tool("2.1", "read", { result: { text: "", error: false, media: [] } }), a("3.0", "interim", 3), a("4.0", "done", 4)], false);
	expect(t).toHaveLength(1);
	expect(t[0].user?.text).toBe("hi");
	expect(t[0].blocks.map((b) => b.kind)).toEqual(["steps", "answer"]);
	const steps = t[0].blocks[0] as Extract<(typeof t)[0]["blocks"][0], { kind: "steps" }>;
	expect(steps.steps.map((s) => s.role)).toEqual(["thinking", "tool", "note"]);
	expect(steps.live).toBe(false);
	expect(steps.endTs).toBe(4);
});

test("the live turn has no answer yet: everything is steps, open", () => {
	const t = buildTurns([u("1", "go"), a("2.0", "working on it"), tool("2.1", "bash")], true);
	expect(t[0].blocks).toHaveLength(1);
	expect(t[0].blocks[0]).toMatchObject({ kind: "steps", live: true });
});

test("errors end the steps before them", () => {
	const t = buildTurns([u("1", "go"), tool("2.0", "bash"), { k: "3.e", role: "error", ts: 3, text: "aborted" }], false);
	expect(t[0].blocks.map((b) => b.kind)).toEqual(["steps", "error"]);
});

test("turn and block keys come from the items (stable across refreshes)", () => {
	const items = [u("10", "a"), tool("11.0", "bash"), a("12.0", "b")];
	const k1 = buildTurns(items, false).map((t) => [t.key, ...t.blocks.map((b) => b.key)]);
	const k2 = buildTurns([u("5", "older"), a("6.0", "x"), ...items], false).slice(1).map((t) => [t.key, ...t.blocks.map((b) => b.key)]);
	expect(k2).toEqual(k1);
});

test("text before the first prompt still shows (a turn without a user)", () => {
	const t = buildTurns([a("1.0", "hello")], false);
	expect(t[0].user).toBeUndefined();
	expect(t[0].blocks[0].kind).toBe("answer");
});

test("reads and searches fold into an Explored group", () => {
	const steps = [tool("1", "read"), { k: "2", role: "thinking", ts: 1, text: "x" }, tool("3", "grep"), tool("4", "bash", { sum: "Run tests" })] as any;
	const rows = groupSteps(steps);
	expect(rows).toHaveLength(2);
	expect("group" in rows[0] && rows[0].group).toHaveLength(3);
	expect(stepKind(steps[3])).toBe("run");
	expect(exploreCounts((rows[0] as any).group)).toBe("1 file, 1 check");
	expect(stepsDetail(steps).detail).toBe("Explored 1 file · Ran 1 command");
});
