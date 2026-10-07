// Transcripts, per chat ("ref": sid=<id> or tab=<id>). Each is shown from what this page (or this device) already
// has, at once, and refreshed in the background: when the open chat's card changes, on reconnect, and ahead of
// time for the chats you're likely to open next (the top of the sidebar, a row you point at).
// A chat loads whole, once; after that a refresh asks only for its last turn onward (from=<that turn's line>) and
// splices it in. So the transcript only ever changes at its end: nothing above what you're reading is inserted,
// dropped or re-keyed, which is what lets the page leave scrolling to the browser (ui/useScroll.ts). Refreshes keep
// the item objects that didn't change (stable keys from the server), so only new or changed messages redraw.
import { create } from "zustand";
import { cleanJson } from "../lib/format";
import { kv, ls } from "../lib/kv";
import type { TxItem } from "../lib/types";
import { useUi } from "./ui";

const TX_KEEP = 20; // whole transcripts kept on this device, least recently used dropped first

// etag/from: the last refresh's (a 304 answers only the same question).
export type TxEntry = { items: TxItem[]; state: "loading" | "ok" | "error"; from?: number; etag?: string; saved?: boolean };
export const useTx = create<{ entries: Record<string, TxEntry> }>(() => ({ entries: {} }));
const blank: TxEntry = { items: [], state: "loading" };
export const useEntry = (ref?: string | null) => useTx((s) => (ref ? (s.entries[ref] ?? blank) : blank));

const set = (ref: string, e: Partial<TxEntry>) =>
	useTx.setState((s) => ({ entries: { ...s.entries, [ref]: { ...(s.entries[ref] ?? blank), ...e } } }));

// ---------- device copy ----------
let keys: string[] = ls.get("agchat.txkeys", []);
// At most every few seconds per chat: a working chat changes every step, and a whole transcript can be a megabyte.
const saving = new Map<string, ReturnType<typeof setTimeout>>();
function persist(ref: string, items: TxItem[]) {
	clearTimeout(saving.get(ref));
	saving.set(ref, setTimeout(() => (saving.delete(ref), save(ref, items)), 3000));
}
function save(ref: string, items: TxItem[]) {
	keys = [ref, ...keys.filter((k) => k !== ref)];
	for (const k of keys.splice(TX_KEEP)) void kv.del(`tx:${k}`);
	ls.set("agchat.txkeys", keys);
	void kv.set(`tx:${ref}`, { items, v: 3 });
}
// Fill in a chat from this device's copy, if the page doesn't have it yet (opening a chat after a reload).
export async function hydrate(ref: string) {
	if (useTx.getState().entries[ref]?.items.length) return;
	const e = await kv.get<{ items: TxItem[]; v?: number }>(`tx:${ref}`);
	if (!e?.items?.length || e.v !== 3 || useTx.getState().entries[ref]?.items.length) return;
	set(ref, { items: e.items, state: "ok", saved: true });
}

// ---------- loading ----------
const reuse = (prev: TxItem[], next: TxItem[]) => {
	const old = new Map(prev.map((x) => [x.k, x]));
	let same = prev.length === next.length;
	const out = next.map((x, i) => {
		const o = old.get(x.k);
		if (o && JSON.stringify(o) === JSON.stringify(x)) {
			if (prev[i] !== o) same = false;
			return o;
		}
		same = false;
		return x;
	});
	return same ? prev : out;
};

const inflight = new Map<string, Promise<void>>();
const failed = new Set<string>(); // refs whose last load couldn't reach ag-dash
const again = new Set<string>();
const retry = new Map<string, { t: ReturnType<typeof setTimeout>; n: number }>();
let openRef: string | null = null; // the chat on screen: failed loads of it keep retrying
export const setOpenRef = (ref: string | null) => {
	openRef = ref;
	for (const [r, x] of retry) if (r !== ref) (clearTimeout(x.t), retry.delete(r));
};

const lineOf = (x: TxItem) => Number.parseInt(x.k);
// Where a refresh starts: the last turn's prompt (its tool results and answer are still arriving); 0 = load it whole.
function tailFrom(items: TxItem[]) {
	for (let i = items.length - 1; i >= 0; i--) if (items[i].role === "user") return lineOf(items[i]) || 0;
	return 0;
}

export function load(ref: string): Promise<void> {
	if (inflight.has(ref)) {
		again.add(ref);
		return inflight.get(ref)!;
	}
	const p = fetchOnce(ref).finally(() => {
		inflight.delete(ref);
		if (again.delete(ref)) void load(ref);
	});
	inflight.set(ref, p);
	return p;
}

async function fetchOnce(ref: string) {
	const cur = useTx.getState().entries[ref] ?? blank;
	const from = tailFrom(cur.items);
	let r: Response;
	try {
		r = await fetch(`/api/transcript?${ref}&from=${from}`, {
			signal: AbortSignal.timeout(20000),
			headers: cur.etag && !cur.saved && cur.from === from ? { "if-none-match": cur.etag } : {},
		});
		if (!r.ok && r.status !== 304) throw new Error(String(r.status));
	} catch {
		failed.add(ref);
		const e = useTx.getState().entries[ref] ?? blank;
		if (!e.items.length) set(ref, { state: "error" });
		if (ref === openRef) {
			// ag-dash restarting or out of reach: keep what's on screen and try again (1 s, 2 s, 4 s … then every 10 s;
			// at once when the event stream reconnects).
			const n = retry.get(ref)?.n ?? 0;
			clearTimeout(retry.get(ref)?.t);
			retry.set(ref, { n: n + 1, t: setTimeout(() => ref === openRef && void load(ref), Math.min(10000, 1000 * 2 ** n)) });
		}
		return;
	}
	retry.delete(ref);
	failed.delete(ref);
	const etag = r.headers.get("etag") ?? undefined;
	if (r.status === 304) {
		if (cur.state !== "ok") set(ref, { state: "ok" });
		return;
	}
	const tail = await cleanJson<TxItem[] | null>(r).catch(() => null);
	if (!Array.isArray(tail)) return;
	// Loads of one chat never overlap (inflight), so what's loaded is still what `from` was worked out from.
	const now = useTx.getState().entries[ref] ?? blank;
	const items = reuse(now.items, [...now.items.filter((x) => lineOf(x) < from), ...tail]);
	set(ref, { items, state: "ok", from, etag, saved: false });
	if (items !== now.items) persist(ref, items);
}
export const retryOpen = () => openRef && void load(openRef);

// ---------- fetching ahead ----------
const warmQ: string[] = [];
const warmedAt = new Map<string, number>();
let warming = false;
export function warm(ref: string, minGapMs = 20000) {
	if (ref === openRef || Date.now() - (warmedAt.get(ref) || 0) < minGapMs) return;
	if (!warmQ.includes(ref)) warmQ.push(ref);
	void pump();
}
async function pump() {
	if (warming || !warmQ.length || !useUi.getState().netUp) return;
	const ref = warmQ.shift()!;
	warming = true;
	warmedAt.set(ref, Date.now());
	await hydrate(ref);
	await load(ref);
	warming = false;
	setTimeout(pump, 150);
}
export const pumpWarm = () => void pump();
