// The app shell: sidebar, main column, overlays, and the page-wide behaviors (links, gestures, notifications).
import { useEffect, useState } from "react";
import { needsYou, noEmoji, snippet, urlOf } from "../lib/format";
import { useBoard, view } from "../state/board";
import { currentCard, useCurrent } from "../state/current";
import { saveDraftText } from "../state/drafts";
import { setOnNewDone } from "../state/outbox";
import { onBoard, setBusy } from "../state/sync";
import { go, isMobile, openPop, pointAnchor, anchorOf, setCollapsed, toast, useUi } from "../state/ui";
import { composer } from "./Composer";
import { Main, started } from "./Main";
import { messageTarget, Overlays } from "./Overlays";
import { Sidebar } from "./Sidebar";

export function App() {
	const collapsed = useUi((s) => s.collapsed);
	const wco = useWco();
	useStartingTab();
	useTitle();
	return (
		<div className={`app${collapsed ? " collapsed" : ""}${wco ? " wco" : ""}`} id="app">
			<Sidebar />
			<Main />
			<Overlays />
		</div>
	);
}

// The window title: the open chat's name, with how many chats need you in front ("(2) Fix Ag Inbox").
function useTitle() {
	const n = useBoard((s) => view(s).cards.filter(needsYou).length);
	const c = useCurrent();
	useEffect(() => {
		document.title = (n ? `(${n}) ` : "") + (c ? noEmoji(c.title) : "Ag");
	}, [n, c?.title]);
}

// The new chat (or a restored one) opens as soon as the board has it; after 30 s it's left in the Inbox.
function useStartingTab() {
	const tab = useUi((s) => s.startingTab);
	const c = useBoard((s) => (tab ? view(s).byTab.get(tab) : undefined));
	useEffect(() => {
		if (!tab) return;
		if (c) {
			useUi.setState({ startingTab: null, starting: null });
			const r = useUi.getState().route;
			if (r.kind === "new" || r.kind === "list" || (r.kind === "chat" && !currentCard())) go(urlOf(c));
			return;
		}
		const t = setTimeout(() => {
			if (useUi.getState().startingTab !== tab) return;
			useUi.setState({ startingTab: null, starting: null });
			toast("Chat started in your Inbox");
		}, 30000);
		return () => clearTimeout(t);
	}, [tab, c]);
}

function useWco() {
	const wco = (navigator as any).windowControlsOverlay;
	const [on, setOn] = useState(() => !!wco?.visible);
	useEffect(() => {
		if (!wco) return;
		const f = () => setOn(!!wco.visible);
		wco.addEventListener("geometrychange", f);
		return () => wco.removeEventListener("geometrychange", f);
	}, [wco]);
	return on;
}

// ---------- page-wide wiring (once) ----------
export function installGlobal() {
	setOnNewDone((o, ok, j) => {
		if (ok) return started(o.id, j.tab);
		toast(`Couldn't start: ${j.error || "error"}`);
		if (useUi.getState().starting?.id === o.id) useUi.setState({ starting: null });
		saveDraftText("new", o.text, true);
	});
	setBusy(() => composer.pending());
	// The Mac app (macos-apps/ag-dash) navigates the page with go().
	(window as any).go = (url: string) => go(url);

	// Links and buttons inside rendered HTML (markdown, chips): in-app links, code Copy, image viewer, Edit.
	document.addEventListener("click", (e) => {
		const t = e.target as Element;
		const g = t.closest?.("[data-go]");
		if (g && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey && !(e as MouseEvent).shiftKey) {
			e.preventDefault();
			go(g.getAttribute("data-go")!);
			return;
		}
		const cc = t.closest?.("[data-copy-code]");
		if (cc) {
			const code = cc.closest("pre")?.querySelector("code")?.innerText ?? "";
			void navigator.clipboard.writeText(code).then(() => {
				const old = cc.innerHTML;
				cc.textContent = "Copied";
				setTimeout(() => (cc.innerHTML = old), 1500);
			});
			return;
		}
		const z = t.closest?.("[data-zoom]") as HTMLImageElement | null;
		if (z) {
			useUi.setState({ lightbox: { src: z.src, video: z.tagName === "VIDEO" } });
			return;
		}
		const ed = t.closest?.("[data-edit]");
		if (ed) composer.setText(ed.getAttribute("data-edit") ?? "");
	});

	// Which controls get used (ag-dash-stats): one beacon per click on anything with data-t.
	document.addEventListener(
		"click",
		(e) => {
			const n = (e.target as Element).closest?.("[data-t]")?.getAttribute("data-t");
			if (n) navigator.sendBeacon?.("/api/click", new Blob([JSON.stringify({ name: n, view: isMobile() ? "phone" : "desktop" })], { type: "application/json" }));
		},
		true,
	);

	// Desktop: right-click a chat in a list opens its menu at the pointer (the sidebar's rows do this themselves).
	addEventListener("contextmenu", (e) => {
		if (isMobile() || e.shiftKey) return;
		const el = (e.target as Element).closest?.("#rows .crow[data-tab]");
		const tab = el?.getAttribute("data-tab");
		if (!tab || !view().byTab.get(tab)) return;
		e.preventDefault();
		openPop({ kind: "chat", tab, full: false, anchor: pointAnchor(e.clientX, e.clientY) });
	});

	installTouch();
	installNotifications();

	// iOS keeps the layout viewport when the keyboard opens; size the app to the visual viewport so the composer
	// rides on top of the keyboard instead of hiding behind it.
	const vv = window.visualViewport;
	const syncVv = () => {
		document.documentElement.style.setProperty("--vvh", `${vv ? vv.height : innerHeight}px`);
		if (vv?.offsetTop && isMobile()) scrollTo(0, 0);
	};
	vv?.addEventListener("resize", syncVv);
	vv?.addEventListener("scroll", syncVv);
	syncVv();

	// The home screen app (and https pages) keep a copy of the page, so it opens even while ag-dash restarts.
	if ("serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ---------- phone gestures ----------
// Swipe right anywhere to open the sidebar, left to close it (it follows the finger, like ChatGPT's app);
// long-press a chat for its menu, a message for Copy / Select / Read aloud / Edit.
function installTouch() {
	let swipe: { x: number; y: number; t: number; open: boolean; dx: number; on: boolean } | null = null;
	let eatClickUntil = 0;
	const skip = "textarea, input, pre, table, .chips, .media, .keys, .attachments, .recbar, .pop, .modal, .lightbox";
	const side = () => document.getElementById("side")!;
	const main = () => document.getElementById("main")!;
	const scrim = () => document.querySelector(".scrim") as HTMLElement;
	addEventListener(
		"touchstart",
		(e) => {
			swipe = null;
			const s = useUi.getState();
			if (!isMobile() || e.touches.length !== 1 || s.pop || s.modal || s.lightbox || composer.recording()) return;
			const open = !s.collapsed;
			const t = e.target as Element;
			if (!open && t.closest?.(skip)) return;
			if (open && !t.closest?.(".side, .scrim")) return;
			swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), open, dx: 0, on: false };
		},
		{ passive: true },
	);
	addEventListener(
		"touchmove",
		(e) => {
			if (!swipe) return;
			const t = e.touches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
			if (!swipe.on) {
				if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (swipe = null);
				if (Math.abs(dx) < 12) return;
				if (swipe.open ? dx > 0 : dx < 0) return void (swipe = null);
				swipe.on = true;
				cancelLp();
				document.getElementById("app")!.classList.add("swiping");
			}
			e.preventDefault();
			swipe.dx = dx;
			const w = side().offsetWidth, x = Math.max(0, Math.min(w, (swipe.open ? w : 0) + dx));
			side().style.transform = `translateX(${x - w}px)`;
			main().style.transform = `translateX(${x}px)`;
			scrim().style.opacity = String(x / w);
		},
		{ passive: false },
	);
	addEventListener("touchend", () => {
		const sw = swipe;
		swipe = null;
		if (!sw?.on) return;
		const w = side().offsetWidth, v = sw.dx / Math.max(1, Date.now() - sw.t), x = (sw.open ? w : 0) + sw.dx;
		document.getElementById("app")!.classList.remove("swiping");
		for (const el of [side(), main(), scrim()]) (el.style.transform = ""), (el.style.opacity = "");
		setCollapsed(!(Math.abs(v) > 0.3 ? v > 0 : x > w / 2), false);
		eatClickUntil = Date.now() + 400;
	});

	let lp: { el: Element; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let lpHeld = false; // the finger that fired a long-press is still down: its lift must not "tap" the new sheet
	function cancelLp() {
		if (lp) (clearTimeout(lp.timer), lp.el.classList.remove("lp"), (lp = null));
	}
	function fire(el: Element) {
		lp = null;
		el.classList.remove("lp");
		lpHeld = true;
		eatClickUntil = Date.now() + 1500;
		navigator.vibrate?.(8);
		const tab = el.getAttribute("data-tab");
		if (tab) {
			if (view().byTab.get(tab)) openPop({ kind: "chat", tab, full: false, title: true, anchor: anchorOf(el) });
			return;
		}
		messageTarget.el = el;
		openPop({ kind: "message", turnKey: "", role: el.matches(".a") ? "assistant" : "user", anchor: anchorOf(el) });
	}
	addEventListener(
		"touchstart",
		(e) => {
			cancelLp();
			if (!isMobile() || e.touches.length !== 1 || useUi.getState().pop) return;
			const el = (e.target as Element).closest?.("[data-longpress]");
			if (!el || document.querySelector(".thread.selecting")?.contains(el)) return;
			const t = e.touches[0];
			lp = { el, x: t.clientX, y: t.clientY, timer: setTimeout(() => fire(el), 450) };
			if (!el.closest(".thread")) setTimeout(() => lp?.el === el && el.classList.add("lp"), 120);
		},
		{ passive: true },
	);
	addEventListener("touchmove", (e) => lp && Math.hypot(e.touches[0].clientX - lp.x, e.touches[0].clientY - lp.y) > 8 && cancelLp(), { passive: true });
	addEventListener("touchend", () => {
		cancelLp();
		if (lpHeld) ((lpHeld = false), (eatClickUntil = Date.now() + 300));
	});
	addEventListener("touchcancel", cancelLp);
	addEventListener("contextmenu", (e) => isMobile() && (e.target as Element).closest?.(".side, .crow, .thread") && e.preventDefault());
	document.addEventListener("click", (e) => Date.now() < eatClickUntil && (e.preventDefault(), e.stopPropagation()), true);
}

// ---------- notifications ----------
// A system notification whenever a pinned chat becomes ready (its agent stops working), unless you're already
// looking at it. Clicking it opens the chat. In the Mac app, the app raises pinned alerts itself.
function installNotifications() {
	const ask = () => useUi.getState().notify && "Notification" in window && Notification.permission === "default" && Notification.requestPermission();
	for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, ask, { once: true, capture: true });
	const wasWorking = new Set<string>();
	onBoard((b) => {
		for (const c of b.cards) {
			if (c.status === "working") {
				wasWorking.add(c.tab);
				continue;
			}
			if (!wasWorking.delete(c.tab) || !c.pinned) continue;
			if ((window as any).agDashApp?.pinnedAlerts || !useUi.getState().notify || !("Notification" in window) || Notification.permission !== "granted") continue;
			if (!document.hidden && document.hasFocus() && currentCard()?.tab === c.tab) continue;
			const n = new Notification(c.title || "Ag", { body: c.status === "blocked" ? "Needs your answer" : snippet(c) || "Ready", tag: c.tab, icon: "/static/icon-192.png" });
			n.onclick = () => (focus(), go(urlOf(c)), n.close());
		}
	});
}
