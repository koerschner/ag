// Everything you can do to a chat. Each shows at once (an op on the board, see board.ts) and is confirmed by
// ag-dash; a failure undoes it on screen and says why.
import { urlOf } from "../lib/format";
import type { Card } from "../lib/types";
import { ackOp, addOp, cardByTab, dropOp, useBoard, view, type Patch } from "./board";
import { go, toast, useUi } from "./ui";
import { copyText } from "../lib/clipboard";

export async function api<T = any>(path: string, body: unknown): Promise<T> {
	const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const j = await r.json().catch(() => ({}));
	if (!r.ok || j.ok === false) throw new Error(j.error || `${r.status}`);
	return j;
}

async function change(c: Card, patch: Patch, body: Record<string, unknown>, done?: string) {
	const op = addOp(c.tab, patch);
	try {
		const j = await api<{ rev?: number; boot?: string }>("/api/card", { tab: c.tab, ...body });
		ackOp(op, j.rev, j.boot);
		if (done) toast(done);
	} catch (e: any) {
		dropOp(op);
		toast(`Failed: ${e.message}`);
	}
}

export const togglePin = (c: Card) => change(c, { pinned: !c.pinned, pinnedAt: Date.now() }, { pinned: !c.pinned }, c.pinned ? "Unpinned" : "Pinned");
export const setPinned = (c: Card, pinned: boolean) => c.pinned !== pinned && change(c, { pinned, pinnedAt: Date.now() }, { pinned }, pinned ? "Pinned" : "Unpinned");
export const toggleWaiting = (c: Card) => {
	const on = !c.waiting?.length;
	return change(c, { waiting: on }, { waiting: on }, on ? "Marked waiting; it'll schedule its own wake-up" : "No longer waiting");
};
// Once per answer: if ag-dash still says unseen after that (a newer answer, or it didn't take), it's not re-sent in
// a loop; a newer answer is marked again.
const seenSent = new Map<string, number>();
export function markSeen(c: Card) {
	const at = c.lastAssistant?.ts ?? c.statusSince;
	if (!c.needsYou || seenSent.get(c.tab) === at) return;
	seenSent.set(c.tab, at);
	return change(c, { needsYou: false }, { seen: true });
}
export function markUnread(c: Card) {
	seenSent.delete(c.tab);
	void change(c, { needsYou: true }, { seen: false });
	const r = useUi.getState().route;
	if (r.kind === "chat" && (r.tab === c.tab || (c.sid && r.sid === c.sid))) go("/chat");
}

export async function rename(c: Card, label: string) {
	const op = addOp(c.tab, { title: label });
	try {
		const j = await api<{ rev?: number; boot?: string }>("/api/rename", { tab: c.tab, label });
		ackOp(op, j.rev, j.boot);
	} catch (e: any) {
		dropOp(op);
		toast(`Rename failed: ${e.message}`);
	}
}

// Archive (ChatGPT-style: one click, no confirmation). The chat leaves the sidebar at once; its tab closes only
// after the Undo window (or when the page goes away), so Undo leaves the session untouched. A chat that's still
// working keeps running hidden and comes back if it needs you.
const UNDO_MS = 6000;
const archiving = new Map<string, { op: ReturnType<typeof addOp>; t: ReturnType<typeof setTimeout> }>();
export function archive(c: Card, { advance = false, neighbor }: { advance?: boolean; neighbor?: string | null } = {}) {
	if (archiving.has(c.tab)) return;
	const r = useUi.getState().route;
	const wasOpen = r.kind === "chat" && (r.tab === c.tab || (!!c.sid && r.sid === c.sid));
	const op = addOp(c.tab, { hidden: true });
	archiving.set(c.tab, { op, t: setTimeout(() => closeNow(c.tab), UNDO_MS) });
	if (wasOpen) go((advance && neighbor) || "/chat");
	toast(
		c.status === "working" ? "Archived. It keeps running and comes back if it needs you" : "Chat archived",
		{
			label: "Undo",
			run: () => {
				const a = archiving.get(c.tab);
				if (!a) return;
				clearTimeout(a.t);
				archiving.delete(c.tab);
				dropOp(a.op);
				if (wasOpen) go(urlOf(cardByTab(c.tab) ?? c));
			},
		},
		UNDO_MS,
	);
}
async function closeNow(tab: string) {
	const a = archiving.get(tab);
	if (!a) return;
	archiving.delete(tab);
	try {
		const j = await api<{ rev?: number; boot?: string }>("/api/close", { tab });
		ackOp(a.op, j.rev, j.boot);
	} catch (e: any) {
		dropOp(a.op);
		toast(`Couldn't archive: ${e.message}`);
	}
}
export const undoArchive = () => {
	const t = useUi.getState().toast;
	if (!t?.action || t.action.label !== "Undo") return false;
	t.action.run();
	useUi.setState({ toast: null });
	return true;
};
addEventListener("pagehide", () => {
	for (const [tab, a] of archiving) {
		clearTimeout(a.t);
		navigator.sendBeacon("/api/close", new Blob([JSON.stringify({ tab })], { type: "application/json" }));
	}
	archiving.clear();
});

export async function stop(c?: Card | null) {
	if (!c) return;
	try {
		await api("/api/interrupt", { tab: c.tab });
		toast("Stopped");
	} catch (e: any) {
		toast(`Couldn't stop: ${e.message}`);
	}
}
export async function openInTmux(c: Card) {
	try {
		await api("/api/focus", { tab: c.tab });
		toast("Opened in tmux");
	} catch (e: any) {
		toast(`Failed: ${e.message}`);
	}
}
export const sendKey = (c: Card, key: string) => api("/api/keys", { tab: c.tab, keys: [key] }).catch((e) => toast(e.message));
export async function copyLink(sid?: string) {
	if (!sid) return;
	await copyText(`${location.origin}/chat/${sid}`);
	toast("Link copied");
}

export async function switchModel(c: Card, body: { model?: string; thinking?: string }) {
	useUi.setState({ pop: null });
	try {
		await api("/api/model", { tab: c.tab, ...body });
		toast(body.model ? `Switched to ${body.model.split("/").slice(1).join("/")}` : `Thinking: ${body.thinking}`);
	} catch (e: any) {
		toast(`Couldn't switch: ${e.message}`);
	}
}
export function toggleModelPin(id: string) {
	const cfg = useUi.getState().config;
	if (!cfg) return;
	const pins = cfg.pinnedModels.includes(id) ? cfg.pinnedModels.filter((x) => x !== id) : [...cfg.pinnedModels, id];
	useUi.setState({ config: { ...cfg, pinnedModels: pins } });
	api("/api/model-pins", { models: pins }).catch((e) => toast(`Couldn't save pinned models: ${e.message}`));
}

// Wake a hibernated chat, or bring a closed one back (a new tab running pi --session); the page moves to it
// once it's on the board.
export async function resume(sid: string) {
	const j = await api<{ tab?: string }>("/api/resume", { sid });
	if (j.tab) useUi.setState({ startingTab: j.tab });
	return j;
}

// The chat after this one in the sidebar's order (or before it, if it was last): where `e` lands after archiving.
export function neighborOf(tab: string, order: string[]) {
	const i = order.indexOf(tab);
	if (i < 0) return null;
	const pick = (list: string[]) => list.find((t) => t !== tab && !archiving.has(t));
	const t = pick(order.slice(i + 1)) ?? pick(order.slice(0, i).reverse());
	const c = t ? view().byTab.get(t) : undefined;
	return c ? urlOf(c) : null;
}
export const boardFresh = () => useBoard.getState().fresh;
