// Keeping the page in step with ag-dash: the board over an event stream (SSE), this device's saved copy at launch,
// reconnecting, catching up after a gap, and moving onto a new version of the page by itself.
import { cleanJson, noEmoji } from "../lib/format";
import { kv } from "../lib/kv";
import type { Board, Config } from "../lib/types";
import { applyBoard, useBoard } from "./board";
import { flush } from "./outbox";
import { pumpWarm, retryOpen } from "./tx";
import { useUi } from "./ui";

// netUp: the event stream is connected. While it isn't, a small pill says so (after a moment, so a quick ag-dash
// restart doesn't flash it); when it's back, the open chat, the outbox and the background fetches catch up.
let netT: ReturnType<typeof setTimeout> | undefined;
function setNet(up: boolean) {
	if (up === useUi.getState().netUp) return;
	useUi.setState({ netUp: up });
	clearTimeout(netT);
	if (up) {
		useUi.setState({ netPill: false });
		retryOpen();
		void flush();
		pumpWarm();
	} else netT = setTimeout(() => !useUi.getState().netUp && useUi.setState({ netPill: true }), 2500);
}

let es: EventSource | null = null;
let retryT: ReturnType<typeof setTimeout> | undefined;
function connect() {
	clearTimeout(retryT);
	es?.close();
	es = new EventSource("/events");
	es.onopen = () => setNet(true);
	es.onmessage = (e) => {
		if (!e.data) return;
		setNet(true);
		received(JSON.parse(noEmoji(e.data)), false);
	};
	es.addEventListener("delta", (e) => received(JSON.parse(noEmoji((e as MessageEvent).data)), true));
	es.onerror = () => {
		es?.close();
		setNet(false);
		retryT = setTimeout(connect, 1500);
	};
}
document.addEventListener("visibilitychange", () => {
	if (!document.hidden && es?.readyState !== EventSource.OPEN) connect();
});

// The board is saved on this device at most every 3 s.
let saveT: ReturnType<typeof setTimeout> | null = null;
let savedAt = 0;
function saveSoon() {
	const go = () => ((saveT = null), (savedAt = Date.now()), void kv.set("board", useBoard.getState().board));
	if (Date.now() - savedAt > 3000 && !saveT) go();
	else saveT ||= setTimeout(go, 3000);
}

const listeners = new Set<(b: Board, prev: Board | null) => void>();
export const onBoard = (f: (b: Board, prev: Board | null) => void) => (listeners.add(f), () => void listeners.delete(f));
function received(b: Board, delta: boolean) {
	const prev = useBoard.getState().board;
	applyBoard(b, delta);
	saveSoon();
	const now = useBoard.getState().board!;
	for (const f of listeners) f(now, prev);
	checkVersion(now.page);
}

// ---------- new versions ----------
// The board carries the served page's version. When it changes, reload onto it as soon as that can't interrupt
// you: the page is in the background, or nothing is being typed, recorded or open on top. Drafts and the outbox
// live on this device, so nothing is lost either way.
// The baseline is the version this page was built as (ag-dash writes it into the page it serves), not the first board:
// a page served from the device's copy during a restart still sees that it's old.
let page: number = (window as any).AG_PAGE || 0;
let updateReady = false;
function checkVersion(p: number) {
	if (!p) return;
	if (!page) page = p;
	else if (p !== page) updateReady = true;
}
export let busy = () => false; // the app says when reloading now would interrupt (set in App)
export const setBusy = (f: () => boolean) => (busy = f);
let lastInput = 0; // a tap, click, key or scroll in the last few seconds: mid-gesture, wait
for (const ev of ["pointerdown", "touchstart", "keydown", "wheel"]) addEventListener(ev, () => (lastInput = Date.now()), { capture: true, passive: true });
setInterval(() => {
	if (!updateReady) return;
	if (!document.hidden && Date.now() - lastInput < 4000) return;
	const ui = useUi.getState();
	const typing = document.activeElement?.matches?.("textarea, input") && (document.activeElement as HTMLTextAreaElement).value;
	if (document.hidden || (!typing && !ui.pop && !ui.modal && !busy())) location.reload();
}, 1000);

// ---------- config (models, user name) ----------
export async function loadConfig() {
	try {
		const j = (await (await fetch("/api/config")).json()) as Config;
		useUi.setState({ config: j });
	} catch {}
}

// ---------- launch ----------
// Paint from the board saved on this device at once, then from ag-dash's own as soon as it answers.
export async function start() {
	const saved = Promise.race([kv.get<Board>("board"), new Promise<undefined>((r) => setTimeout(r, 1000))]).then((b) => {
		if (b?.cards && !useBoard.getState().fresh) applyBoard(Object.assign({ rev: 0, boot: "", page: 0 }, b), false, true);
	});
	try {
		const r = await fetch("/api/state");
		const b = await cleanJson<Board>(r);
		received(b, false);
	} catch {}
	await saved;
	connect();
	void flush();
	void loadConfig();
}
