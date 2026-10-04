// The main column: the header, and the page for the route (a chat, a new chat, a list, Routines, ag-rules).
import { useEffect, useRef, useState } from "react";
import { ago, cleanJson, draftKeyOf, dur, isWaiting, isWorking, lastAt, needsYou, refOf, shortModel, sigOf, snippet, urlOf } from "../lib/format";
import type { Card, SessionInfo } from "../lib/types";
import { copyLink, markSeen, resume, sendKey } from "../state/actions";
import { useBoard, view } from "../state/board";
import { resolve, useCurrent } from "../state/current";
import { saveDraftText } from "../state/drafts";
import { queue, settleSent, useOutbox } from "../state/outbox";
import { hydrate, load, loadOlder, setOpenRef, trim, useEntry } from "../state/tx";
import { anchorOf, go, newChat, openPop, setCollapsed, toast, useUi, type ListView } from "../state/ui";
import { Composer } from "./Composer";
import { Icon } from "./Icon";
import { newChatModel } from "./Overlays";
import { Thread, useTurns } from "./Thread";
import { useStickyScroll } from "./useScroll";

export function Main() {
	const route = useUi((s) => s.route);
	return (
		<main className="main" id="main">
			<Header />
			<div id="view" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
				{route.kind === "new" ? <NewChat /> : route.kind === "chat" ? <ChatRoute /> : route.kind === "list" ? <ListPage view={route.view} /> : route.kind === "routines" ? <Routines /> : <Rules />}
			</div>
		</main>
	);
}

function Header() {
	const route = useUi((s) => s.route);
	const c = useCurrent();
	const cfg = useUi((s) => s.config);
	const newModel = useUi((s) => s.newModel);
	const pickerOpen = useUi((s) => s.pop?.kind === "picker");
	const dotsOpen = useUi((s) => s.pop?.kind === "chat" && s.pop.full);
	const sid = c?.sid ?? (route.kind === "chat" ? route.sid : undefined);
	const info = useUi((s) => (route.kind === "chat" && route.sid && !c ? s.sessions[route.sid] : undefined));
	void newModel; // the new-chat model shows in the picker
	const m = c ? shortModel(c.model) : info ? shortModel(info.model) : route.kind === "new" && cfg ? shortModel(newChatModel()?.name) : "";
	return (
		<header className="top">
			<button className="ib mobile-only" data-do="toggle" onClick={() => setCollapsed(false, false)} aria-label="Open sidebar">
				<Icon name="menu" />
			</button>
			<button
				className={`picker${m ? " has-model" : ""}`}
				id="picker"
				data-t="chat-picker"
				data-pop-toggle
				onClick={(e) => (pickerOpen ? useUi.setState({ pop: null }) : openPop({ kind: "picker", anchor: anchorOf(e.currentTarget) }))}
			>
				<span>Ag</span>
				<span className="m">{m}</span>
				<Icon name="chevdown" />
			</button>
			<span className="grow l" />
			{sid && (
				<button className="share desk-only" data-t="chat-share" onClick={() => copyLink(sid)}>
					<Icon name="share" />
					Share
				</button>
			)}
			{c && (
				<button
					className="ib"
					id="dotsBtn"
					aria-label="Chat options"
					data-pop-toggle
					onClick={(e) => (dotsOpen ? useUi.setState({ pop: null }) : openPop({ kind: "chat", tab: c.tab, full: true, anchor: anchorOf(e.currentTarget), align: "right" }))}
				>
					<Icon name="dots" />
				</button>
			)}
			<button className="ib mobile-only" onClick={newChat} aria-label="New chat">
				<Icon name="compose" />
			</button>
		</header>
	);
}

// ---------- new chat ----------
const HELLOS = ["What's on the agenda today?", "Where should we begin?", "What are you working on?", "What can I take off your plate?", "Ready when you are."];
const hello = HELLOS[Math.floor(Math.random() * HELLOS.length)];
function NewChat() {
	const starting = useUi((s) => s.starting);
	if (starting)
		return (
			<div className="scroll">
				<div className="thread">
					{starting.text && (
						<div className="u">
							<div className="bubble">{starting.text}</div>
						</div>
					)}
					<div className="live">
						<span className="orb" />
						<span className="shimmer">{starting.failed ? "Can't reach Ag right now. This chat starts as soon as it's back…" : "Starting a new chat…"}</span>
					</div>
				</div>
			</div>
		);
	return (
		<div className="hero">
			<h1>{hello}</h1>
			<Composer draftKey="new" onNew={startChat} note="New chats open in your Inbox." />
		</div>
	);
}

// A new chat goes through the outbox (so it survives ag-dash being out of reach); with a recording it's sent
// directly. The page moves to the chat once the board has it (App watches startingTab).
export async function startChat(text: string, audio?: Blob) {
	const model = newChatModel()?.id;
	const id = crypto.randomUUID?.() ?? String(Date.now());
	useUi.setState({ starting: { id, text } });
	if (!audio) {
		queue({ kind: "new", id, text, model });
		return;
	}
	const fd = new FormData();
	if (text) fd.append("text", text);
	fd.append("audio", audio, "dictation.webm");
	fd.append("route", "new");
	if (model) fd.append("model", model);
	try {
		const r = await fetch("/api/new", { method: "POST", body: fd });
		const j = await r.json();
		if (!j.ok) throw new Error(j.error || r.status);
		started(id, j.tab);
	} catch (e: any) {
		saveDraftText("new", text, true); // the typed part comes back in the box
		useUi.setState({ starting: null });
		toast(`Couldn't start: ${e.message}`);
	}
}
export function started(id: string, tab?: string | null) {
	const here = useUi.getState().starting?.id === id && useUi.getState().route.kind === "new";
	if (useUi.getState().starting?.id === id) useUi.setState({ starting: null });
	if (!tab) {
		toast("Sent to your Inbox");
		return;
	}
	const c = view().byTab.get(tab);
	if (!here) {
		toast("New chat started", c ? { label: "Open", run: () => go(urlOf(c)) } : undefined, 5000);
		return;
	}
	if (c) go(urlOf(c));
	else useUi.setState({ startingTab: tab, starting: { id, text: "" } });
}

// ---------- a chat ----------
function ChatRoute() {
	const route = useUi((s) => s.route);
	const fresh = useBoard((s) => s.fresh);
	const c = useBoard((s) => resolve(route, view(s)));
	// A tab link to a chat that has a session id moves to its stable URL.
	useEffect(() => {
		if (route.kind === "chat" && route.tab && c?.sid) history.replaceState({}, "", urlOf(c));
	}, [route, c?.sid]);
	if (c) return <ChatView key={c.sid ?? c.tab} card={c} />;
	if (route.kind === "chat" && route.sid) return <SessionView key={route.sid} sid={route.sid} />;
	return fresh ? (
		<div className="hero">
			<h1>This chat is no longer open.</h1>
			<button className="pill" onClick={() => go("/chat")}>
				New chat
			</button>
		</div>
	) : (
		<Loading />
	);
}
const Loading = ({ text = "Loading…" }: { text?: string }) => (
	<div className="scroll">
		<div className="thread">
			<div className="live">
				<span className="orb" />
				<span className="shimmer">{text}</span>
			</div>
		</div>
	</div>
);

function ChatView({ card: c }: { card: Card }) {
	const ref = refOf(c);
	const entry = useEntry(ref);
	const sig = sigOf(c);
	const visible = usePageVisible();

	useEffect(() => {
		setOpenRef(ref);
		void hydrate(ref);
		trim(ref); // a chat opens at the bottom: back to the newest page if older ones were loaded last time
		return () => setOpenRef(null);
	}, [ref]);

	// Opening it, or looking at it when a new answer arrives (the page in front and focused), means you've seen it.
	const opened = useRef(false);
	useEffect(() => {
		// Never while the page is hidden (a background tab, the Mac app's closed window reloading onto a new build).
		const f = () => c.needsYou && !document.hidden && (!opened.current || document.hasFocus()) && void markSeen(c);
		f();
		opened.current = true;
		addEventListener("focus", f);
		return () => removeEventListener("focus", f);
	}, [c, visible]);
	// Sent replies leave once they're in the transcript.
	useEffect(() => {
		settleSent(
			c.tab,
			entry.items.filter((x) => x.role === "user").slice(-5).map((x) => x.text.trim()),
		);
	}, [entry.items, c.tab]);

	const turns = useTurns(entry.items, isWorking(c));
	const sc = useStickyScroll(ref, { onTop: () => loadOlder(ref), onBottom: () => trim(ref) });
	// Refresh the transcript whenever the card says it changed (at once on opening, then debounced). Scrolled up to
	// read, it keeps what's loaded and only adds what's new, so nothing above you drops off.
	const first = useRef(true);
	useEffect(() => {
		const t = setTimeout(() => void load(ref, { hold: !sc.atBottom.current }), first.current ? 0 : 120);
		first.current = false;
		return () => clearTimeout(t);
	}, [sig, ref]);
	return (
		<>
			<div className="scroll-wrap">
			<div className="scroll" id="scroll" ref={sc.scroll} onScroll={sc.onScroll}>
				<div className="thread" ref={sc.content}>
					{entry.more && entry.items.length > 0 && (
						<div className="live">
							<span className="shimmer">Loading earlier messages…</span>
						</div>
					)}
					<Thread turns={turns} txRef={ref} />
					{!entry.items.length && <Empty state={entry.state} />}
					<Pending tab={c.tab} />
					<Live card={c} />
				</div>
			</div>
			<button className={`jump${sc.away ? " show" : ""}`} aria-label="Scroll to bottom" onClick={() => sc.toBottom(true)}>
				<Icon name="down" />
			</button>
			</div>
			{c.status === "blocked" && <Dialog card={c} />}
			<Composer key={draftKeyOf(c)} card={c} draftKey={draftKeyOf(c)} note="" onSent={() => sc.toBottom(true)} />
		</>
	);
}

function Empty({ state }: { state: "loading" | "ok" | "error" }) {
	if (state === "ok") return <div className="empty-chat">No messages yet.</div>;
	return (
		<div className="live">
			<span className="orb" />
			<span className="shimmer">{state === "error" ? "Can't reach Ag right now. Retrying…" : "Loading…"}</span>
		</div>
	);
}

function Pending({ tab }: { tab: string }) {
	const sent = useOutbox((s) => s.sent);
	const items = useOutbox((s) => s.items);
	const mine = [...sent.filter((p) => p.tab === tab).map((p) => ({ k: `s:${p.ts}:${p.text}`, text: p.text, failed: false })), ...items.filter((o) => o.kind === "reply" && o.tab === tab).map((o) => ({ k: o.id, text: o.text, failed: !!o.failed }))];
	return (
		<>
			{mine.map((p) => (
				<div className="u" key={p.k}>
					<div className="bubble pending">{p.text}</div>
					{p.failed && <div className="queued-note">Not sent yet. It goes out as soon as Ag is reachable.</div>}
				</div>
			))}
		</>
	);
}

function Live({ card: c }: { card: Card }) {
	const a = c.activity;
	if (c.status === "working") {
		const what = a?.kind === "tool" ? a.sum || [a.tool, a.detail].filter(Boolean).join(": ") : "Thinking";
		return (
			<div className="live">
				<span className="orb" />
				<span className="shimmer">{what}</span>
				{a?.since ? <Slow since={a.since} /> : null}
			</div>
		);
	}
	if (a?.kind === "error" && a.error) return <div className="err">{a.error}</div>;
	return null;
}
// A step running over three minutes shows how long it's been going.
function Slow({ since }: { since: number }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, []);
	return Date.now() - since > 180_000 ? <span className="slow">{dur(Date.now() - since)}</span> : null;
}

// The agent is asking something in its terminal: its screen, and keys to answer with.
function Dialog({ card: c }: { card: Card }) {
	const [screen, setScreen] = useState("…");
	const pre = useRef<HTMLPreElement>(null);
	useEffect(() => {
		let live = true;
		const loadScreen = async () => {
			const r = await fetch(`/api/screen?tab=${encodeURIComponent(c.tab)}`).catch(() => null);
			if (live && r?.ok) setScreen((await r.text()).replace(/\s+$/, "").split("\n").slice(-18).join("\n"));
		};
		void loadScreen();
		const t = setInterval(loadScreen, 1500);
		return () => ((live = false), clearInterval(t));
	}, [c.tab]);
	useEffect(() => {
		if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
	}, [screen]);
	return (
		<div className="dialog">
			<div className="dialog-card">
				<div className="h">The agent is asking something in its terminal</div>
				<pre ref={pre}>{screen}</pre>
				<div className="keys">
					{["1", "2", "3", "y", "n", "up", "down", "enter", "esc"].map((k) => (
						<button key={k} data-t={`chat-key-${k}`} onClick={() => void sendKey(c, k)}>
							{({ up: "↑", down: "↓", enter: "Enter", esc: "Esc" } as Record<string, string>)[k] || k}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

// A chat that isn't on the board: asleep (hibernated) or closed. Its transcript, read-only, with Wake / Resume.
function SessionView({ sid }: { sid: string }) {
	const ref = `sid=${sid}`;
	const entry = useEntry(ref);
	const [info, setInfo] = useState<SessionInfo | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		setOpenRef(ref);
		void hydrate(ref);
		void load(ref);
		let live = true;
		fetch(`/api/session/${sid}`)
			.then((r) => (r.ok ? cleanJson(r) : { state: "missing", sid }))
			.catch(() => ({ state: "missing", sid }))
			.then((j: SessionInfo) => {
				if (!live) return;
				setInfo(j);
				if (j.state === "hibernated" || j.state === "closed") useUi.setState((s) => ({ sessions: { ...s.sessions, [sid]: j } }));
			});
		return () => ((live = false), setOpenRef(null));
	}, [sid, ref]);
	const turns = useTurns(entry.items, false);
	const sc = useStickyScroll(ref, { onTop: () => loadOlder(ref) });
	const doResume = async () => {
		setBusy(true);
		try {
			await resume(sid);
		} catch (e: any) {
			toast(`Couldn't resume: ${e.message}`);
			setBusy(false);
		}
	};
	return (
		<>
			<div className="scroll" id="scroll" ref={sc.scroll} onScroll={sc.onScroll}>
				<div className="thread" ref={sc.content}>
					<Thread turns={turns} txRef={ref} />
					{!entry.items.length && info?.state !== "missing" && <Empty state={entry.state} />}
				</div>
			</div>
			{info && (
				<div className="banner">
					{info.state === "missing" ? (
						<span className="grow">Couldn't find this chat.</span>
					) : info.state === "live" ? (
						<span className="grow">Opening…</span>
					) : (
						<>
							<span className="grow">
								<b>{info.title}</b>
								<br />
								{info.state === "hibernated" ? "This chat is asleep." : "This chat is closed."} Bring it back to keep going.
							</span>
							<button className="pill" data-t="chat-resume" disabled={busy} onClick={doResume}>
								{busy ? "Starting…" : info.state === "hibernated" ? "Wake" : "Resume"}
							</button>
						</>
					)}
				</div>
			)}
		</>
	);
}

// ---------- lists ----------
const LIST: Record<ListView, { title: string; icon: Parameters<typeof Icon>[0]["name"] }> = {
	inbox: { title: "Inbox", icon: "inbox" },
	you: { title: "Needs you", icon: "bell" },
	working: { title: "Working", icon: "bolt" },
	waiting: { title: "Waiting for", icon: "clock" },
	archived: { title: "Archived chats", icon: "archive" },
};
const FILTER: Record<Exclude<ListView, "archived">, (c: Card) => boolean> = { inbox: (c) => c.inbox, you: needsYou, working: isWorking, waiting: isWaiting };
function ListPage({ view: v }: { view: ListView }) {
	return (
		<div className="page">
			<div className="page-in">
				<h2>
					<Icon name={LIST[v].icon} />
					{LIST[v].title}
				</h2>
				{v === "archived" ? <Archived /> : <Rows view={v} />}
			</div>
		</div>
	);
}
function Rows({ view: v }: { view: Exclude<ListView, "archived"> }) {
	const sorted = useBoard((s) => view(s).sorted);
	// Like the sidebar: rows hold still while the pointer is over the list.
	const [frozen, setFrozen] = useState<string[] | null>(null);
	let list = sorted.filter(FILTER[v]);
	if (frozen) {
		const at = new Map(frozen.map((t, i) => [t, i]));
		list = [...list].sort((a, b) => (at.get(a.tab) ?? 1e9) - (at.get(b.tab) ?? 1e9));
	}
	if (!list.length) return <div className="empty-list" style={{ padding: "24px 12px" }}>{v === "inbox" ? "Nothing new. Sessions sit here until you reply to them." : "Nothing here right now."}</div>;
	return (
		<div id="rows" onPointerEnter={(e) => e.pointerType === "mouse" && setFrozen(list.map((c) => c.tab))} onPointerLeave={() => setFrozen(null)}>
			{list.map((c) => {
				const sub = v === "waiting" ? c.waiting[0]?.title || c.waiting[0]?.detail || "" : snippet(c);
				const ind = isWorking(c) ? <span className="spin" /> : c.status === "blocked" ? <span className="dot blocked" /> : c.needsYou ? <span className="dot unread" /> : null;
				return (
					<a key={c.tab} className="crow" href={urlOf(c)} data-go={urlOf(c)} data-tab={c.tab} data-longpress="chat">
						<div className="txt">
							<div className="t">{c.title}</div>
							<div className="s">{sub}</div>
						</div>
						{ind}
						<span className="d">{ago(lastAt(c))}</span>
					</a>
				);
			})}
		</div>
	);
}

// Archived chats (ChatGPT: Settings › Archived chats): sessions closed in the last two weeks; open one to read it,
// Restore brings it back as a live chat.
type Arch = { sid: string; title: string; last: number; running?: boolean; status?: string };
function Archived() {
	const [list, setList] = useState<Arch[] | null>(null);
	const [q, setQ] = useState("");
	const [restoring, setRestoring] = useState<string | null>(null);
	useEffect(() => {
		fetch("/api/archived?days=14")
			.then((r) => (r.ok ? cleanJson(r) : []))
			.catch(() => [])
			.then(setList);
	}, []);
	const shown = (list ?? []).filter((a) => !q.trim() || a.title.toLowerCase().includes(q.trim().toLowerCase()));
	return (
		<>
			<input className="filter" placeholder="Search archived chats" autoComplete="off" aria-label="Search archived chats" value={q} onChange={(e) => setQ(e.target.value)} />
			<div id="rows">
				{!list ? (
					<div className="empty-list" style={{ padding: "24px 12px" }}>
						Loading…
					</div>
				) : !shown.length ? (
					<div className="empty-list" style={{ padding: "24px 12px" }}>
						{q ? "No archived chats match." : "No chats archived in the last two weeks."}
					</div>
				) : (
					shown.map((a) => (
						<a key={a.sid} className="crow" href={`/chat/${a.sid}`} data-go={`/chat/${a.sid}`}>
							<div className="txt">
								<div className="t">{a.title}</div>
							</div>
							<button
								className="pill sm"
								data-t="chat-restore"
								disabled={restoring === a.sid}
								onClick={async (e) => {
									e.preventDefault();
									e.stopPropagation();
									setRestoring(a.sid);
									try {
										await resume(a.sid);
										toast("Restored");
										setList((l) => l?.filter((x) => x.sid !== a.sid) ?? null);
									} catch (err: any) {
										toast(`Couldn't restore: ${err.message}`);
									}
									setRestoring(null);
								}}
							>
								{restoring === a.sid ? "Restoring…" : "Restore"}
							</button>
							<span className="d">{a.running ? (a.status === "working" ? "Running" : "Finishing") : ago(a.last * 1000)}</span>
						</a>
					))
				)}
			</div>
		</>
	);
}

// ---------- Routines and ag-rules ----------
type Routine = { id: string; machine: string; name: string; description: string; schedule: string; last?: number; next?: number; result?: string; exit?: number; outcome?: { ok?: boolean; summary?: string; session?: string } };
function Routines() {
	const [list, setList] = useState<Routine[] | null | undefined>(undefined);
	const [logs, setLogs] = useState<Record<string, string>>({});
	const refresh = () =>
		fetch("/api/routines", { cache: "no-store" })
			.then((r) => r.json())
			.then((j) => setList(j.routines || []))
			.catch(() => setList(null));
	useEffect(() => void refresh(), []);
	return (
		<div className="page">
			<div className="page-in">
				<h2>
					<Icon name="repeat" />
					Routines
				</h2>
				<p className="intro">Recurring jobs Ag runs on its own: systemd timers on the session host and interval LaunchAgents on ag-mac.</p>
				{list === undefined ? null : !list ? (
					<p className="intro">Couldn't load routines.</p>
				) : !list.length ? (
					<p className="intro">No routines.</p>
				) : (
					list.map((r) => {
						const o = r.outcome, engine = r.id.startsWith("engine:");
						const meta = [r.machine, r.schedule, r.result && (r.result === "ok" && r.exit ? `exit ${r.exit}` : r.result), r.last && `ran ${ago(r.last)} ago`, r.next && `next in ${ago(2 * Date.now() - r.next).replace(/^now$/, "<1m")}`].filter(Boolean).join(" · ");
						return (
							<div className="card-row" key={r.id}>
								<div className="cr-h">
									<b>{r.name}</b>
									<span className="cr-m">{meta}</span>
									{engine && (
										<span className="cr-acts">
											<button
												className="pill"
												onClick={async () => {
													const res = await fetch("/api/routines/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id }) });
													toast(res.ok ? "Started" : (await res.json()).error || "Couldn't start it");
													setTimeout(refresh, 1500);
												}}
											>
												Run now
											</button>
											<button
												className="pill"
												onClick={async () => {
													if (logs[r.id]) return setLogs(({ [r.id]: _, ...rest }) => rest);
													const t = await (await fetch(`/api/routines/log?id=${encodeURIComponent(r.id)}`)).text();
													setLogs((l) => ({ ...l, [r.id]: t }));
												}}
											>
												{logs[r.id] ? "Hide log" : "Log"}
											</button>
										</span>
									)}
								</div>
								<div className="cr-d">{r.description}</div>
								{o?.summary && (
									<div className={`cr-d${o.ok === false ? " bad" : ""}`}>
										{o.ok === false ? "✗" : "✓"} {o.summary}
										{o.session && (
											<>
												{" · "}
												<a href={`/chat/${o.session}`} data-go={`/chat/${o.session}`}>
													session
												</a>
											</>
										)}
									</div>
								)}
								{logs[r.id] && <pre>{logs[r.id]}</pre>}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
type Rule = { name: string; on: string; app?: string; enabled: boolean; source?: string; description?: string; dir?: string; text: string };
function Rules() {
	const [list, setList] = useState<Rule[] | null | undefined>(undefined);
	useEffect(() => {
		fetch("/api/ag-rules", { cache: "no-store" })
			.then((r) => r.json())
			.then((j) => setList(Array.isArray(j) ? j : null))
			.catch(() => setList(null));
	}, []);
	return (
		<div className="page">
			<div className="page-in">
				<h2>
					<Icon name="keyboard" />
					ag-rules
				</h2>
				<p className="intro">
					Your shortcuts and standing behaviors: each a rule in plain English that boils down to code. Yours are in <code>~/.ag/ag-rules/&lt;name&gt;/</code>; the ones marked default ship with ag (<code>ag-rules eject &lt;name&gt;</code> copies one there to change or turn
					off). Ask an agent to change one; <code>ag-rules list</code> in a terminal.
				</p>
				{list === undefined ? null : !list ? (
					<p className="intro">Couldn't load ag-rules.</p>
				) : !list.length ? (
					<p className="intro">No ag-rules yet.</p>
				) : (
					list.map((r) => (
						<div className="card-row" key={r.name}>
							<div className="cr-h">
								<b>{r.name}</b>
								<span className="cr-m">
									{r.on + (r.app ? ` · ${r.app}` : "")}
									{r.enabled ? "" : " · off"}
									{r.source && r.source !== "yours" ? ` · ${r.source}` : ""}
								</span>
							</div>
							<div className="cr-d">{r.description || ""}</div>
							<details>
								<summary className="cr-m">The rule, in plain English · {r.dir || ""}</summary>
								<div className="cr-d" style={{ whiteSpace: "pre-wrap" }}>
									{r.text}
								</div>
							</details>
						</div>
					))
				)}
			</div>
		</div>
	);
}

function usePageVisible() {
	const [v, setV] = useState(!document.hidden);
	useEffect(() => {
		const f = () => setV(!document.hidden);
		document.addEventListener("visibilitychange", f);
		return () => document.removeEventListener("visibilitychange", f);
	}, []);
	return v;
}
