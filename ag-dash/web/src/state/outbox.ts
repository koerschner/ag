// What you send is kept on this device (localStorage agchat.outbox) until ag-dash confirms it: a reply, or a new
// chat typed in the box. If ag-dash can't be reached (restarting, network down), the reply's bubble stays, marked as
// not sent yet, and everything goes out by itself once it's back (retried every few seconds, and the moment the
// event stream reconnects), in order. Each item carries an id, so a retry whose first try did land isn't delivered
// twice. Sent replies show as faded bubbles until they appear in the transcript (a reply sent while the agent works
// is queued as steering and only lands after the current step).
import { create } from "zustand";
import { draftKeyOf, newId, noEmoji } from "../lib/format";
import { ls } from "../lib/kv";
import { addOp, ackOp, cardByTab } from "./board";
import { saveDraftText } from "./drafts";
import { useUi, toast } from "./ui";

export type OutItem = { id: string; kind: "reply" | "new"; tab?: string; text: string; interrupt?: boolean; pin?: boolean; model?: string; ts: number; failed?: boolean };
export type Sent = { tab: string; text: string; ts: number; voice?: boolean };
type OutState = { items: OutItem[]; sent: Sent[] };

export const useOutbox = create<OutState>(() => ({ items: ls.get<OutItem[]>("agchat.outbox", []).map((o) => ({ ...o, failed: false })), sent: [] }));
const save = () => ls.set("agchat.outbox", useOutbox.getState().items);

export type NewDone = (o: OutItem, ok: boolean, body: any) => void;
let onNewDone: NewDone = () => {};
export const setOnNewDone = (f: NewDone) => (onNewDone = f);

export function queue(item: Omit<OutItem, "id" | "ts"> & { id?: string }) {
	useOutbox.setState((s) => ({ items: [...s.items, { id: newId(), ts: Date.now(), ...item }] }));
	save();
	void flush();
}

const transient = (r: Response | null) => !r || r.status >= 500;
let flushing = false;
export async function flush() {
	if (flushing) return;
	flushing = true;
	try {
		for (;;) {
			const o = useOutbox.getState().items[0];
			if (!o) break;
			let r: Response | null = null;
			let j: any = {};
			try {
				if (o.kind === "new") {
					const fd = new FormData();
					fd.append("text", o.text);
					fd.append("route", "new");
					fd.append("id", o.id);
					if (o.model) fd.append("model", o.model);
					r = await fetch("/api/new", { method: "POST", body: fd, signal: AbortSignal.timeout(120000) });
				} else
					r = await fetch("/api/prompt", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ tab: o.tab, text: o.text, interrupt: !!o.interrupt, id: o.id }),
						signal: AbortSignal.timeout(60000),
					});
				j = await r.json().catch(() => ({}));
			} catch {
				r = null;
			}
			if (transient(r)) {
				// Still down: try again later, in order.
				useOutbox.setState((s) => ({ items: s.items.map((x) => (x.id === o.id ? { ...x, failed: true } : x)) }));
				if (o.kind === "new" && useUi.getState().starting?.id === o.id) useUi.setState((s) => ({ starting: s.starting && { ...s.starting, failed: true } }));
				break;
			}
			const ok = r!.ok && j.ok !== false;
			useOutbox.setState((s) => ({
				items: s.items.filter((x) => x.id !== o.id),
				sent: o.kind === "reply" && ok ? [...s.sent, { tab: o.tab!, text: o.text, ts: o.ts }] : s.sent,
			}));
			save();
			if (o.kind === "new") onNewDone(o, ok, j);
			else if (ok) {
				const c = cardByTab(o.tab!);
				if (o.pin && c && !c.pinned) {
					const op = addOp(c.tab, { pinned: true, pinnedAt: Date.now() });
					void fetch("/api/card", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tab: c.tab, pinned: true }) })
						.then((r) => r.json())
						.then((x) => ackOp(op, x.rev, x.boot))
						.catch(() => ackOp(op));
				}
			} else {
				// A real refusal (the chat is gone, pi wouldn't take it): back into that chat's box, nothing lost.
				const c = cardByTab(o.tab!);
				saveDraftText(c ? draftKeyOf(c) : `t:${o.tab}`, o.text, true);
				toast(`Couldn't send: ${j.error || r!.status}`);
			}
		}
	} finally {
		flushing = false;
	}
}
setInterval(() => useOutbox.getState().items.length && void flush(), 4000);
addEventListener("online", () => void flush());

export function addSent(s: Sent) {
	useOutbox.setState((st) => ({ sent: [...st.sent, s] }));
}
export function removeSent(s: Sent) {
	useOutbox.setState((st) => ({ sent: st.sent.filter((x) => x !== s) }));
}
// Drop sent bubbles that have reached the transcript (or are older than 30 minutes).
export function settleSent(tab: string, userTexts: string[]) {
	const { sent } = useOutbox.getState();
	// Transcripts arrive with emoji turned into text (cleanJson), so compare the same way.
	const keep = sent.filter((p) => p.tab !== tab || (!p.voice && !userTexts.includes(noEmoji(p.text).trim()) && Date.now() - p.ts < 30 * 60e3) || (p.voice && Date.now() - p.ts < 20e3));
	if (keep.length !== sent.length) useOutbox.setState({ sent: keep });
}
