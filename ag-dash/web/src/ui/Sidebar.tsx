// The sidebar: New chat, Search, the four views with their counts, then Pinned and Chats (drag a chat onto Pinned
// to pin it, back onto Chats to unpin it). The chat list is virtualized (only the rows on screen exist) and its
// order holds still under the pointer (state/order.ts).
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isWaiting, isWorking, needsYou, refOf, urlOf } from "../lib/format";
import type { Card } from "../lib/types";
import { archive, rename, setPinned } from "../state/actions";
import { useBoard, view } from "../state/board";
import { hold, useSections } from "../state/order";
import { warm } from "../state/tx";
import { anchorOf, go, isMobile, newChat, openPop, pointAnchor, setCollapsed, toggleSec, useUi, type ListView } from "../state/ui";
import { Icon } from "./Icon";

const TOUCH = matchMedia("(hover: none)").matches;

export function Sidebar() {
	const collapsed = useUi((s) => s.collapsed);
	return (
		<>
			<Rail />
			<aside className="side" id="side" aria-label="Sidebar">
				<div className="side-head">
					<a className="logo" href="/chat" data-go="/chat" title="New chat" aria-label="Ag">
						<img src="/static/icon.svg" alt="" />
					</a>
					<button className="ib" data-do="toggle" onClick={() => setCollapsed(true)} title="Close sidebar (⇧⌘S)" aria-label="Close sidebar">
						<Icon name="sidebar" />
					</button>
					<button className="msearch" onClick={() => useUi.setState({ modal: "search", pop: null })} aria-label="Search chats">
						<Icon name="search" />
						<span>Search</span>
					</button>
					<button className="ib mobile-only" onClick={newChat} aria-label="New chat">
						<Icon name="compose" />
					</button>
				</div>
				<Nav />
				{!collapsed || isMobile() ? <ChatList /> : <div className="side-scroll" id="sideScroll" />}
				<Profile />
			</aside>
			<div className="scrim" onClick={() => setCollapsed(true, false)} />
		</>
	);
}

function Rail() {
	return (
		<div className="rail">
			<div className="side-head">
				<button className="logo" onClick={() => setCollapsed(false)} title="Open sidebar (⇧⌘S)" aria-label="Open sidebar">
					<img src="/static/icon.svg" alt="" />
					<span className="tog">
						<Icon name="sidebar" />
					</span>
				</button>
			</div>
			<button className="ib" onClick={newChat} title="New chat (⇧⌘O)" aria-label="New chat">
				<Icon name="compose" />
			</button>
			<button className="ib" onClick={() => useUi.setState({ modal: "search" })} title="Search chats (⌘K)" aria-label="Search chats">
				<Icon name="search" />
			</button>
			<a className="ib" href="/chat?view=inbox" data-go="/chat?view=inbox" title="Inbox" aria-label="Inbox">
				<Icon name="inbox" />
			</a>
			<a className="ib" href="/chat?view=you" data-go="/chat?view=you" title="Needs you" aria-label="Needs you">
				<Icon name="bell" />
			</a>
			<span className="grow" />
			<ProfileButton className="avatar" />
		</div>
	);
}

const NAV: { view: ListView; label: string; icon: "inbox" | "bell" | "bolt" | "clock"; count: (c: Card) => boolean }[] = [
	{ view: "inbox", label: "Inbox", icon: "inbox", count: (c) => c.inbox },
	{ view: "you", label: "Needs you", icon: "bell", count: needsYou },
	{ view: "working", label: "Working", icon: "bolt", count: isWorking },
	{ view: "waiting", label: "Waiting for", icon: "clock", count: isWaiting },
];
function Nav() {
	const cards = useBoard((s) => view(s).cards);
	const route = useUi((s) => s.route);
	return (
		<nav className="nav">
			<button className="row" onClick={newChat} data-t="chat-new">
				<Icon name="compose" />
				<span className="lbl">New chat</span>
				<kbd>⇧⌘O</kbd>
			</button>
			<button className="row" onClick={() => useUi.setState({ modal: "search", pop: null })} data-t="chat-search">
				<Icon name="search" />
				<span className="lbl">Search chats</span>
				<kbd>⌘K</kbd>
			</button>
			{NAV.map((n) => {
				const count = cards.filter(n.count).length;
				return (
					<a key={n.view} className="row" href={`/chat?view=${n.view}`} data-go={`/chat?view=${n.view}`} aria-current={route.kind === "list" && route.view === n.view ? "page" : undefined}>
						<Icon name={n.icon} />
						<span className="lbl">{n.label}</span>
						{count > 0 && <span className={`badge${n.view === "you" ? " hot" : ""}`}>{count}</span>}
					</a>
				);
			})}
		</nav>
	);
}

type Row = { kind: "sec"; id: "pinned" | "chats"; title: string } | { kind: "item"; card: Card; sec: "pinned" | "chats" } | { kind: "empty" };

function ChatList() {
	const { pinned, rest } = useSections();
	const secClosed = useUi((s) => s.secClosed);
	const route = useUi((s) => s.route);
	const sel = useBoard((s) => (route.kind === "chat" ? (route.sid ? view(s).bySid.get(route.sid) : view(s).byTab.get(route.tab ?? ""))?.tab : undefined));
	const scrollRef = useRef<HTMLDivElement>(null);
	const [drop, setDrop] = useState<"pinned" | "chats" | null>(null);
	const dragging = useRef<string | null>(null);

	const rows: Row[] = [];
	if (pinned.length) {
		rows.push({ kind: "sec", id: "pinned", title: "Pinned" });
		if (!secClosed.pinned) for (const card of pinned) rows.push({ kind: "item", card, sec: "pinned" });
	}
	rows.push({ kind: "sec", id: "chats", title: "Chats" });
	if (!secClosed.chats) for (const card of rest) rows.push({ kind: "item", card, sec: "chats" });
	if (!rest.length) rows.push({ kind: "empty" });

	const mobile = isMobile();
	const v = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (i) => (rows[i].kind === "sec" ? (mobile ? 50 : 44) : mobile ? 44 : 36),
		getItemKey: (i) => (rows[i].kind === "item" ? (rows[i] as any).card.tab : rows[i].kind === "sec" ? `sec:${(rows[i] as any).id}` : "empty"),
		overscan: 12,
	});

	// When the open chat changes, bring its row into view; later updates leave the scroll alone.
	const lastSel = useRef<string | undefined>(undefined);
	useLayoutEffect(() => {
		if (!sel || sel === lastSel.current) return;
		const i = rows.findIndex((r) => r.kind === "item" && r.card.tab === sel);
		if (i < 0) return;
		lastSel.current = sel;
		v.scrollToIndex(i, { align: "auto" });
	});

	// Fetch the top of the list ahead, so opening one paints at once.
	const top = rows
		.filter((r): r is Extract<Row, { kind: "item" }> => r.kind === "item")
		.slice(0, 15)
		.map((r) => refOf(r.card))
		.join(",");
	useEffect(() => {
		const t = setTimeout(() => top && top.split(",").forEach((ref) => warm(ref)), 800);
		return () => clearTimeout(t);
	}, [top]);

	const secOf = (el: EventTarget | null) => (el as HTMLElement | null)?.closest?.("[data-sec]")?.getAttribute("data-sec") as "pinned" | "chats" | null;
	return (
		<div
			className="side-scroll"
			id="sideScroll"
			ref={scrollRef}
			onPointerEnter={(e) => e.pointerType === "mouse" && hold("pointer", true)}
			onPointerLeave={(e) => e.pointerType === "mouse" && hold("pointer", false)}
			onDragOver={(e) => {
				const tab = dragging.current;
				const c = tab && view().byTab.get(tab);
				const s = secOf(e.target);
				const ok = c && ((s === "pinned" && !c.pinned) || (s === "chats" && c.pinned));
				if (ok) e.preventDefault();
				setDrop(ok ? s : null);
			}}
			onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}
			onDrop={(e) => {
				e.preventDefault();
				const c = dragging.current && view().byTab.get(dragging.current);
				if (c && drop) void setPinned(c, drop === "pinned");
				setDrop(null);
			}}
		>
			<div style={{ height: v.getTotalSize(), position: "relative" }}>
				{v.getVirtualItems().map((vi) => {
					const r = rows[vi.index];
					const sec = r.kind === "sec" ? r.id : r.kind === "item" ? r.sec : "chats";
					return (
						<div
							key={vi.key}
							data-index={vi.index}
							data-sec={sec}
							ref={v.measureElement}
							className={drop === sec ? "vrow drop" : "vrow"}
							style={{ transform: `translateY(${vi.start}px)` }}
						>
							{r.kind === "sec" ? (
								<div className={`sec${secClosed[r.id] ? " closed" : ""}`}>
									<div className="sec-hw">
										<button className="sec-h" onClick={() => toggleSec(r.id)}>
											{r.title}
											<Icon name="chevdown" />
										</button>
									</div>
								</div>
							) : r.kind === "item" ? (
								<ChatRow
									card={r.card}
									selected={r.card.tab === sel}
									onDragStart={(tab) => ((dragging.current = tab), hold("drag", true))}
									onDragEnd={() => ((dragging.current = null), hold("drag", false), setDrop(null))}
								/>
							) : (
								<div className="empty-list">No chats yet.</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ChatRow({ card: c, selected, onDragStart, onDragEnd }: { card: Card; selected: boolean; onDragStart: (tab: string) => void; onDragEnd: () => void }) {
	const renaming = useUi((s) => s.renaming === c.tab);
	const menuOpen = useUi((s) => s.pop?.kind === "chat" && s.pop.tab === c.tab && !s.pop.full);
	const [dragged, setDragged] = useState(false);
	const ind =
		c.status === "working" ? <span className="spin" title="Working" /> : c.status === "blocked" ? <span className="dot blocked" title="Asking something" /> : isWaiting(c) ? <span className="dot waiting" title="Waiting for something" /> : c.needsYou ? <span className="dot unread" title="New answer" /> : null;
	const menu = (anchor: ReturnType<typeof anchorOf>) => openPop({ kind: "chat", tab: c.tab, full: false, anchor, title: isMobile() });
	return (
		<a
			className={`row item${menuOpen ? " menu-open" : ""}${renaming ? " editing" : ""}${dragged ? " dragged" : ""}`}
			href={urlOf(c)}
			data-tab={c.tab}
			draggable={!TOUCH && !renaming}
			aria-current={selected ? "page" : undefined}
			title={c.title}
			onClick={(e) => {
				if (renaming || e.metaKey || e.ctrlKey || e.shiftKey) return;
				e.preventDefault();
				go(urlOf(c));
			}}
			onPointerEnter={() => warm(refOf(c), 3000)}
			onContextMenu={(e) => {
				if (e.shiftKey || isMobile()) return;
				e.preventDefault();
				menu(pointAnchor(e.clientX, e.clientY));
			}}
			onDragStart={(e) => {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", c.title);
				useUi.setState({ pop: null });
				onDragStart(c.tab);
				requestAnimationFrame(() => setDragged(true));
			}}
			onDragEnd={() => (setDragged(false), onDragEnd())}
			data-longpress="chat"
		>
			{renaming ? <RenameField card={c} /> : <span className="lbl">{c.title}</span>}
			<span className="ind">{ind}</span>
			<button
				className="arch"
				title="Archive"
				aria-label="Archive chat"
				data-t="chat-item-archive"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					archive(c);
				}}
			>
				<Icon name="archive" />
			</button>
			<button
				className="more"
				aria-label="Options"
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (menuOpen) useUi.setState({ pop: null });
					else menu(anchorOf(e.currentTarget));
				}}
			>
				<Icon name="dots" />
			</button>
		</a>
	);
}

// Inline rename, like ChatGPT: the row's label turns into a text field (Enter or clicking away saves, Esc cancels).
function RenameField({ card: c }: { card: Card }) {
	const ref = useRef<HTMLInputElement>(null);
	const done = useRef(false);
	useEffect(() => {
		hold("rename", true);
		ref.current?.focus();
		ref.current?.select();
		return () => hold("rename", false);
	}, []);
	const finish = (save: boolean) => {
		if (done.current) return;
		done.current = true;
		const v = ref.current?.value.trim() ?? "";
		useUi.setState({ renaming: null });
		if (save && v && v !== c.title) void rename(c, v);
	};
	return (
		<input
			ref={ref}
			className="rename"
			defaultValue={c.title}
			aria-label="New name"
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter") (e.preventDefault(), finish(true));
				if (e.key === "Escape") finish(false);
			}}
			onBlur={() => finish(true)}
			onClick={(e) => (e.preventDefault(), e.stopPropagation())}
			onMouseDown={(e) => e.stopPropagation()}
		/>
	);
}

function Profile() {
	const name = useUi((s) => s.config?.userName) || "You";
	const mem = useBoard((s) => s.board?.sys?.mem);
	const color = mem?.level === "bad" ? "var(--red)" : mem?.level === "warn" ? "var(--amber)" : undefined;
	return (
		<div className="side-foot">
			<ProfileButton className="row profile">
				<span className="who">
					<b>{name}</b>
					{mem && (
						<span
							style={color ? { color } : undefined}
							title={`ag-engine memory: ${mem.usedPct}% of ${mem.totalGB} GB used, ${mem.availGB} GB free, swap ${mem.swapUsedGB}/${mem.swapTotalGB} GB, pressure ${mem.psiSome}%/${mem.psiFull}%`}
						>
							engine mem {mem.usedPct}%
						</span>
					)}
				</span>
			</ProfileButton>
		</div>
	);
}
function ProfileButton({ className, children }: { className: string; children?: React.ReactNode }) {
	const name = useUi((s) => s.config?.userName) || "";
	const open = useUi((s) => s.pop?.kind === "profile");
	const avatar = <span className="avatar">{(name || "U").charAt(0).toUpperCase()}</span>;
	return (
		<button
			className={className === "avatar" ? "avatar" : className}
			aria-label="Menu"
			data-t="chat-profile"
			data-pop-toggle
			onClick={(e) => (open ? useUi.setState({ pop: null }) : openPop({ kind: "profile", anchor: anchorOf(e.currentTarget), above: true }))}
		>
			{className === "avatar" ? (name || "U").charAt(0).toUpperCase() : avatar}
			{children}
		</button>
	);
}
