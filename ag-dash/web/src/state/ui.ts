// Page state that isn't the board: where you are (the route), what's layered on top (a menu, a dialog, a toast),
// and small preferences. Every page is a URL; the router handles back/forward.
import { create } from "zustand";
import { ls } from "../lib/kv";
import type { Card, Config } from "../lib/types";

export type ListView = "inbox" | "you" | "working" | "waiting" | "archived";
export type Route =
	| { kind: "new" }
	| { kind: "chat"; sid?: string; tab?: string }
	| { kind: "list"; view: ListView }
	| { kind: "routines" }
	| { kind: "rules" };

export function parseRoute(loc: { pathname: string; search: string } = location): Route {
	const p = loc.pathname.replace(/\/$/, "");
	const sid = p.match(/^\/chat\/([0-9a-f-]{36})$/)?.[1];
	if (sid) return { kind: "chat", sid };
	const tab = p.match(/^\/chat\/t\/(.+)$/)?.[1];
	if (tab) return { kind: "chat", tab: decodeURIComponent(tab) };
	const v = new URLSearchParams(loc.search).get("view");
	if (v === "inbox" || v === "you" || v === "working" || v === "waiting" || v === "archived") return { kind: "list", view: v };
	if (v === "routines" || v === "rules") return { kind: v };
	return { kind: "new" };
}

// Something layered over the page: a menu anchored to a point or element (a bottom sheet on phones).
export type Anchor = { left: number; right: number; top: number; bottom: number };
export type PopKind =
	| { kind: "chat"; tab: string; full: boolean; title?: boolean }
	| { kind: "profile" }
	| { kind: "picker" }
	| { kind: "message"; turnKey: string; role: "user" | "assistant" };
export type Pop = PopKind & { anchor: Anchor; align?: "left" | "right"; above?: boolean };
export type Toast = { id: number; msg: string; action?: { label: string; run: () => void }; ms: number };

type UiState = {
	route: Route;
	nav: number; // bumps on every navigation (fresh composers focus, menus close)
	focusNew: boolean; // an explicit "new chat" asked for the composer
	collapsed: boolean;
	pop: Pop | null;
	modal: "search" | "keys" | null;
	toast: Toast | null;
	lightbox: { src: string; video: boolean } | null;
	netUp: boolean;
	netPill: boolean;
	config: Config | null;
	newModel: string | null; // the model picked for the next new chat (this page load)
	modelsMore: boolean;
	renaming: string | null; // tab whose sidebar row is an inline rename field
	theme: "system" | "light" | "dark";
	secClosed: Record<string, boolean>;
	notify: boolean;
	starting: { id: string; text: string; failed?: boolean } | null; // a new chat on its way
	startingTab: string | null; // its tab, until the board has it
	sessions: Record<string, SessionMeta>; // closed or asleep chats opened on this page (header and picker show them)
};
export type SessionMeta = { title?: string; model?: string; cwd?: string; startedAt?: number; stats?: Card["stats"] };

const isMobile = () => innerWidth <= 760;
export const useUi = create<UiState>(() => ({
	route: parseRoute(),
	nav: 0,
	focusNew: false,
	collapsed: ls.raw("agchat.side") === "0" || isMobile(),
	pop: null,
	modal: null,
	toast: null,
	lightbox: null,
	netUp: true,
	netPill: false,
	config: null,
	newModel: null,
	modelsMore: false,
	renaming: null,
	theme: (ls.raw("agchat.theme") as UiState["theme"]) || "system",
	secClosed: ls.get("agchat.secs", {}),
	notify: ls.raw("agchat.notify") !== "0",
	starting: null,
	startingTab: null,
	sessions: {},
}));
export { isMobile };

export function go(url: string, replace = false) {
	if (url !== location.pathname + location.search) history[replace ? "replaceState" : "pushState"]({}, "", url);
	useUi.setState((s) => ({ route: parseRoute(), nav: s.nav + 1, pop: null, renaming: null, collapsed: isMobile() ? true : s.collapsed }));
}
addEventListener("popstate", () => useUi.setState((s) => ({ route: parseRoute(), nav: s.nav + 1, pop: null })));
export const newChat = () => {
	useUi.setState({ focusNew: true });
	go("/chat");
};

let toastId = 0;
let toastT: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, action?: Toast["action"], ms = 2400) {
	clearTimeout(toastT);
	const t = { id: ++toastId, msg, action, ms };
	useUi.setState({ toast: t });
	toastT = setTimeout(() => useUi.getState().toast?.id === t.id && useUi.setState({ toast: null }), ms);
}
export const closePop = () => useUi.getState().pop && useUi.setState({ pop: null });
export const openPop = (pop: Pop) => useUi.setState({ pop });
export function setCollapsed(v: boolean, persist = true) {
	useUi.setState({ collapsed: v });
	if (persist && !isMobile()) ls.setRaw("agchat.side", v ? "0" : "1");
}
export function setTheme(t: UiState["theme"]) {
	ls.setRaw("agchat.theme", t);
	useUi.setState({ theme: t });
	(window as any).applyTheme?.();
}
export function toggleSec(id: string) {
	const secClosed = { ...useUi.getState().secClosed, [id]: !useUi.getState().secClosed[id] };
	ls.set("agchat.secs", secClosed);
	useUi.setState({ secClosed });
}
export const anchorOf = (el: Element): Anchor => {
	const r = el.getBoundingClientRect();
	return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};
export const pointAnchor = (x: number, y: number): Anchor => ({ left: x, right: x, top: y - 6, bottom: y - 6 });
