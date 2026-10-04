// Keyboard shortcuts: which key does what is the user's keys ag-rule ag-dash-keys (~/.ag/ag-rules/ag-dash-keys/,
// keymap keys.json; matching in lib/keys.ts). Here are only the actions and the `when`s it names.
import * as keys from "../lib/keys";
import { urlOf } from "../lib/format";
import { archive, markUnread, neighborOf, togglePin, undoArchive } from "../state/actions";
import { view } from "../state/board";
import { currentCard, routeRef } from "../state/current";
import { displayedOrder } from "../state/order";
import { useTx } from "../state/tx";
import { anchorOf, go, newChat, openPop, setCollapsed, toast, useUi } from "../state/ui";
import { composer } from "./Composer";

const inField = (e: KeyboardEvent) => (e.target as Element | null)?.closest?.("textarea,input,select,[contenteditable]");
const ui = () => useUi.getState();

function stepChat(d: number) {
	const order = displayedOrder();
	const cur = currentCard()?.tab;
	const i = cur ? order.indexOf(cur) : -1;
	const t = order[Math.max(0, Math.min(order.length - 1, i + d))];
	const c = t && view().byTab.get(t);
	if (c) go(urlOf(c));
}
function lastAnswer() {
	const ref = routeRef(ui().route, currentCard());
	const items = ref ? useTx.getState().entries[ref]?.items : undefined;
	return items?.findLast((x) => x.role === "assistant")?.text;
}

const when: Record<string, (e: KeyboardEvent) => boolean> = {
	// Gmail keys: outside text fields and dialogs, no key repeat; with a menu open only "." (more actions).
	gmail: (e) => !e.repeat && !inField(e) && !ui().modal && (!ui().pop || e.key === "."),
};

const actions: Record<string, keys.Action> = {
	newChat,
	back: () => history.back(),
	forward: () => history.forward(),
	toggleSearch: () => useUi.setState((s) => ({ modal: s.modal === "search" ? null : "search", pop: null })),
	toggleSidebar: () => setCollapsed(!ui().collapsed),
	toggleShortcuts: () => useUi.setState((s) => ({ modal: s.modal === "keys" ? null : "keys", pop: null })),
	copyLast: () => {
		const a = lastAnswer();
		if (!a) return false;
		void navigator.clipboard.writeText(a).then(() => toast("Copied last response"));
	},
	togglePin: () => {
		const c = currentCard();
		if (!c) return false;
		void togglePin(c);
	},
	archiveNow: (e) => {
		const c = currentCard();
		if (!c || (e.target as Element)?.closest?.("textarea,input")) return false;
		archive(c);
	},
	// ⌘Z undoes the last archive while its Undo toast is up; inside a field with text it stays the field's own undo.
	undoKey: (e) => {
		const f = inField(e) as HTMLInputElement | null;
		if (f && (f.value ?? f.textContent)) return false;
		if (!undoArchive()) return false;
	},
	undo: () => void undoArchive(),
	dictate: () => composer.dictate(),
	focusBox: () => composer.open(),
	stepChatKey: (e) => stepChat(e.key === "ArrowDown" || e.key.toLowerCase() === "j" ? 1 : -1),
	reply: () => {
		if (!composer.exists()) return false;
		composer.open();
	},
	archiveNext: () => {
		const c = currentCard();
		if (c) archive(c, { advance: true, neighbor: neighborOf(c.tab, displayedOrder()) });
	},
	needsYou: () => go("/chat?view=you"),
	markUnread: () => {
		const c = currentCard();
		if (c) markUnread(c);
	},
	moreActions: () => {
		const c = currentCard();
		const b = document.querySelector("#dotsBtn");
		if (!c || !b) return false;
		openPop({ kind: "chat", tab: c.tab, full: true, anchor: anchorOf(b), align: "right" });
	},
	search: () => useUi.setState({ modal: "search", pop: null }),
	escape: () => {
		const s = ui();
		if (composer.recording()) composer.cancelRec();
		else if (s.pop) useUi.setState({ pop: null });
		else if (s.modal) useUi.setState({ modal: null });
		else if (s.lightbox) useUi.setState({ lightbox: null });
		// Esc never leaves the open chat; it only closes things layered on top of it.
		return "stop"; // never preventDefault Esc (dialogs and fields keep their own)
	},
	// In the message box. Esc only leaves the box (Gmail keys work again); it never stops the agent.
	send: () => {
		if (matchMedia("(max-width: 760px)").matches) return false; // on a phone Enter is a new line
		composer.send({});
	},
	sendPin: () => composer.send({ pin: !matchMedia("(max-width: 760px)").matches }),
	interruptSend: () => composer.send({ interrupt: true }),
	leaveBox: () => composer.leave(),
};

export const composerKeys = (e: KeyboardEvent) => keys.dispatch(e, actions, when, { only: "composer" });
export function installKeys() {
	document.addEventListener("keydown", (e) => {
		// Keys typed into a dialog's own field (search) are that field's, except the global ones it doesn't handle.
		keys.dispatch(e, actions, when, { skip: ["composer"] });
	});
	return keys.load("ag-dash");
}
