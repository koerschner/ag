// Transcripts, per chat ("ref": sid=<id> or tab=<id>). Each is shown from what this page (or this device) already
// has, at once, and refreshed in the background: when the open chat's card changes, on reconnect, and ahead of
// time for the chats you're likely to open next (the top of the sidebar, a row you point at).
// Refreshes keep the item objects that didn't change (stable keys from the server), so only new or changed
// messages redraw.
import { create } from "zustand";
import { cleanJson } from "../lib/format";
import { kv, ls } from "../lib/kv";
import type { TxItem } from "../lib/types";
import { useUi } from "./ui";

export const TX_PAGE = 150;
const TX_KEEP = 60; // transcripts kept on this device (newest page each), least recently used dropped first

// limit: how many of the newest items to load; from (set while you're scrolled up reading): load everything from this
// item's line on instead, so what's loaded only grows at the bottom and nothing above you drops off.
export type TxEntry = { items: TxItem[]; more: boolean; state: "loading" | "ok" | "error"; limit: number; from?: number; etag?: string; saved?: boolean };
export const useTx = create<{ entries: Record<string, TxEntry> }>(() => ({ entries: {} }));
const blank: TxEntry = { items: [], more: false, state: "loading", limit: TX_PAGE };
export const useEntry = (ref?: string | null) => useTx((s) => (ref ? (s.entries[ref] ?? blank) : blank));

const set = (ref: string, e: Partial<TxEntry>) =>
	useTx.setState((s) => ({ entries: { ...s.entries, [ref]: { ...(s.entries[ref] ?? blank), ...e } } }));

// ---------- device copy ----------
let keys: string[] = ls.get("agchat.txkeys", []);
function persist(ref: string, items: TxItem[], more: boolean) {
	keys = [ref, ...keys.filter((k) => k !== ref)];
	for (const k of keys.splice(TX_KEEP)) void kv.del(`tx:${k}`);
	ls.set("agchat.txkeys", keys);
	void kv.set(`tx:${ref}`, { items: items.slice(-TX_PAGE), more: more || items.length > TX_PAGE, v: 2 });
}
// Fill in a chat from this device's copy, if the page doesn't have it yet (opening a chat after a reload).
export async function hydrate(ref: string) {
	if (useTx.getState().entries[ref]?.items.length) return;
	const e = await kv.get<{ items: TxItem[]; more: boolean; v?: number }>(`tx:${ref}`);
	if (!e?.items?.length || e.v !== 2 || useTx.getState().entries[ref]?.items.length) return;
	set(ref, { items: e.items, more: e.more, state: "ok", saved: true });
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

export function load(ref: string, opts: { limit?: number; hold?: boolean } = {}): Promise<void> {
	if (opts.limit) set(ref, { limit: opts.limit, from: undefined });
	else if (opts.hold) {
		// Scrolled up: keep what's loaded (from its first item on) instead of the newest `limit`.
		const e = useTx.getState().entries[ref];
		const first = e?.items[0] && Number.parseInt(e.items[0].k);
		// Not while a load is running: it may be an older page (a bigger limit) that this would cancel.
		if (e && first !== undefined && !Number.isNaN(first) && e.from === undefined && !inflight.has(ref)) set(ref, { from: first });
	}
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
	const { limit, from } = cur;
	let r: Response;
	try {
		r = await fetch(`/api/transcript?${ref}&limit=${limit}${from !== undefined ? `&from=${from}` : ""}`, {
			signal: AbortSignal.timeout(20000),
			headers: cur.etag && !cur.saved ? { "if-none-match": cur.etag } : {},
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
	const items = await cleanJson<TxItem[] | null>(r).catch(() => null);
	if (!Array.isArray(items)) return;
	const more = r.headers.get("x-more") === "1";
	const now = useTx.getState().entries[ref] ?? blank;
	if (now.limit !== limit || now.from !== from) return; // a different window was asked for meanwhile; its load follows
	set(ref, { items: reuse(now.items, items), more, state: "ok", etag, saved: false });
	if (limit === TX_PAGE && from === undefined) persist(ref, items, more);
}

// Shrink back to the newest page (the open chat, scrolled back to the bottom after reading older pages).
export function trim(ref: string) {
	const e = useTx.getState().entries[ref];
	if (!e || (e.limit <= TX_PAGE && e.from === undefined)) return;
	set(ref, { limit: TX_PAGE, from: undefined, etag: undefined });
	void load(ref);
}
// Resolves true when it's worth trying again (the page grew, or another load was running and went through); false
// when ag-dash couldn't be reached, so scrolling at the top doesn't retry in a loop (the open chat's own backoff does).
export function loadOlder(ref: string): Promise<boolean> | null {
	const e = useTx.getState().entries[ref];
	if (!e?.more || failed.has(ref)) return null;
	if (inflight.has(ref)) return inflight.get(ref)!.then(() => !failed.has(ref));
	const before = e.items.length;
	return load(ref, { limit: e.items.length + TX_PAGE }).then(() => !failed.has(ref) && (useTx.getState().entries[ref]?.items.length ?? 0) > before);
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
