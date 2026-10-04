// Everything layered over the page: menus (popovers on a desktop, bottom sheets on a phone), search, the shortcuts
// sheet, the image viewer, toasts and the reconnecting pill. One at a time, closed by Esc, a click outside or
// navigating.
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ago, cleanJson, isWorking, lastAt, shortModel, snippet, tildify, urlOf } from "../lib/format";
import * as keys from "../lib/keys";
import type { Model } from "../lib/types";
import { archive, copyLink, markUnread, openInTmux, stop, switchModel, toggleModelPin, togglePin, toggleWaiting, rename } from "../state/actions";
import { useBoard, view } from "../state/board";
import { useCurrent } from "../state/current";
import { hold } from "../state/order";
import { go, isMobile, newChat, setTheme, toast, useUi, type Pop } from "../state/ui";
import { Icon } from "./Icon";
import { composer } from "./Composer";

export function Overlays() {
	return (
		<>
			<Popover />
			<SearchModal />
			<KeysModal />
			<Lightbox />
			<ToastView />
			<NetPill />
		</>
	);
}

// ---------- popover / sheet ----------
function Popover() {
	const pop = useUi((s) => s.pop);
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const mobile = isMobile();
	useEffect(() => {
		hold("menu", pop?.kind === "chat");
	}, [pop]);
	useLayoutEffect(() => {
		setPos(null);
		if (!pop || mobile || !ref.current) return;
		const a = pop.anchor;
		const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
		let x = pop.align === "right" ? a.right - w : a.left;
		let y = pop.above ? a.top - h - 6 : a.bottom + 6;
		if (y + h > innerHeight - 8) y = Math.max(8, a.top - h - 6);
		if (y < 8) y = 8;
		x = Math.max(8, Math.min(x, innerWidth - w - 8));
		setPos({ left: x, top: y });
	}, [pop, mobile]);
	// A click anywhere else closes it (the click still does what it does, like a native menu). A phone's sheet
	// has a backdrop that takes the tap instead, so the tap never lands on what's under it.
	useEffect(() => {
		if (!pop || mobile) return;
		const down = (e: PointerEvent) => {
			const t = e.target as Element;
			if (!ref.current?.contains(t) && !t.closest?.("[data-pop-toggle]")) useUi.setState({ pop: null });
		};
		const t = setTimeout(() => addEventListener("pointerdown", down, true), 0);
		return () => (clearTimeout(t), removeEventListener("pointerdown", down, true));
	}, [pop, mobile]);
	if (!pop) return null;
	const body = <PopBody pop={pop} />;
	if (mobile)
		return (
			<>
				<div className="sheet-back" onClick={() => useUi.setState({ pop: null })} />
				<Sheet>{body}</Sheet>
			</>
		);
	return (
		<div ref={ref} className="pop" role="menu" style={pos ? pos : { left: -9999, top: 0, visibility: "hidden" }}>
			{body}
		</div>
	);
}

// A bottom sheet follows the finger down and closes past ~80px.
function Sheet({ children }: { children: React.ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const g = useRef<{ y0: number | null; dy: number }>({ y0: null, dy: 0 });
	useEffect(() => {
		const el = ref.current!;
		const move = (e: TouchEvent) => {
			if (g.current.y0 == null) return;
			g.current.dy = Math.max(0, e.touches[0].clientY - g.current.y0);
			if (g.current.dy > 0) {
				e.preventDefault();
				el.style.transition = "none";
				el.style.transform = `translateY(${g.current.dy}px)`;
			}
		};
		el.addEventListener("touchmove", move, { passive: false });
		return () => el.removeEventListener("touchmove", move);
	}, []);
	return (
		<div
			ref={ref}
			className="pop sheet"
			role="menu"
			onTouchStart={(e) => (g.current = { y0: ref.current!.scrollTop <= 0 ? e.touches[0].clientY : null, dy: 0 })}
			onTouchEnd={() => {
				const el = ref.current!;
				if (g.current.y0 == null) return;
				g.current.y0 = null;
				el.style.transition = "transform .2s";
				if (g.current.dy > 80) {
					el.style.transform = "translateY(110%)";
					setTimeout(() => useUi.setState({ pop: null }), 180);
				} else el.style.transform = "";
			}}
		>
			{children}
		</div>
	);
}

function PopBody({ pop }: { pop: Pop }) {
	if (pop.kind === "chat") return <ChatMenu tab={pop.tab} full={pop.full} title={pop.title} />;
	if (pop.kind === "profile") return <ProfileMenu />;
	if (pop.kind === "picker") return <PickerMenu />;
	return <MessageMenu />;
}

const close = () => useUi.setState({ pop: null });
function MI({ icon, label, onClick, danger, pressed, t, msg }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void; danger?: boolean; pressed?: boolean; t?: string; msg?: string }) {
	return (
		<button className={`mi${danger ? " danger" : ""}`} role="menuitem" data-t={t} data-msg={msg} aria-pressed={pressed} onClick={onClick}>
			<Icon name={icon} />
			<span className="lbl">{label}</span>
			{pressed && <Icon name="check" />}
		</button>
	);
}

function ChatMenu({ tab, full, title }: { tab: string; full: boolean; title?: boolean }) {
	const c = useBoard((s) => view(s).byTab.get(tab));
	if (!c) return <div className="note">This chat is no longer open.</div>;
	const run = (f: () => unknown) => () => (close(), void f());
	const startRename = () => {
		const row = document.querySelector(`#side .item[data-tab="${CSS.escape(c.tab)}"]`);
		if (row && !useUi.getState().collapsed && !isMobile()) useUi.setState({ renaming: c.tab });
		else {
			const v = prompt("Rename", c.title)?.trim();
			if (v && v !== c.title) void rename(c, v);
		}
	};
	return (
		<>
			{title && <div className="ttl">{c.title}</div>}
			{full && c.sid && <MI icon="link" label="Copy link" t="chat-act-share" onClick={run(() => copyLink(c.sid))} />}
			<MI icon="pencil" label="Rename" t="chat-act-rename" onClick={run(startRename)} />
			<MI icon="pin" label={c.pinned ? "Unpin" : "Pin"} t="chat-act-pin" onClick={run(() => togglePin(c))} />
			<MI icon="hourglass" label={c.waiting?.length ? "Not waiting" : "Mark waiting for"} t="chat-act-waiting" onClick={run(() => toggleWaiting(c))} />
			<MI icon="unread" label="Mark as unread" t="chat-act-unread" onClick={run(() => markUnread(c))} />
			{full && (
				<>
					<hr />
					<MI icon="term" label="Open in tmux" t="chat-act-tmux" onClick={run(() => openInTmux(c))} />
					{isWorking(c) && <MI icon="stop" label="Stop" t="chat-act-stop" onClick={run(() => stop(c))} />}
				</>
			)}
			<hr />
			<MI icon="archive" label="Archive" danger t="chat-act-archive" onClick={run(() => archive(c))} />
		</>
	);
}

function ProfileMenu() {
	const sys = useBoard((s) => s.board?.sys);
	const cards = useBoard((s) => view(s).cards);
	const theme = useUi((s) => s.theme);
	const notify = useUi((s) => s.notify);
	const link = (href: string, icon: Parameters<typeof Icon>[0]["name"], label: string) => (
		<a className="mi" href={href} data-go={href}>
			<Icon name={icon} />
			<span className="lbl">{label}</span>
		</a>
	);
	const cua = sys?.cua;
	return (
		<>
			<div className="hdr">Account</div>
			{link("/chat?view=routines", "repeat", "Routines")}
			{link("/chat?view=rules", "keyboard", "ag-rules")}
			{link("/chat?view=archived", "archive", "Archived chats")}
			<MI icon="keyboard" label="Keyboard shortcuts" onClick={() => useUi.setState({ pop: null, modal: "keys" })} />
			{"Notification" in window && (
				<MI
					icon="bell"
					label="Notify when pinned chats are ready"
					pressed={notify}
					onClick={() => {
						const on = !notify;
						localStorage.setItem("agchat.notify", on ? "1" : "0");
						if (on && Notification.permission === "default") void Notification.requestPermission();
						useUi.setState({ notify: on, pop: null });
						toast(on ? "Notifications on" : "Notifications off");
					}}
				/>
			)}
			<hr />
			<div className="hdr">Theme</div>
			<MI icon="monitor" label="System" pressed={theme === "system"} onClick={() => setTheme("system")} />
			<MI icon="sun" label="Light" pressed={theme === "light"} onClick={() => setTheme("light")} />
			<MI icon="moon" label="Dark" pressed={theme === "dark"} onClick={() => setTheme("dark")} />
			<hr />
			<div className="note">
				{cards.length} chats · {cards.filter(isWorking).length} working
				{sys?.mem ? ` · ag-engine memory ${sys.mem.usedPct}% (${sys.mem.availGB} GB free)` : ""}
				{cua ? ` · ag-mac screen ${cua.live?.length ? "running" : "idle"}` : ""}
			</div>
		</>
	);
}

// The header's picker: this chat's model and thinking level (pi's /model and /thinking, this chat only) and its
// stats; on a new chat, the model it starts with. Pinned models (📌) sit on top; the rest fold under More models.
function PickerMenu() {
	const c = useCurrent();
	const cfg = useUi((s) => s.config);
	const info = useUi((s) => (s.route.kind === "chat" && s.route.sid ? s.sessions[s.route.sid] : undefined));
	const models = cfg?.models ?? [];
	if (!c && !info) {
		const cur = newChatModel();
		return (
			<>
				{models.length ? <ModelRows cur={cur} onPick={(m) => useUi.setState({ newModel: m.id, pop: null })} /> : <div className="hdr">Ag</div>}
				<hr />
				<div className="note">New chats show in your Inbox until you reply.</div>
			</>
		);
	}
	const s = c ? c.stats : info?.stats;
	const started = c ? c.startedAt : info?.startedAt;
	const rows: [string, string | undefined][] = [
		["Model", c ? c.model : info?.model],
		["Thinking", c?.thinkingLevel],
		["Folder", tildify(c ? c.cwd : info?.cwd)],
		["Context", s?.ctx ? `${Math.round(s.ctx / 1000)}k tokens` : ""],
		["Cost", s?.cost ? `$${s.cost.toFixed(2)}` : ""],
		["Turns", s?.turns ? `${s.turns} prompts · ${s.tools} tool calls` : ""],
		["Started", started ? new Date(started).toLocaleString() : ""],
	];
	const shown = rows.filter((r) => r[1] && !(c && models.length && (r[0] === "Model" || r[0] === "Thinking")));
	const curM = c && models.find((m) => m.name === c.model || m.id === c.model || m.id.endsWith(`/${c.model}`));
	return (
		<>
			{c && models.length > 0 && (
				<>
					<ModelRows cur={curM ?? null} onPick={(m) => (m === curM ? close() : void switchModel(c, { model: m.id }))} />
					<div className="hdr">Thinking</div>
					<div className="chips">
						{["off", "low", "medium", "high", "xhigh"].map((l) => (
							<button key={l} className="chip" data-t="chat-thinking" aria-pressed={c.thinkingLevel === l} onClick={() => (c.thinkingLevel === l ? close() : void switchModel(c, { thinking: l }))}>
								{l}
							</button>
						))}
					</div>
					<hr />
				</>
			)}
			<div className="hdr">This chat</div>
			<div className="kv">
				{shown.map(([k, v]) => (
					<Fragment key={k}>
						<span>{k}</span>
						<span title={v}>{v}</span>
					</Fragment>
				))}
			</div>
		</>
	);
}

export function newChatModel(): Model | null {
	const { config: cfg, newModel } = useUi.getState();
	if (!cfg) return null;
	return [newModel, cfg.pinnedModels[0], cfg.defaultModel].map((id) => cfg.models.find((m) => m.id === id)).find(Boolean) ?? null;
}

function ModelRows({ cur, onPick }: { cur: Model | null; onPick: (m: Model) => void }) {
	const cfg = useUi((s) => s.config)!;
	const more = useUi((s) => s.modelsMore);
	const pinnedM = cfg.pinnedModels.map((id) => cfg.models.find((m) => m.id === id)).filter(Boolean) as Model[];
	const top = pinnedM.length ? [...pinnedM, ...(cur && !pinnedM.includes(cur) ? [cur] : [])] : cfg.models;
	const rest = cfg.models.filter((m) => !top.includes(m));
	const row = (m: Model) => {
		const on = cfg.pinnedModels.includes(m.id);
		return (
			<div className="mrow" key={m.id}>
				<button className="mi" data-t="chat-model" aria-pressed={m === cur} onClick={() => onPick(m)}>
					<Icon name="sparkle" />
					<span className="lbl">{shortModel(m.name)}</span>
					{m === cur && <Icon name="check" />}
				</button>
				<button className="mpin" aria-pressed={on} title={on ? "Unpin" : "Pin to top"} aria-label={`${on ? "Unpin" : "Pin"} ${shortModel(m.name)}`} data-t="chat-model-pin" onClick={() => toggleModelPin(m.id)}>
					<Icon name="pin" />
				</button>
			</div>
		);
	};
	return (
		<>
			<div className="hdr">Model</div>
			{top.map(row)}
			{rest.length > 0 && (
				<>
					<button className="mi more-models" aria-expanded={more} onClick={() => useUi.setState({ modelsMore: !more })}>
						<Icon name="chevdown" />
						<span className="lbl">More models</span>
						<span className="n">{rest.length}</span>
					</button>
					{more && rest.map(row)}
				</>
			)}
		</>
	);
}

// Long-press on a message (phone): Copy / Select text / Read aloud / Edit.
export const messageTarget: { el: Element | null } = { el: null };
function MessageMenu() {
	const el = messageTarget.el;
	if (!el) return null;
	const isAnswer = el.matches(".a");
	const box = el.querySelector(isAnswer ? ".md" : ".bubble") as HTMLElement | null;
	const text = box?.innerText ?? "";
	return (
		<>
			<MI icon="copy" label="Copy" msg="copy" onClick={() => (close(), void navigator.clipboard.writeText(text).then(() => toast("Copied")))} />
			<MI
				icon="cursor"
				label="Select text"
				msg="select"
				onClick={() => {
					close();
					const th = el.closest(".thread");
					th?.classList.add("selecting");
					const r = document.createRange();
					if (box) r.selectNodeContents(box);
					const sel = getSelection()!;
					sel.removeAllRanges();
					sel.addRange(r);
					toast("Tap anywhere else to finish");
					setTimeout(
						() =>
							document.addEventListener(
								"touchstart",
								(e) => {
									if (!box?.contains(e.target as Node)) (th?.classList.remove("selecting"), getSelection()?.removeAllRanges());
								},
								{ once: true },
							),
						300,
					);
				}}
			/>
			{isAnswer && <MI icon="speaker" label="Read aloud" msg="speak" onClick={() => (close(), (el.querySelector("[data-speak]") as HTMLElement | null)?.click())} />}
			{!isAnswer && <MI icon="pencil" label="Edit message" msg="edit" onClick={() => (close(), composer.setText(text))} />}
		</>
	);
}

// ---------- search (⌘K) ----------
type SItem = { key: string; run: () => void; keep?: boolean; node: React.ReactNode };
function hl(s: string, q: string) {
	if (!q) return s;
	const i = s.toLowerCase().indexOf(q.toLowerCase());
	return i < 0 ? s : (
		<>
			{s.slice(0, i)}
			<mark>{s.slice(i, i + q.length)}</mark>
			{s.slice(i + q.length)}
		</>
	);
}
function SearchModal() {
	const open = useUi((s) => s.modal === "search");
	if (!open) return null;
	return <Search />;
}
function Search() {
	const [q, setQ] = useState("");
	const [sel, setSel] = useState(0);
	const [deep, setDeep] = useState<{ q: string; loading?: boolean; error?: string; results?: any[] } | null>(null);
	const sorted = useBoard((s) => view(s).sorted);
	const listRef = useRef<HTMLDivElement>(null);
	const qt = q.trim(), ql = qt.toLowerCase();
	const items: SItem[] = [];
	const groups: React.ReactNode[] = [];
	const add = (it: SItem) => items.push(it);
	add({
		key: "new",
		run: newChat,
		node: (
			<>
				<Icon name="compose" />
				<span className="txt">
					<span className="t">New chat</span>
				</span>
			</>
		),
	});
	let cards = sorted;
	if (qt) cards = cards.filter((c) => `${c.title} ${c.first || ""} ${c.lastUser?.text || ""} ${c.lastAssistant?.text || ""}`.toLowerCase().includes(ql));
	const now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	let grp = "";
	for (const c of cards.slice(0, 60)) {
		const t = lastAt(c);
		const g = t >= day0 ? "Today" : t >= day0 - 864e5 ? "Yesterday" : t >= day0 - 7 * 864e5 ? "Previous 7 days" : "Older";
		if (g !== grp) groups[items.length] = <div className="sgrp" key={`g:${g}`}>{g}</div>;
		grp = g;
		const hay = [c.lastAssistant?.text, c.lastUser?.text, c.first].find((s) => qt && s?.toLowerCase().includes(ql)) || snippet(c);
		let sn = String(hay).replace(/\s+/g, " ");
		const at = qt ? sn.toLowerCase().indexOf(ql) : -1;
		if (at > 40) sn = `…${sn.slice(at - 30)}`;
		add({
			key: c.tab,
			run: () => go(urlOf(c)),
			node: (
				<>
					<Icon name="chat" />
					<span className="txt">
						<span className="t">{hl(c.title, qt)}</span>
						<span className="s">{hl(sn.slice(0, 140), qt)}</span>
					</span>
					<span className="d">{ago(t)}</span>
				</>
			),
		});
	}
	const deepAt = items.length;
	let deepNote: React.ReactNode = null;
	if (qt) {
		if (!deep || deep.q !== qt)
			add({
				key: "deep",
				keep: true,
				run: () => void deepSearch(qt),
				node: (
					<>
						<Icon name="sparkle" />
						<span className="txt">
							<span className="t">Search everything for “{qt}”</span>
							<span className="s">An AI search over every session, open or closed (takes a few seconds)</span>
						</span>
					</>
				),
			});
		else if (deep.loading)
			deepNote = (
				<div className="sr">
					<span className="spin" />
					<span className="txt">
						<span className="t">Searching all sessions…</span>
					</span>
				</div>
			);
		else if (deep.error)
			deepNote = (
				<div className="sr">
					<span className="txt">
						<span className="s">{deep.error}</span>
					</span>
				</div>
			);
		else
			for (const r of deep.results ?? [])
				add({
					key: `d:${r.sid}`,
					run: () => go(`/chat/${r.sid}`),
					node: (
						<>
							<Icon name="chat" />
							<span className="txt">
								<span className="t">{r.title}</span>
								<span className="s">
									{r.state} · {r.why || ""}
								</span>
							</span>
							<span className="d">{ago((r.last || 0) * 1000)}</span>
						</>
					),
				});
	}
	async function deepSearch(text: string) {
		setDeep({ q: text, loading: true });
		try {
			const r = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) });
			const j = await cleanJson(r);
			if (!r.ok || j.ok === false) throw new Error(j.error || r.status);
			setDeep({ q: text, results: j.results || [], error: j.results?.length ? undefined : "Nothing found." });
		} catch (e: any) {
			setDeep({ q: text, error: `Search failed: ${e.message}` });
		}
	}
	const cur = Math.min(qt && items.length > 1 && sel === 0 ? 1 : sel, items.length - 1);
	useEffect(() => {
		listRef.current?.querySelector(".sr.sel")?.scrollIntoView({ block: "nearest" });
	}, [cur]);
	const pick = (it: SItem) => {
		if (!it.keep) useUi.setState({ modal: null });
		it.run();
	};
	return (
		<div className="back open" onClick={(e) => e.target === e.currentTarget && useUi.setState({ modal: null })}>
			<div className="modal" role="dialog" aria-label="Search chats">
				<div className="modal-h">
					<input
						autoFocus
						placeholder="Search chats..."
						autoComplete="off"
						value={q}
						onChange={(e) => (setQ(e.target.value), setSel(0))}
						onKeyDown={(e) => {
							if (e.key === "ArrowDown") (e.preventDefault(), setSel(Math.min(items.length - 1, cur + 1)));
							else if (e.key === "ArrowUp") (e.preventDefault(), setSel(Math.max(0, cur - 1)));
							else if (e.key === "Enter") (e.preventDefault(), items[cur] && pick(items[cur]));
						}}
					/>
					<button className="ib" data-do="closeModal" onClick={() => useUi.setState({ modal: null })} aria-label="Close">
						<Icon name="x" />
					</button>
				</div>
				<div className="modal-b" ref={listRef}>
					{items.map((it, i) => (
						<Fragment key={it.key}>
							{groups[i]}
							{i === deepAt && qt && <div className="sgrp">All sessions, including closed ones</div>}
							<button className={`sr${i === cur ? " sel" : ""}`} onClick={() => pick(it)} onPointerMove={() => i !== cur && setSel(i)}>
								{it.node}
							</button>
						</Fragment>
					))}
					{deepAt === items.length && qt && <div className="sgrp">All sessions, including closed ones</div>}
					{deepNote}
				</div>
			</div>
		</div>
	);
}

function KeysModal() {
	const open = useUi((s) => s.modal === "keys");
	if (!open) return null;
	let group: string | undefined;
	return (
		<div className="back open" onClick={(e) => e.target === e.currentTarget && useUi.setState({ modal: null })}>
			<div className="modal" role="dialog" aria-label="Keyboard shortcuts">
				<div className="modal-h">
					<h3>Keyboard shortcuts</h3>
					<button className="ib" onClick={() => useUi.setState({ modal: null })} aria-label="Close">
						<Icon name="x" />
					</button>
				</div>
				<div className="modal-b">
					<table className="keys-tbl">
						<tbody>
							{keys.all().filter((b) => b.label).map((b, i) => {
								const head = b.group && b.group !== group ? ((group = b.group), b.group) : null;
								return (
									<KeyRow key={i} head={head} label={b.label!} combos={([] as string[]).concat(b.keys)} note={b.note} />
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
function KeyRow({ head, label, combos, note }: { head: string | null; label: string; combos: string[]; note?: string }) {
	return (
		<>
			{head && (
				<tr>
					<td colSpan={2} className="keyhdr">
						{head}
					</td>
				</tr>
			)}
			<tr>
				<td>{label}</td>
				<td>
					{combos.map((k, i) => (
						<span key={i}>
							{i > 0 && " "}
							{keys.caps(k).map((c, j) => (
								<kbd key={j}>{c}</kbd>
							))}
						</span>
					))}
					{note && ` · ${note}`}
				</td>
			</tr>
		</>
	);
}

function Lightbox() {
	const lb = useUi((s) => s.lightbox);
	if (!lb) return null;
	return (
		<div className="lightbox open" onClick={(e) => (e.target as Element).tagName !== "VIDEO" && useUi.setState({ lightbox: null })}>
			{lb.video ? <video src={lb.src} controls autoPlay /> : <img src={lb.src} alt="" />}
		</div>
	);
}

function ToastView() {
	const t = useUi((s) => s.toast);
	const [shown, setShown] = useState(t);
	useEffect(() => {
		if (t) setShown(t);
	}, [t]);
	return (
		<div className={`toast${t ? " show" : ""}`} role="status">
			{shown?.msg}
			{shown?.action && (
				<button
					onClick={() => {
						useUi.setState({ toast: null });
						shown.action!.run();
					}}
				>
					{shown.action.label}
				</button>
			)}
		</div>
	);
}

function NetPill() {
	const on = useUi((s) => s.netPill);
	return on ? (
		<div className="net" role="status">
			Reconnecting to Ag…
		</div>
	) : null;
}
