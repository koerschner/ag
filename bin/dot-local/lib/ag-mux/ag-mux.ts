#!/usr/bin/env bun
// Run through ~/.local/bin/ag-mux (the launcher), which finds bun and short-cuts Herdr hosts.
// ag-mux: Ag's session layer. tmux runs the terminals; `ag-mux daemon` (agd) adds what Ag needs on top:
// stable workspace/tab/pane IDs, agent lifecycle states, snapshots, events, notifications, and layout
// persistence. It speaks Herdr's CLI grammar and JSON-lines socket protocol (the subset Ag uses), so
// scripts and the Pi/Claude/Codex state hooks work against either backend. Design: docs/tmux-port.md.
//
//   ag-mux <group> <command> ...   Herdr-style CLI (workspace/tab/pane/agent/notification/api/server)
//   ag-mux attach [workspace]      attach this terminal to the Ag tmux server (tmux -L ag)
//   ag-mux daemon                  run agd (systemd user unit ag-mux.service)
//   ag-mux switch [--client C]     fuzzy tab switcher (bound to prefix+s)
//   ag-mux save | restore [--from FILE] [--awake]
//   ag-mux backend                 print which backend CLI calls go to (tmux or herdr)
//
// Backend: tmux when agd's socket is up (or AG_MUX_BACKEND=tmux); otherwise calls pass straight through
// to a real `herdr` binary if one is installed (AG_MUX_BACKEND=herdr forces it). So callers use
// `ag-mux` everywhere, before and after the move off Herdr.
//
// Compatibility notes: the protocol and CLI mirror Herdr (Apache-2.0, github.com/herdrdev/herdr) for
// interoperability; this is an independent implementation. Pane env keeps the HERDR_* names because
// the agent-state hooks read them.

import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";

const HOME = homedir();
const STATE_DIR = process.env.AG_MUX_STATE ?? `${HOME}/.local/state/ag-mux`;
const SOCK = process.env.AG_MUX_SOCKET ?? `${STATE_DIR}/agd.sock`;
const TMUX_L = process.env.AG_MUX_TMUX ?? "ag";
const CONF = process.env.AG_MUX_CONF ?? `${HOME}/.config/ag/ag.tmux.conf`;
const SELF = process.env.AG_MUX_BIN ?? `${HOME}/.local/bin/ag-mux`;
const SLEEP = process.env.AG_MUX_SLEEP ?? `${HOME}/.local/bin/ag-mux-sleep`;
const STATE_FILE = `${STATE_DIR}/state.json`;
const LAYOUT_FILE = `${STATE_DIR}/layout.json`;
const POLL_MS = Number(process.env.AG_MUX_POLL_MS ?? 300);
const INBOX = "Inbox";
const DEBUG = process.env.AG_MUX_DEBUG === "1";
const SEP = "|~|";
const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "-zsh", "-bash", "-sh", "login"]);
const KINDS: Record<string, string> = { pi: "pi", claude: "claude", codex: "codex" };

class MuxError extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
	}
}
const fail = (code: string, message: string): never => {
	throw new MuxError(code, message);
};

// ───────────────────────── tmux ─────────────────────────

function tmuxRaw(args: string[], input?: string) {
	const r = Bun.spawnSync(["tmux", "-L", TMUX_L, ...args], {
		stdin: input === undefined ? "ignore" : Buffer.from(input),
		stdout: "pipe",
		stderr: "pipe",
	});
	if (DEBUG) console.error("tmux", JSON.stringify(args).slice(0, 300), "→", r.exitCode, r.stdout.toString().slice(0, 120).replace(/\n/g, "⏎"), r.stderr.toString().trim());
	return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString().trim() };
}
function tmux(args: string[], input?: string): string {
	const r = tmuxRaw(args, input);
	if (r.code !== 0) fail("tmux_error", `tmux ${args[0]}: ${r.err}`);
	return r.out;
}
// Several tmux commands in one invocation.
function tmuxBatch(cmds: string[][]) {
	if (!cmds.length) return;
	const args: string[] = [];
	for (const c of cmds) (args.length && args.push(";"), args.push(...c));
	tmuxRaw(args);
}
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const esc = (s: string) => s.replace(/#/g, "##");

// ───────────────────────── model ─────────────────────────

type Rect = { x: number; y: number; width: number; height: number };
type Ws = { id: string; sid: string; name: string; label: string; order: number; tabs: string[]; activeTab?: string };
type Tab = { id: string; wid: string; ws: string; index: number; label: string; active: boolean; layout: string; zoomed: boolean; w: number; h: number; panes: string[]; activePane?: string };
type Pane = { id: string; tp: string; tab: string; ws: string; active: boolean; pid: number; cwd: string; cmd: string; title: string; rect: Rect; dead: boolean; sleep: string };
type Client = { name: string; tty: string; activity: number; control: boolean; sid: string; pid: number };
type Status = "idle" | "working" | "blocked" | "done" | "unknown";
type Agent = {
	agent: string;
	status: Status;
	message?: string;
	session?: { agent: string; kind: "path" | "id"; source: string; value: string };
	name?: string;
	pid?: number;
	seq: number; // last report seq accepted
	changeSeq: number; // state_change_seq
	changedAt: number;
	activity: number; // bumps whenever the agent enters working/blocked
	source: string;
};

let WS = new Map<string, Ws>();
let TABS = new Map<string, Tab>();
let PANES = new Map<string, Pane>();
let CLIENTS: Client[] = [];
const byTmux = new Map<string, string>(); // $n/@n/%n -> ag id
let serverUp = false;
let focus = { ws: "", tab: "", pane: "" };
let viewedTabs = new Set<string>();

type State = { next: number; changeSeq: number; agents: Record<string, Agent>; order: Record<string, number> };
let S: State = { next: 1, changeSeq: 1, agents: {}, order: {} };
let stateDirty = false;
let layoutDirty = false;

function loadState() {
	try {
		S = { ...S, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
	} catch {}
}
function writeAtomic(file: string, data: string) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(`${file}.tmp`, data);
	renameSync(`${file}.tmp`, file);
}
function saveState() {
	if (!stateDirty) return;
	stateDirty = false;
	writeAtomic(STATE_FILE, JSON.stringify(S));
}
const newId = () => ((stateDirty = true), (S.next++).toString(36).toUpperCase());
// Keep the counter above every ID in use (restored or imported IDs), so IDs are never reused.
function bumpId(id: string) {
	const n = parseInt(/[wtp]([0-9A-Z]+)$/.exec(id)?.[1] ?? "", 36);
	if (n >= S.next) ((S.next = n + 1), (stateDirty = true));
}

const PANE_FIELDS = [
	"session_id", "session_name", "@ag_ws", "@ag_ws_label",
	"window_id", "window_index", "window_name", "@ag_tab", "window_active", "window_layout", "window_zoomed_flag", "window_width", "window_height",
	"pane_id", "pane_active", "pane_pid", "pane_current_path", "pane_current_command", "pane_title",
	"pane_left", "pane_top", "pane_width", "pane_height", "@ag_pane", "pane_dead", "@ag_sleep",
];
const CLIENT_FIELDS = ["client_name", "client_tty", "client_activity", "client_control_mode", "session_id", "client_pid"];
const fmt = (fields: string[], tag: string) => tag + fields.map((f) => `#{${f}}`).join(SEP);

type Ev = { event: string; data: any };
let pendingEvents: Ev[] = [];
const emit = (event: string, data: any) => pendingEvents.push({ event, data: { type: event, ...data } });

// Rebuild the model from tmux. Assigns IDs to anything created outside agd. Emits change events.
function refresh() {
	const r = tmuxRaw(["list-panes", "-a", "-F", fmt(PANE_FIELDS, "P"), ";", "list-clients", "-F", fmt(CLIENT_FIELDS, "C")]);
	if (r.code !== 0) {
		serverUp = false;
		return;
	}
	serverUp = true;
	const prev = { ws: WS, tabs: TABS, panes: PANES, focus: { ...focus } };
	const ws = new Map<string, Ws>(), tabs = new Map<string, Tab>(), panes = new Map<string, Pane>();
	const sets: string[][] = [];
	const clients: Client[] = [];
	for (const line of r.out.split("\n")) {
		if (line.startsWith("C")) {
			const [name, tty, activity, control, sid, pid] = line.slice(1).split(SEP);
			clients.push({ name, tty, activity: Number(activity), control: control === "1", sid, pid: Number(pid) });
			continue;
		}
		if (!line.startsWith("P")) continue;
		const f = Object.fromEntries(line.slice(1).split(SEP).map((v, i) => [PANE_FIELDS[i], v]));
		if (f.session_name.startsWith("_")) continue;
		let wsId = f["@ag_ws"];
		if (!wsId) {
			wsId = byTmux.get(f.session_id) ?? `w${newId()}`;
			sets.push(["set-option", "-t", f.session_id, "@ag_ws", wsId], ["set-option", "-t", f.session_id, "@ag_ws_label", f.session_name]);
			f["@ag_ws_label"] ||= f.session_name;
		}
		byTmux.set(f.session_id, wsId);
		bumpId(wsId);
		let w = ws.get(wsId);
		if (!w) ws.set(wsId, (w = { id: wsId, sid: f.session_id, name: f.session_name, label: f["@ag_ws_label"] || f.session_name, order: S.order[wsId] ?? 1e9 + Number(f.session_id.slice(1)), tabs: [] }));
		let tabId = f["@ag_tab"];
		if (!tabId) {
			tabId = byTmux.get(f.window_id) ?? `${wsId}:t${newId()}`;
			sets.push(["set-option", "-w", "-t", f.window_id, "@ag_tab", tabId]);
		}
		byTmux.set(f.window_id, tabId);
		bumpId(tabId);
		let t = tabs.get(tabId);
		if (!t) {
			tabs.set(tabId, (t = { id: tabId, wid: f.window_id, ws: wsId, index: Number(f.window_index), label: f.window_name, active: f.window_active === "1", layout: f.window_layout, zoomed: f.window_zoomed_flag === "1", w: Number(f.window_width), h: Number(f.window_height), panes: [] }));
			w.tabs.push(tabId);
			if (t.active) w.activeTab = tabId;
		}
		let paneId = f["@ag_pane"];
		if (!paneId) {
			paneId = byTmux.get(f.pane_id) ?? `${wsId}:p${newId()}`;
			sets.push(["set-option", "-p", "-t", f.pane_id, "@ag_pane", paneId]);
		}
		byTmux.set(f.pane_id, paneId);
		bumpId(paneId);
		const p: Pane = {
			id: paneId, tp: f.pane_id, tab: tabId, ws: wsId, active: f.pane_active === "1", pid: Number(f.pane_pid), cwd: f.pane_current_path,
			cmd: f.pane_current_command, title: f.pane_title, dead: f.pane_dead === "1", sleep: f["@ag_sleep"],
			rect: { x: Number(f.pane_left), y: Number(f.pane_top), width: Number(f.pane_width), height: Number(f.pane_height) },
		};
		panes.set(paneId, p);
		t.panes.push(paneId);
		if (p.active) t.activePane = paneId;
	}
	tmuxBatch(sets);
	for (const w of ws.values()) w.tabs.sort((a, b) => tabs.get(a)!.index - tabs.get(b)!.index);
	WS = ws;
	TABS = tabs;
	PANES = panes;
	CLIENTS = clients;
	for (const k of [...byTmux.keys()]) if (!panes.has(byTmux.get(k)!) && !tabs.has(byTmux.get(k)!) && !ws.has(byTmux.get(k)!)) byTmux.delete(k);

	// Focus: the most recently active real client decides; viewed = every real client's current tab.
	const real = clients.filter((c) => !c.control).sort((a, b) => b.activity - a.activity);
	viewedTabs = new Set(real.map((c) => ws.get(byTmux.get(c.sid) ?? "")?.activeTab).filter(Boolean) as string[]);
	if (real.length) {
		const w = ws.get(byTmux.get(real[0].sid) ?? "");
		const t = w?.activeTab ? tabs.get(w.activeTab) : undefined;
		focus = { ws: w?.id ?? "", tab: t?.id ?? "", pane: t?.activePane ?? "" };
	} else if (!panes.has(focus.pane)) focus = { ws: "", tab: "", pane: "" };

	// Agents: forget panes that are gone or whose agent process exited.
	for (const [id, a] of Object.entries(S.agents)) {
		const p = panes.get(id);
		if (!p || (a.pid && !alive(a.pid))) {
			delete S.agents[id];
			stateDirty = true;
			if (p) emit("pane_agent_detected", { pane_id: id, workspace_id: p.ws, agent: null, final_status: a.status, released: true });
		}
	}
	// Looking at a tab marks its finished agents seen; restored sleepers wake when viewed.
	for (const tid of viewedTabs) {
		for (const pid of tabs.get(tid)?.panes ?? []) {
			const a = S.agents[pid];
			if (a?.status === "done") setStatus(pid, "idle");
			const p = panes.get(pid)!;
			if (p.sleep) {
				tmuxBatch([["set-option", "-p", "-u", "-t", p.tp, "@ag_sleep"], ["send-keys", "-t", p.tp, "Enter"]]);
				p.sleep = "";
			}
		}
	}
	diff(prev);
	renderStatus();
	flushEvents();
}

function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e: any) {
		return e?.code === "EPERM";
	}
}

function diff(prev: { ws: Map<string, Ws>; tabs: Map<string, Tab>; panes: Map<string, Pane>; focus: typeof focus }) {
	let structural = false;
	for (const [id, w] of WS) {
		const o = prev.ws.get(id);
		if (!o) (emit("workspace_created", { workspace: wsInfo(w) }), (structural = true));
		else if (o.label !== w.label) (emit("workspace_renamed", { workspace_id: id, label: w.label }), (structural = true));
	}
	for (const [id, t] of TABS) {
		const o = prev.tabs.get(id);
		if (!o) (emit("tab_created", { tab: tabInfo(t) }), (structural = true));
		else {
			if (o.label !== t.label) (emit("tab_renamed", { tab_id: id, workspace_id: t.ws, label: t.label }), (structural = true));
			if (o.ws !== t.ws) structural = true;
		}
	}
	const closedLayouts: Tab[] = [];
	for (const [id, p] of PANES) {
		const o = prev.panes.get(id);
		if (!o) (emit("pane_created", { pane: paneInfo(p) }), (structural = true));
		else if (o.ws !== p.ws || o.tab !== p.tab) {
			const created = prev.tabs.has(p.tab) ? null : tabInfo(TABS.get(p.tab)!);
			emit("pane_moved", { pane: paneInfo(p), previous_pane_id: id, previous_tab_id: o.tab, previous_workspace_id: o.ws, closed_tab_id: TABS.has(o.tab) ? null : o.tab === p.tab ? null : o.tab, closed_workspace_id: WS.has(o.ws) ? null : o.ws, created_tab: created, created_workspace: null });
		}
	}
	for (const [id, o] of prev.panes) if (!PANES.has(id)) (emit("pane_closed", { pane_id: id, tab_id: o.tab, workspace_id: o.ws }), (structural = true));
	for (const [id, o] of prev.tabs) if (!TABS.has(id)) (emit("tab_closed", { tab_id: id, workspace_id: o.ws }), (structural = true));
	for (const [id, o] of prev.ws) if (!WS.has(id)) (emit("workspace_closed", { workspace_id: id, workspace: null }), (structural = true));
	for (const [id, t] of TABS) {
		const o = prev.tabs.get(id);
		if (o && (o.layout !== t.layout || o.panes.join() !== t.panes.join())) closedLayouts.push(t);
	}
	for (const t of closedLayouts) (emit("layout_updated", { layout: layoutTree(t) }), (structural = true));
	if (focus.ws && focus.ws !== prev.focus.ws) emit("workspace_focused", { workspace_id: focus.ws });
	if (focus.tab && focus.tab !== prev.focus.tab) emit("tab_focused", { tab_id: focus.tab, workspace_id: focus.ws });
	if (focus.pane && focus.pane !== prev.focus.pane) emit("pane_focused", { pane_id: focus.pane, tab_id: focus.tab, workspace_id: focus.ws });
	if (structural) layoutDirty = true;
}

// ───────────────────────── agents ─────────────────────────

const RANK: Record<Status, number> = { blocked: 4, working: 3, done: 2, idle: 1, unknown: 0 };
const worst = (xs: Status[]): Status => xs.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), "unknown");

function setStatus(paneId: string, status: Status, message?: string) {
	const a = S.agents[paneId];
	if (!a) return;
	if (a.status === status && a.message === message) return;
	a.status = status;
	a.message = message;
	a.changeSeq = S.changeSeq++;
	a.changedAt = Date.now();
	if (status === "working" || status === "blocked") a.activity++;
	stateDirty = true;
	const p = PANES.get(paneId);
	emit("pane_agent_status_changed", { pane_id: paneId, workspace_id: p?.ws, tab_id: p?.tab, agent: a.agent, agent_status: status, display_agent: a.agent, title: null, state_labels: {} });
	notifyWaiters();
}

// Herdr's "done" = finished while nobody was looking; "idle" = ready and seen.
function reported(paneId: string, state: string): Status {
	const a = S.agents[paneId];
	if (state !== "idle") return state as Status;
	const p = PANES.get(paneId);
	const looking = !!p && viewedTabs.has(p.tab);
	if (!a) return "idle";
	if (a.status === "working" || a.status === "blocked") return looking ? "idle" : "done";
	return a.status === "done" && !looking ? "done" : "idle";
}

function foregroundPid(p: Pane): number | undefined {
	const r = Bun.spawnSync(["ps", "-o", "tpgid=", "-p", String(p.pid)]);
	const n = Number(r.stdout.toString().trim());
	return n > 0 ? n : undefined;
}

let waiters = new Set<() => void>();
const notifyWaiters = () => [...waiters].forEach((w) => w());
function waitFor(pred: () => boolean, timeoutMs?: number | null): Promise<boolean> {
	return new Promise((resolve) => {
		if (pred()) return resolve(true);
		let timer: any;
		const done = (v: boolean) => (waiters.delete(check), clearTimeout(timer), resolve(v));
		const check = () => pred() && done(true);
		waiters.add(check);
		if (timeoutMs != null) timer = setTimeout(() => done(false), Math.max(0, timeoutMs));
	});
}

// ───────────────────────── info shapes (Herdr-compatible) ─────────────────────────

function orderedWs(): Ws[] {
	return [...WS.values()].sort((a, b) => (a.label === INBOX ? -1 : b.label === INBOX ? 1 : a.order - b.order || Number(a.sid.slice(1)) - Number(b.sid.slice(1))));
}
function tabStatus(t: Tab): Status {
	return worst(t.panes.map((p) => S.agents[p]?.status ?? "unknown"));
}
function wsInfo(w: Ws) {
	const tabs = w.tabs.map((t) => TABS.get(t)!).filter(Boolean);
	return {
		workspace_id: w.id, label: w.label, number: orderedWs().indexOf(w) + 1, focused: focus.ws === w.id, active_tab_id: w.activeTab ?? w.tabs[0] ?? null,
		tab_count: tabs.length, pane_count: tabs.reduce((n, t) => n + t.panes.length, 0), agent_status: worst(tabs.map(tabStatus)), tokens: {}, worktree: null,
		tmux_session: w.name,
	};
}
function tabInfo(t: Tab) {
	return { tab_id: t.id, workspace_id: t.ws, label: t.label, number: t.index, focused: focus.tab === t.id, pane_count: t.panes.length, agent_status: tabStatus(t), tmux_window: t.wid };
}
function paneInfo(p: Pane) {
	const a = S.agents[p.id];
	const title = p.title;
	return {
		pane_id: p.id, tab_id: p.tab, workspace_id: p.ws, focused: focus.pane === p.id, cwd: p.cwd, foreground_cwd: p.cwd,
		...(a ? { agent: a.agent, agent_session: a.session ?? null, name: a.name ?? null } : {}),
		...(p.sleep ? { sleeping_session: p.sleep } : {}),
		agent_status: a?.status ?? "unknown", terminal_id: `tmux${p.tp}`, terminal_title: title, terminal_title_stripped: title, revision: 0, tmux_pane: p.tp,
	};
}
function agentInfo(p: Pane) {
	const a = S.agents[p.id]!;
	return { ...paneInfo(p), name: a.name ?? null, state_change_seq: a.changeSeq, interactive_ready: a.status !== "working" && a.status !== "unknown", message: a.message ?? null };
}
function snapshot() {
	const ws = orderedWs();
	const tabs = ws.flatMap((w) => w.tabs.map((t) => TABS.get(t)!));
	const panes = tabs.flatMap((t) => t.panes.map((p) => PANES.get(p)!));
	return {
		version: "ag-mux", protocol: 22, focused_workspace_id: focus.ws || null, focused_tab_id: focus.tab || null, focused_pane_id: focus.pane || null,
		workspaces: ws.map(wsInfo), tabs: tabs.map(tabInfo), panes: panes.map(paneInfo), agents: panes.filter((p) => S.agents[p.id]).map(agentInfo),
		layouts: tabs.map(paneLayout), clients: CLIENTS.filter((c) => !c.control).map((c) => ({ name: c.name, tty: c.tty, activity: c.activity, workspace_id: byTmux.get(c.sid) ?? null })),
	};
}
function paneLayout(t: Tab) {
	return {
		tab_id: t.id, workspace_id: t.ws, zoomed: t.zoomed, focused_pane_id: t.activePane ?? null, area: { x: 0, y: 0, width: t.w, height: t.h },
		panes: t.panes.map((id) => ({ pane_id: id, focused: t.activePane === id, rect: PANES.get(id)!.rect })), splits: [],
	};
}

// tmux layout string → Herdr's binary split tree (layout.export).
type Node = { type: "pane"; pane_id?: string; cwd?: string; agent?: string; session?: string } | { type: "split"; direction: "right" | "down"; ratio: number; first: Node; second: Node };
function layoutTree(t: Tab) {
	const s = t.layout.replace(/^[0-9a-f]+,/, "");
	let i = 0;
	const num = () => {
		const m = /^\d+/.exec(s.slice(i))!;
		i += m[0].length;
		return Number(m[0]);
	};
	type Cell = { size: [number, number]; node: Node };
	const cell = (): Cell => {
		const w = num();
		i++; // x
		const h = num();
		i++; // ,
		num();
		i++; // ,
		num(); // y
		if (s[i] === "," ) {
			i++;
			const id = num();
			const pid = byTmux.get(`%${id}`);
			const p = pid ? PANES.get(pid) : undefined;
			const a = pid ? S.agents[pid] : undefined;
			return { size: [w, h], node: { type: "pane", pane_id: pid, cwd: p?.cwd, ...(a ? { agent: a.agent, session: a.session?.value } : {}) } };
		}
		const open = s[i++];
		const kids: Cell[] = [];
		for (;;) {
			kids.push(cell());
			if (s[i] === ",") i++;
			else break;
		}
		i++; // close
		const dir = open === "{" ? "right" : "down";
		const axis = dir === "right" ? 0 : 1;
		const fold = (k: Cell[]): Node => {
			if (k.length === 1) return k[0].node;
			const total = k.reduce((n, c) => n + c.size[axis], 0);
			return { type: "split", direction: dir, ratio: Math.round((k[0].size[axis] / total) * 1000) / 1000, first: k[0].node, second: fold(k.slice(1)) };
		};
		return { size: [w, h], node: fold(kids) };
	};
	let root: Node;
	try {
		root = cell().node;
	} catch {
		root = { type: "pane", pane_id: t.panes[0] };
	}
	return { workspace_id: t.ws, tab_id: t.id, zoomed: t.zoomed, focused_pane_id: t.activePane ?? null, root };
}
const leaves = (n: Node): Node[] => (n.type === "pane" ? [n] : [...leaves(n.first), ...leaves(n.second)]);

// ───────────────────────── status bar ─────────────────────────

const glyphCache = new Map<string, string>();
let wsLineCache = "";
function renderStatus() {
	const sets: string[][] = [];
	const need = new Map<string, number>();
	for (const t of TABS.values()) {
		const st = t.panes.map((p) => S.agents[p]?.status).filter(Boolean) as Status[];
		const unseen = st.filter((s) => s === "done").length;
		const g = (st.includes("blocked") ? " ⚠" : "") + (st.includes("working") ? " …" : "") + (unseen ? ` ${"●".repeat(unseen)}` : "");
		if (st.includes("blocked") || unseen) need.set(t.ws, (need.get(t.ws) ?? 0) + 1);
		if (glyphCache.get(t.wid) !== g) (glyphCache.set(t.wid, g), sets.push(["set-option", "-w", "-t", t.wid, "@ag_glyph", g]));
	}
	const line = orderedWs()
		.map((w) => `#[range=user|${w.sid}]#{?#{==:#{session_id},${w.sid}},#[reverse],} ${esc(w.label)}${need.get(w.id) ? ` ${need.get(w.id)}●` : ""} #[default]#[norange]`)
		.join("");
	if (line !== wsLineCache) (sets.push(["set-option", "-g", "@ag_ws_line", line]), (wsLineCache = line));
	if (sets.length) for (const c of CLIENTS) if (!c.control) sets.push(["refresh-client", "-S", "-t", c.name]);
	tmuxBatch(sets);
}

// ───────────────────────── events ─────────────────────────

type Sub = { sock: net.Socket; types: Set<string> };
const subs = new Set<Sub>();
function flushEvents() {
	const evs = pendingEvents;
	pendingEvents = [];
	for (const e of evs) {
		const line = `${JSON.stringify(e)}\n`;
		for (const s of subs) if (s.types.has(e.event)) s.sock.write(line);
	}
	if (evs.length) notifyWaiters();
}

// ───────────────────────── resolution ─────────────────────────

const resolve = <T,>(m: Map<string, T>, id: string | undefined | null) => (id ? (m.get(id) ?? m.get(byTmux.get(id) ?? "")) : undefined);
const paneOf = (id?: string | null) => resolve(PANES, id) ?? fail("pane_not_found", `pane ${id} not found`);
const tabOf = (id?: string | null) => resolve(TABS, id) ?? fail("tab_not_found", `tab ${id} not found`);
const wsOf = (id?: string | null) => resolve(WS, id) ?? fail("workspace_not_found", `workspace ${id} not found`);
// A pane restored asleep has no agent until pi starts. Prompting it (AG Dash, the inbox, the tickler) wakes it
// and waits for pi to report ready, so senders don't hit agent_not_found on a sleeping session.
async function wakeAgent(target: string): Promise<Pane> {
	const p = resolve(PANES, target);
	if (!p?.sleep || S.agents[p.id]) return agentOf(target);
	tmuxBatch([["set-option", "-p", "-u", "-t", p.tp, "@ag_sleep"], ["send-keys", "-t", p.tp, "Enter"]]);
	p.sleep = "";
	// pi reports itself before its TUI can take input, so also wait for the editor (its border rules) on screen.
	const editorUp = () => (tmux(["capture-pane", "-p", "-t", p.tp]).match(/^─{20,}/gm) ?? []).length >= 2;
	const t0 = Date.now();
	while (Date.now() - t0 < 60_000 && !(["idle", "done"].includes(S.agents[p.id]?.status ?? "") && editorUp())) await Bun.sleep(250);
	if (!S.agents[p.id]) fail("agent_not_found", `agent in ${p.id} was asleep and didn't start within 60s`);
	await Bun.sleep(700); // settle: extensions finish loading after the first paint
	return p;
}
function agentOf(target: string): Pane {
	for (const [id, a] of Object.entries(S.agents)) if (a.name === target && PANES.has(id)) return PANES.get(id)!;
	const p = resolve(PANES, target);
	if (p && S.agents[p.id]) return p;
	return fail("agent_not_found", `agent target ${target} not found`);
}

function pickClient(name?: string | null): Client | undefined {
	const real = CLIENTS.filter((c) => !c.control).sort((a, b) => b.activity - a.activity);
	return (name && real.find((c) => c.name === name || c.tty === name)) || real[0];
}
function focusPane(p: Pane, client?: string | null) {
	const t = TABS.get(p.tab)!;
	const w = WS.get(p.ws)!;
	const cmds = [["select-window", "-t", t.wid], ["select-pane", "-t", p.tp]];
	const c = pickClient(client);
	if (c) cmds.push(["switch-client", "-c", c.name, "-t", w.sid]);
	tmuxBatch(cmds);
	if (c) focus = { ws: w.id, tab: t.id, pane: p.id };
	for (const pid of t.panes) if (S.agents[pid]?.status === "done") setStatus(pid, "idle");
}

// ───────────────────────── creation ─────────────────────────

function envFor(ws: string, tab: string, pane: string, extra: Record<string, string> = {}): string[] {
	const env = { HERDR_ENV: "1", AG_MUX: "1", HERDR_SOCKET_PATH: SOCK, HERDR_WORKSPACE_ID: ws, HERDR_TAB_ID: tab, HERDR_PANE_ID: pane, ...extra };
	return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}
const cwdOr = (cwd?: string | null) => (cwd && existsSync(cwd) ? cwd : HOME);
function sessionName(label: string, except?: string) {
	const base = (label || "ws").replace(/[:.]/g, "-");
	const taken = new Set([...WS.values()].filter((w) => w.sid !== except).map((w) => w.name));
	let n = base;
	for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
	return n;
}

function createWorkspace(p: { cwd?: string; label?: string; focus?: boolean; env?: Record<string, string>; ids?: { ws?: string; tab?: string; pane?: string }; tabLabel?: string }) {
	const wsId = p.ids?.ws ?? `w${newId()}`;
	const tabId = p.ids?.tab ?? `${wsId}:t${newId()}`;
	const paneId = p.ids?.pane ?? `${wsId}:p${newId()}`;
	const label = p.label || wsId;
	const [sid, wid, tp, idx] = tmux(["new-session", "-d", "-P", "-F", "#{session_id} #{window_id} #{pane_id} #{window_index}", "-s", sessionName(label), "-c", cwdOr(p.cwd), ...envFor(wsId, tabId, paneId, p.env)]).trim().split(" ");
	tmuxBatch([
		["set-option", "-t", sid, "@ag_ws", wsId], ["set-option", "-t", sid, "@ag_ws_label", label], ["set-option", "-w", "-t", wid, "@ag_tab", tabId], ["set-option", "-p", "-t", tp, "@ag_pane", paneId],
		...["HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID"].map((k) => ["set-environment", "-u", "-t", sid, k]),
		["rename-window", "-t", wid, p.tabLabel || idx],
	]);
	[sid, wid, tp].forEach((x, i) => byTmux.set(x, [wsId, tabId, paneId][i]));
	S.order[wsId] = Math.max(0, ...Object.values(S.order)) + 1;
	stateDirty = true;
	refresh();
	const pane = PANES.get(paneId)!;
	if (p.focus) focusPane(pane);
	return { workspace: wsInfo(WS.get(wsId)!), tab: tabInfo(TABS.get(tabId)!), root_pane: paneInfo(pane) };
}

function createTab(p: { workspace_id?: string | null; cwd?: string | null; label?: string | null; focus?: boolean; env?: Record<string, string>; ids?: { tab?: string; pane?: string } }) {
	const w = p.workspace_id ? wsOf(p.workspace_id) : (WS.get(focus.ws) ?? orderedWs()[0] ?? fail("workspace_not_found", "no workspace"));
	const tabId = p.ids?.tab ?? `${w.id}:t${newId()}`;
	const paneId = p.ids?.pane ?? `${w.id}:p${newId()}`;
	const [wid, tp, idx] = tmux(["new-window", "-d", "-P", "-F", "#{window_id} #{pane_id} #{window_index}", "-t", `${w.sid}:`, "-c", cwdOr(p.cwd), ...envFor(w.id, tabId, paneId, p.env)]).trim().split(" ");
	tmuxBatch([["set-option", "-w", "-t", wid, "@ag_tab", tabId], ["set-option", "-p", "-t", tp, "@ag_pane", paneId], ["rename-window", "-t", wid, p.label || idx]]);
	byTmux.set(wid, tabId);
	byTmux.set(tp, paneId);
	refresh();
	const pane = PANES.get(paneId)!;
	if (p.focus) focusPane(pane);
	return { tab: tabInfo(TABS.get(tabId)!), root_pane: paneInfo(pane) };
}

function splitPane(p: { target_pane_id?: string | null; direction: string; ratio?: number | null; cwd?: string | null; focus?: boolean; env?: Record<string, string>; ids?: { pane?: string } }) {
	const target = paneOf(p.target_pane_id ?? focus.pane);
	const paneId = p.ids?.pane ?? `${target.ws}:p${newId()}`;
	const pct = Math.min(95, Math.max(5, Math.round((1 - (p.ratio ?? 0.5)) * 100)));
	const tp = tmux(["split-window", "-d", "-P", "-F", "#{pane_id}", "-t", target.tp, p.direction === "down" ? "-v" : "-h", "-l", `${pct}%`, "-c", cwdOr(p.cwd ?? target.cwd), ...envFor(target.ws, target.tab, paneId, p.env)]).trim();
	tmuxBatch([["set-option", "-p", "-t", tp, "@ag_pane", paneId]]);
	byTmux.set(tp, paneId);
	refresh();
	const pane = PANES.get(paneId)!;
	if (p.focus ?? true) focusPane(pane);
	return pane;
}

// ───────────────────────── pane I/O ─────────────────────────

function pasteText(p: Pane, text: string) {
	if (!text) return;
	const buf = `agmux-${process.pid}-${Math.random().toString(36).slice(2)}`;
	tmux(["load-buffer", "-b", buf, "-"], text);
	tmux(["paste-buffer", "-p", "-r", "-d", "-b", buf, "-t", p.tp]);
}
const KEYMAP: Record<string, string> = {
	enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", backspace: "BSpace", space: "Space", up: "Up", down: "Down", left: "Left", right: "Right",
	home: "Home", end: "End", pageup: "PPage", pagedown: "NPage", delete: "DC", insert: "IC",
};
function tmuxKey(k: string): string {
	const parts = k.toLowerCase().split("+");
	let key = parts.pop()!;
	if (k.length === 1) return k;
	const mods = new Set(parts);
	if (key === "tab" && mods.has("shift")) (mods.delete("shift"), (key = "btab"));
	let name = key === "btab" ? "BTab" : (KEYMAP[key] ?? (/^f([1-9]|1[0-2])$/.test(key) ? key.toUpperCase() : key.length === 1 ? key : ""));
	if (!name) fail("invalid_key", `unknown key ${k}`);
	for (const m of mods) {
		if (m === "ctrl" || m === "control") name = `C-${name}`;
		else if (m === "alt" || m === "meta" || m === "option") name = `M-${name}`;
		else if (m === "shift") name = name.length === 1 ? name.toUpperCase() : `S-${name}`;
		else fail("invalid_key", `unknown modifier in ${k}`);
	}
	return name;
}
function sendKeys(p: Pane, keys: string[]) {
	const names = keys.map(tmuxKey);
	if (names.length) tmux(["send-keys", "-t", p.tp, ...names]);
}
function readPane(p: Pane, source = "recent", lines?: number | null, format = "text") {
	const args = ["capture-pane", "-p", "-t", p.tp];
	if (format === "ansi") args.push("-e");
	const src = source.replace("-", "_");
	if (src === "recent_unwrapped") args.push("-J");
	const n = lines ?? (src === "visible" || src === "detection" ? undefined : 200);
	if (src !== "visible" && src !== "detection") args.push("-S", `-${n}`);
	let text = tmux(args).replace(/\s+$/, "");
	if (n) text = text.split("\n").slice(-n).join("\n");
	return { pane_id: p.id, tab_id: p.tab, workspace_id: p.ws, source: src, format, text: `${text}\n`, revision: 0, truncated: false };
}
function processInfo(p: Pane) {
	const fg = foregroundPid(p) ?? p.pid;
	const r = Bun.spawnSync(["ps", "-A", "-o", "pid=,pgid=,ucomm=,args="]).stdout.toString();
	const procs = r
		.split("\n")
		.map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l))
		.filter((m): m is RegExpExecArray => !!m && Number(m[2]) === fg)
		.map((m) => {
			const pid = Number(m[1]);
			let cwd = p.cwd;
			try {
				cwd = readlinkSync(`/proc/${pid}/cwd`);
			} catch {}
			const argv0 = (m[4].split(/\s+/)[0] ?? "").split("/").pop()!;
			return { pid, name: m[3].split("/").pop()!, argv0, cwd };
		});
	return { pane_id: p.id, shell_pid: p.pid, foreground_process_group_id: fg, foreground_processes: procs };
}
const atShell = (p: Pane) => {
	const fg = foregroundPid(p);
	return !S.agents[p.id] && (fg === undefined || fg === p.pid);
};

// ───────────────────────── handlers ─────────────────────────

type Params = Record<string, any>;
const ok = { type: "ok" };
const H: Record<string, (p: Params, ctx: { sock: net.Socket }) => any> = {
	ping: () => ({ type: "pong" }),
	"server.reload_config": () => (tmux(["source-file", CONF]), { type: "config_reload" }),
	"session.snapshot": () => ({ type: "session_snapshot", snapshot: snapshot() }),

	"workspace.list": () => ({ type: "workspace_list", workspaces: orderedWs().map(wsInfo) }),
	"workspace.get": (p) => ({ type: "workspace_info", workspace: wsInfo(wsOf(p.workspace_id)) }),
	"workspace.create": (p) => ({ type: "workspace_created", ...createWorkspace({ cwd: p.cwd, label: p.label, focus: p.focus ?? true, env: p.env }) }),
	"workspace.focus": (p) => {
		const w = wsOf(p.workspace_id);
		focusPane(PANES.get(TABS.get(w.activeTab ?? w.tabs[0])!.activePane!)!, p.client);
		return refresh(), { type: "workspace_info", workspace: wsInfo(w) };
	},
	"workspace.rename": (p) => {
		const w = wsOf(p.workspace_id);
		tmuxBatch([["set-option", "-t", w.sid, "@ag_ws_label", p.label], ["rename-session", "-t", w.sid, sessionName(p.label, w.sid)]]);
		return refresh(), { type: "workspace_info", workspace: wsInfo(WS.get(w.id)!) };
	},
	"workspace.close": (p) => (tmux(["kill-session", "-t", wsOf(p.workspace_id).sid]), refresh(), ok),
	"workspace.move": (p) => {
		const w = wsOf(p.workspace_id);
		const list = orderedWs().filter((x) => x !== w);
		list.splice(Math.max(0, Math.min(list.length, p.insert_index ?? 0)), 0, w);
		list.forEach((x, i) => (S.order[x.id] = i + 1));
		stateDirty = true;
		refresh();
		return { type: "workspace_list", workspaces: orderedWs().map(wsInfo) };
	},

	"tab.list": (p) => ({ type: "tab_list", tabs: (p.workspace_id ? wsOf(p.workspace_id).tabs : orderedWs().flatMap((w) => w.tabs)).map((t) => tabInfo(TABS.get(t)!)) }),
	"tab.get": (p) => ({ type: "tab_info", tab: tabInfo(tabOf(p.tab_id)) }),
	"tab.create": (p) => ({ type: "tab_created", ...createTab({ workspace_id: p.workspace_id, cwd: p.cwd, label: p.label, focus: p.focus ?? true, env: p.env }) }),
	"tab.focus": (p) => {
		const t = tabOf(p.tab_id);
		focusPane(PANES.get(t.activePane ?? t.panes[0])!, p.client);
		return refresh(), { type: "tab_info", tab: tabInfo(t) };
	},
	"tab.rename": (p) => {
		const t = tabOf(p.tab_id);
		tmux(["rename-window", "-t", t.wid, p.label]);
		return refresh(), { type: "tab_info", tab: tabInfo(TABS.get(t.id)!) };
	},
	"tab.close": (p) => (tmux(["kill-window", "-t", tabOf(p.tab_id).wid]), refresh(), ok),

	"pane.list": (p) => ({ type: "pane_list", panes: snapshot().panes.filter((x) => !p.workspace_id || x.workspace_id === wsOf(p.workspace_id).id) }),
	"pane.get": (p) => ({ type: "pane_info", pane: paneInfo(paneOf(p.pane_id)) }),
	"pane.current": (p) => ({ type: "pane_current", pane: paneInfo(paneOf(p.caller_pane_id ?? p.pane_id ?? focus.pane)) }),
	"pane.register": (p) => {
		refresh();
		const pane = paneOf(p.tmux_pane);
		return { type: "pane_info", pane: paneInfo(pane), env: { HERDR_ENV: "1", AG_MUX: "1", HERDR_SOCKET_PATH: SOCK, HERDR_WORKSPACE_ID: pane.ws, HERDR_TAB_ID: pane.tab, HERDR_PANE_ID: pane.id } };
	},
	"pane.split": (p) => ({ type: "pane_info", pane: paneInfo(splitPane({ target_pane_id: p.target_pane_id, direction: p.direction, ratio: p.ratio, cwd: p.cwd, focus: p.focus, env: p.env })) }),
	"pane.close": (p) => (tmux(["kill-pane", "-t", paneOf(p.pane_id).tp]), refresh(), ok),
	"pane.focus": (p) => (focusPane(paneOf(p.pane_id), p.client), refresh(), { type: "pane_info", pane: paneInfo(paneOf(p.pane_id)) }),
	"pane.rename": (p) => (tmux(["select-pane", "-t", paneOf(p.pane_id).tp, "-T", p.label ?? ""]), ok),
	"pane.send_text": (p) => (pasteText(paneOf(p.pane_id), p.text), ok),
	"pane.send_keys": (p) => (sendKeys(paneOf(p.pane_id), p.keys ?? []), ok),
	"pane.send_input": (p) => {
		const pane = paneOf(p.pane_id);
		(p.keys ?? []).map(tmuxKey);
		pasteText(pane, p.text ?? "");
		sendKeys(pane, p.keys ?? []);
		return ok;
	},
	"pane.read": (p) => ({ type: "pane_read", read: readPane(paneOf(p.pane_id), p.source, p.lines, p.format) }),
	"pane.wait_for_output": async (p) => {
		const pane = paneOf(p.pane_id);
		const m = p.match ?? {};
		const test = m.type === "regex" ? ((re: RegExp) => (s: string) => re.exec(s)?.[0])(new RegExp(m.value, "m")) : (s: string) => (s.includes(m.value) ? m.value : undefined);
		const deadline = p.timeout_ms != null ? Date.now() + p.timeout_ms : Infinity;
		for (;;) {
			if (!PANES.has(pane.id)) fail("pane_not_found", `pane ${pane.id} closed`);
			const read = readPane(pane, p.source ?? "recent", p.lines);
			const hit = test(read.text);
			if (hit !== undefined) return { type: "output_matched", pane_id: pane.id, matched_text: hit, read };
			if (Date.now() > deadline) fail("timeout", `no match in ${p.timeout_ms}ms`);
			await Bun.sleep(200);
		}
	},
	"pane.process_info": (p) => ({ type: "pane_process_info", process_info: processInfo(paneOf(p.pane_id ?? focus.pane)) }),
	"pane.layout": (p) => ({ type: "pane_layout", layout: paneLayout(TABS.get(paneOf(p.pane_id ?? focus.pane).tab)!) }),
	"pane.neighbor": (p) => {
		const me = paneOf(p.pane_id ?? focus.pane);
		const r = me.rect;
		const cands = TABS.get(me.tab)!.panes.map((id) => PANES.get(id)!).filter((o) => o !== me);
		const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
		const hit = cands.find((o) => {
			const s = o.rect;
			if (p.direction === "right") return s.x === r.x + r.width + 1 && overlaps(r.y, r.y + r.height, s.y, s.y + s.height);
			if (p.direction === "left") return s.x + s.width + 1 === r.x && overlaps(r.y, r.y + r.height, s.y, s.y + s.height);
			if (p.direction === "down") return s.y === r.y + r.height + 1 && overlaps(r.x, r.x + r.width, s.x, s.x + s.width);
			return s.y + s.height + 1 === r.y && overlaps(r.x, r.x + r.width, s.x, s.x + s.width);
		});
		return { type: "pane_neighbor", pane_id: me.id, direction: p.direction, neighbor: hit ? paneInfo(hit) : null, pane: hit ? paneInfo(hit) : null };
	},
	"pane.swap": (p) => (tmux(["swap-pane", "-d", "-s", paneOf(p.source_pane_id).tp, "-t", paneOf(p.target_pane_id).tp]), refresh(), { type: "pane_swap" }),
	"pane.move": (p) => {
		const pane = paneOf(p.pane_id);
		const from = TABS.get(pane.tab)!;
		const d = p.destination ?? {};
		const before = { tab: pane.tab, ws: pane.ws };
		let created: Tab | undefined;
		if (d.type === "new_tab") {
			const w = d.workspace_id ? wsOf(d.workspace_id) : WS.get(pane.ws)!;
			if (from.panes.length === 1) {
				if (w.id !== from.ws) tmux(["move-window", "-d", "-s", from.wid, "-t", `${w.sid}:`]);
				if (d.label) tmux(["rename-window", "-t", from.wid, d.label]);
			} else {
				const tabId = `${w.id}:t${newId()}`;
				// Not break-pane: it crashes tmux 3.7 when no client is attached. A placeholder window + swap-pane
				// moves the pane (process and %id intact) into a new tab instead.
				const [wid, ph] = tmux(["new-window", "-d", "-P", "-F", "#{window_id} #{pane_id}", "-t", `${w.sid}:`, "sleep 60"]).trim().split(" ");
				tmuxBatch([["swap-pane", "-d", "-s", pane.tp, "-t", ph], ["kill-pane", "-t", ph]]);
				tmuxBatch([["set-option", "-w", "-t", wid, "@ag_tab", tabId], ...(d.label ? [["rename-window", "-t", wid, d.label]] : [])]);
				byTmux.set(wid, tabId);
			}
		} else if (d.type === "tab") {
			const target = d.target_pane_id ? paneOf(d.target_pane_id) : PANES.get(tabOf(d.tab_id).activePane!)!;
			const pct = Math.round((1 - (d.ratio ?? 0.5)) * 100);
			tmux(["join-pane", "-d", "-s", pane.tp, "-t", target.tp, d.split === "down" ? "-v" : "-h", "-l", `${pct}%`]);
		} else fail("unsupported", `pane move destination ${d.type} is not supported by ag-mux`);
		refresh();
		const now = PANES.get(pane.id)!;
		created = TABS.get(now.tab);
		if (p.focus) focusPane(now);
		return {
			type: "pane_move",
			move_result: {
				changed: before.tab !== now.tab || before.ws !== now.ws, pane: paneInfo(now), previous_pane_id: pane.id, previous_tab_id: before.tab, previous_workspace_id: before.ws,
				created_tab: d.type === "new_tab" && created ? tabInfo(created) : null, created_workspace: null, closed_tab_id: TABS.has(before.tab) ? null : before.tab, closed_workspace_id: null,
				focused_pane_id: focus.pane, reason: null, source_layout: null, target_layout: created ? paneLayout(created) : null,
			},
		};
	},
	"layout.export": (p) => ({ type: "layout_export", layout: layoutTree(p.tab_id ? tabOf(p.tab_id) : TABS.get(paneOf(p.pane_id ?? focus.pane).tab)!) }),
	"layout.apply": (p) => {
		const nodes = leaves(p.root);
		const r = createTab({ workspace_id: p.workspace_id, cwd: nodes[0]?.cwd, label: p.tab_label, focus: false });
		const build = (n: Node, pane: string) => {
			if (n.type === "pane") return;
			const second = splitPane({ target_pane_id: pane, direction: n.direction, ratio: n.ratio, cwd: leaves(n.second)[0]?.cwd, focus: false });
			build(n.first, pane);
			build(n.second, second.id);
		};
		build(p.root, r.root_pane.pane_id);
		refresh();
		const t = TABS.get(r.tab.tab_id)!;
		if (p.focus ?? true) focusPane(PANES.get(t.panes[0])!);
		return { type: "layout_apply", layout: layoutTree(t) };
	},

	"pane.report_agent": (p) => {
		const pane = resolve(PANES, p.pane_id);
		if (!pane) return ok;
		let a = S.agents[pane.id];
		if (a && p.seq != null && a.source === p.source && p.seq < a.seq) return ok;
		const firstSight = !a;
		if (!a) a = S.agents[pane.id] = { agent: p.agent, status: "unknown", seq: 0, changeSeq: S.changeSeq++, changedAt: Date.now(), activity: 0, source: p.source, name: pendingNames.get(pane.id) };
		pendingNames.delete(pane.id);
		a.agent = p.agent;
		a.source = p.source;
		a.seq = p.seq ?? a.seq;
		a.pid ??= foregroundPid(pane);
		if (p.agent_session_path) a.session = { agent: p.agent, kind: "path", source: p.source, value: p.agent_session_path };
		else if (p.agent_session_id) a.session = { agent: p.agent, kind: "id", source: p.source, value: p.agent_session_id };
		stateDirty = true;
		if (firstSight) emit("pane_agent_detected", { pane_id: pane.id, workspace_id: pane.ws, agent: p.agent, final_status: null, released: false });
		if (firstSight || p.agent_session_path || p.agent_session_id) layoutDirty = true;
		setStatus(pane.id, reported(pane.id, p.state), p.message ?? undefined);
		renderStatus();
		flushEvents();
		return ok;
	},
	"pane.report_agent_session": (p) => {
		const pane = resolve(PANES, p.pane_id);
		const a = pane && S.agents[pane.id];
		if (!a) {
			// Session before the first state report: create the agent entry as idle.
			if (pane) H["pane.report_agent"]({ ...p, state: "idle" }, undefined as any);
			return ok;
		}
		if (p.agent_session_path) a.session = { agent: p.agent, kind: "path", source: p.source, value: p.agent_session_path };
		else if (p.agent_session_id) a.session = { agent: p.agent, kind: "id", source: p.source, value: p.agent_session_id };
		stateDirty = layoutDirty = true;
		return ok;
	},
	"pane.release_agent": (p) => {
		const pane = resolve(PANES, p.pane_id);
		if (pane && S.agents[pane.id]) (delete S.agents[pane.id], (stateDirty = true), emit("pane_agent_detected", { pane_id: pane.id, workspace_id: pane.ws, agent: null, final_status: null, released: true }), flushEvents());
		return ok;
	},

	"agent.list": () => ({ type: "agent_list", agents: snapshot().agents }),
	"agent.get": (p) => ({ type: "agent_info", agent: agentInfo(agentOf(p.target)) }),
	"agent.read": (p) => ({ type: "pane_read", read: readPane(agentOf(p.target), p.source, p.lines, p.format) }),
	"agent.send_keys": (p) => (sendKeys(agentOf(p.target), p.keys ?? []), ok),
	"agent.focus": (p) => (focusPane(agentOf(p.target), p.client), refresh(), { type: "agent_info", agent: agentInfo(agentOf(p.target)) }),
	"agent.rename": (p) => {
		const pane = agentOf(p.target);
		if (p.name) checkName(p.name, pane.id);
		S.agents[pane.id].name = p.name ?? undefined;
		stateDirty = true;
		return { type: "agent_info", agent: agentInfo(pane) };
	},
	"agent.start": async (p) => {
		checkName(p.name);
		const pane = paneOf(p.pane_id);
		const bin = KINDS[p.kind] ?? p.kind;
		const t0 = Date.now();
		const timeout = p.timeout_ms ?? 30000;
		// The pane's shell may still be starting: wait for it to own the foreground.
		while (!atShell(pane)) {
			if (S.agents[pane.id]) fail("pane_not_available", `pane ${pane.id} already hosts an agent`);
			if (Date.now() - t0 > Math.min(timeout, 10000)) fail("agent_pane_busy", `pane ${pane.id} is not at a shell prompt`);
			await Bun.sleep(100);
		}
		pendingNames.set(pane.id, p.name);
		const argv = [bin, ...(p.args ?? [])];
		pasteText(pane, argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : q(a))).join(" "));
		sendKeys(pane, ["enter"]);
		const up = await waitFor(() => !!S.agents[pane.id] && S.agents[pane.id].status !== "unknown" && S.agents[pane.id].status !== "working", timeout - (Date.now() - t0));
		if (!up) fail("timeout", `agent ${p.name} did not report ready within ${timeout}ms`);
		const a = S.agents[pane.id];
		a.name = p.name;
		stateDirty = true;
		if (a.status === "blocked") fail("agent_not_ready", `agent ${p.name} is blocked at startup`);
		return { type: "agent_started", agent: agentInfo(pane), argv };
	},
	"agent.prompt": async (p) => {
		const pane = await wakeAgent(p.target);
		const a = S.agents[pane.id];
		if (a.status === "blocked") fail("agent_blocked", `agent ${p.target} is blocked on a dialog`);
		const t0 = Date.now();
		const act0 = a.activity;
		const wasWorking = a.status === "working";
		pasteText(pane, p.text);
		await Bun.sleep(30);
		sendKeys(pane, ["enter"]);
		if (!p.wait) return { type: "agent_prompted", agent: agentInfo(pane) };
		const timeout = p.wait.timeout_ms ?? p.timeout_ms;
		const left = () => (timeout == null ? null : timeout - (Date.now() - t0));
		if (!wasWorking) {
			const gate = left() == null ? 5000 : Math.min(5000, left()!);
			const moved = await waitFor(() => (S.agents[pane.id]?.activity ?? act0) > act0, gate);
			if (!moved) fail(left() != null && left()! <= 0 ? "timeout" : "agent_prompt_stalled", "no working state observed after the prompt");
		}
		return waitAgent(pane, p.wait.until, left());
	},
	"agent.wait": (p) => waitAgent(agentOf(p.target), p.until, p.timeout_ms),

	"notification.show": (p) => (notify(p.title, p.body, p.sound), { type: "notification_show" }),
	"events.subscribe": (p, ctx) => {
		subs.add({ sock: ctx.sock, types: new Set((p.subscriptions ?? []).map((s: any) => String(s.type).replace(/\./g, "_"))) });
		return { type: "subscription_started" };
	},
	// Herdr-plugin/sidebar APIs whose behavior ag-mux builds in.
	"agent.view.set": () => ok,
	"agent.view.clear": () => ok,
	"layout.save": () => (saveLayout(true), { type: "ok", file: LAYOUT_FILE }),
	"layout.restore": (p) => {
		const layout = JSON.parse(readFileSync(p.from ?? LAYOUT_FILE, "utf8"));
		return { type: "ok", restored: restore(layout, { awake: !!p.awake }) };
	},
};
const pendingNames = new Map<string, string>();

function checkName(name: string, self?: string) {
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) fail("invalid_agent_name", `agent name ${name} must match [a-z][a-z0-9_-]{0,31}`);
	for (const [id, a] of Object.entries(S.agents)) if (a.name === name && id !== self && PANES.has(id)) fail("agent_name_taken", `agent name ${name} is in use`);
}
async function waitAgent(pane: Pane, until: Status[] | undefined, timeout?: number | null) {
	const want = new Set<Status>(until?.length ? until : ["idle", "done", "blocked"]);
	const hit = await waitFor(() => !S.agents[pane.id] || want.has(S.agents[pane.id].status), timeout);
	if (!S.agents[pane.id]) fail("agent_not_found", `agent in ${pane.id} exited`);
	if (!hit) fail("timeout", `agent did not reach ${[...want].join("/")} in time`);
	return { type: "agent_info", agent: agentInfo(PANES.get(pane.id)!) };
}

function notify(title: string, body?: string | null, sound?: string | null) {
	const text = body ? `${title}: ${body}` : title;
	const cmds: string[][] = [];
	for (const c of CLIENTS.filter((c) => !c.control)) {
		cmds.push(["display-message", "-c", c.name, "-d", "5000", esc(text)]);
		// OSC 9 straight to the client's terminal so Ghostty raises a desktop notification.
		try {
			writeFileSync(c.tty, `\x1b]9;${text.replace(/[\x00-\x1f\x07]/g, " ")}\x07${sound && sound !== "none" ? "\x07" : ""}`);
		} catch {}
	}
	tmuxBatch(cmds);
}

// ───────────────────────── layout persistence ─────────────────────────

type SavedTab = { id: string; label: string; root: Node; active_pane?: string };
type SavedWs = { id: string; label: string; order: number; tabs: SavedTab[]; active_tab?: string };
type Layout = { version: 1; saved_at: string; source: string; workspaces: SavedWs[] };

function currentLayout(): Layout {
	return {
		version: 1, saved_at: new Date().toISOString(), source: "ag-mux",
		workspaces: orderedWs().map((w, i) => ({
			id: w.id, label: w.label, order: i + 1, active_tab: w.activeTab,
			tabs: w.tabs.map((tid) => {
				const t = TABS.get(tid)!;
				return { id: t.id, label: t.label, root: layoutTree(t).root, active_pane: t.activePane };
			}),
		})),
	};
}
function saveLayout(force = false) {
	if (!serverUp || (!force && !layoutDirty) || !WS.size) return;
	layoutDirty = false;
	if (existsSync(LAYOUT_FILE)) {
		try {
			renameSync(LAYOUT_FILE, `${LAYOUT_FILE.replace(/\.json$/, "")}.prev.json`);
		} catch {}
	}
	writeAtomic(LAYOUT_FILE, JSON.stringify(currentLayout(), null, 1));
}

// Recreate a saved layout. Agent panes come back asleep (`ag-mux _sleep … && pi --session …`) and wake
// when a client looks at them, so a restore doesn't start every Pi at once.
function restore(layout: Layout, opts: { awake: boolean }) {

	const known = (id?: string) => !!id && (WS.has(id) || TABS.has(id) || PANES.has(id));
	let made = { ws: 0, tabs: 0, agents: 0 };
	for (const sw of layout.workspaces) {
		let w = [...WS.values()].find((x) => x.id === sw.id || x.label === sw.label);
		for (const st of sw.tabs) {
			if (known(st.id)) continue;
			const nodes = leaves(st.root);
			const first = nodes[0];
			const firstPane = first?.pane_id && !known(first.pane_id) ? first.pane_id : undefined;
			if (!w) {
				const r = createWorkspace({ label: sw.label, cwd: first?.cwd, focus: false, ids: { ws: known(sw.id) ? undefined : sw.id, tab: st.id, pane: firstPane }, tabLabel: st.label });
				w = WS.get(r.workspace.workspace_id)!;
				made.ws++;
			} else createTab({ workspace_id: w.id, cwd: first?.cwd, label: st.label, focus: false, ids: { tab: st.id, pane: firstPane } });
			made.tabs++;
			const t = TABS.get(st.id)!;
			const panes: string[] = [t.panes[0]];
			const build = (n: Node, pane: string) => {
				if (n.type === "pane") return;
				const l2 = leaves(n.second)[0];
				const second = splitPane({ target_pane_id: pane, direction: n.direction, ratio: n.ratio, cwd: l2?.cwd, focus: false, ids: { pane: l2?.pane_id && !known(l2.pane_id) ? l2.pane_id : undefined } });
				build(n.first, pane);
				panes.push(second.id);
				build(n.second, second.id);
			};
			build(st.root, t.panes[0]);
			// panes[] follows split order; match leaves to panes by position in the rebuilt tree.
			const rebuilt = leaves(layoutTree(TABS.get(st.id)!).root);
			nodes.forEach((n, i) => {
				const pid = rebuilt[i]?.pane_id;
				const sess = n.session;
				if (!pid || n.agent !== "pi" || !sess || !existsSync(sess)) return;
				const pane = PANES.get(pid)!;
				const cmd = opts.awake ? `pi --session ${q(sess)}` : `${q(SLEEP)} ${q(sess)} && pi --session ${q(sess)}`;
				if (!opts.awake) tmux(["set-option", "-p", "-t", pane.tp, "@ag_sleep", sess]);
				pasteText(pane, ` ${cmd}`);
				sendKeys(pane, ["enter"]);
				made.agents++;
			});
		}
		if (w) S.order[w.id] = sw.order;
	}
	stateDirty = layoutDirty = true;
	refresh();
	return made;
}

// ───────────────────────── daemon ─────────────────────────

// After a fresh tmux server start, bring back the saved layout; an empty running server just gets an Inbox.
function restoreOrInbox(fresh: boolean) {
	let restored = false;
	if (fresh && existsSync(LAYOUT_FILE) && process.env.AG_MUX_NO_RESTORE !== "1") {
		try {
			const r = restore(JSON.parse(readFileSync(LAYOUT_FILE, "utf8")), { awake: false });
			console.log(new Date().toISOString(), "restored", JSON.stringify(r));
			restored = r.tabs > 0;
		} catch (e) {
			console.error(new Date().toISOString(), "restore failed", e);
			try {
				writeFileSync(`${STATE_DIR}/layout.failed-${Date.now()}.json`, readFileSync(LAYOUT_FILE));
			} catch {}
		}
	}
	if (!restored && !WS.size) createWorkspace({ label: INBOX, cwd: HOME, focus: false });
}

function ensureServer() {
	if (tmuxRaw(["has-session"]).code === 0 || tmuxRaw(["list-sessions"]).code === 0) {
		tmuxRaw(["source-file", CONF]);
		return false;
	}
	Bun.spawnSync(["tmux", "-L", TMUX_L, "-f", CONF, "start-server"]);
	return true;
}

async function daemon() {
	mkdirSync(STATE_DIR, { recursive: true });
	// One agd per socket: two would race each other when restoring.
	if (existsSync(SOCK) && (await call("ping", {}).then((r) => !r.error, () => false))) {
		console.error(`agd already running on ${SOCK}`);
		process.exit(1);
	}
	loadState();
	const fresh = ensureServer();
	tmuxBatch([
		["set-environment", "-g", "HERDR_ENV", "1"], ["set-environment", "-g", "AG_MUX", "1"], ["set-environment", "-g", "HERDR_SOCKET_PATH", SOCK],
		...["HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID"].map((k) => ["set-environment", "-g", "-u", k]),
	]);
	refresh();
	if (fresh || !WS.size) restoreOrInbox(fresh);
	if (existsSync(SOCK)) unlinkSync(SOCK);
	const server = net.createServer((sock) => {
		let buf = "";
		sock.setEncoding("utf8");
		sock.on("data", (d) => {
			buf += d;
			for (let i; (i = buf.indexOf("\n")) >= 0; ) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (line.trim()) void handle(sock, line);
			}
		});
		sock.on("error", () => {});
		sock.on("close", () => {
			for (const s of subs) if (s.sock === sock) subs.delete(s);
		});
	});
	server.listen(SOCK);
	console.log(new Date().toISOString(), `agd listening on ${SOCK} (tmux -L ${TMUX_L})`);
	setInterval(() => {
		try {
			refresh();
			// tmux server gone (crash, kill-server, reboot): start a new one and bring the layout back.
			if (!serverUp) {
				console.error(new Date().toISOString(), "tmux server is gone; restarting it");
				byTmux.clear(); // tmux reuses $/@/% ids on a new server
				ensureServer();
				refresh();
				if (serverUp) restoreOrInbox(true);
			} else if (!WS.size) restoreOrInbox(false);
			saveState();
		} catch (e) {
			console.error(new Date().toISOString(), "refresh failed", e);
		}
	}, POLL_MS);
	setInterval(() => saveLayout(), 2000);
	const bye = () => (saveState(), saveLayout(true), process.exit(0));
	process.on("SIGTERM", bye);
	process.on("SIGINT", bye);
}

async function handle(sock: net.Socket, line: string) {
	let req: any;
	try {
		req = JSON.parse(line);
	} catch {
		return sock.write(`${JSON.stringify({ id: null, error: { code: "invalid_json", message: "request is not JSON" } })}\n`);
	}
	try {
		const h = H[req.method] ?? fail("unknown_method", `unknown method ${req.method}`);
		if (!serverUp && req.method !== "ping") refresh();
		const result = await h(req.params ?? {}, { sock });
		saveState();
		sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
	} catch (e: any) {
		const error = e instanceof MuxError ? { code: e.code, message: e.message } : { code: "internal", message: String(e?.message ?? e) };
		sock.write(`${JSON.stringify({ id: req.id, error })}\n`);
	}
}

// ───────────────────────── client side ─────────────────────────

function call(method: string, params: Params, id = `cli:${method}`): Promise<any> {
	return new Promise((resolve, reject) => {
		const s = net.createConnection(SOCK);
		let buf = "";
		s.setEncoding("utf8");
		s.on("connect", () => s.write(`${JSON.stringify({ id, method, params })}\n`));
		s.on("data", (d) => {
			buf += d;
			const i = buf.indexOf("\n");
			if (i >= 0) (s.destroy(), resolve(JSON.parse(buf.slice(0, i))));
		});
		s.on("error", reject);
		s.on("close", () => reject(new Error("agd closed the connection")));
	});
}
function backend(): "tmux" | "herdr" {
	const b = process.env.AG_MUX_BACKEND;
	if (b === "tmux" || b === "herdr") return b;
	if (process.env.AG_MUX === "1") return "tmux"; // inside an ag-mux pane
	if (process.env.HERDR_ENV === "1") return "herdr"; // inside a Herdr pane
	if (existsSync(SOCK)) return "tmux";
	return herdrBin() ? "herdr" : "tmux";
}
function herdrBin(): string | undefined {
	for (const d of (process.env.PATH ?? "").split(":")) {
		const f = `${d}/herdr`;
		if (existsSync(f)) return f;
	}
	const f = `${HOME}/.local/bin/herdr`;
	return existsSync(f) ? f : undefined;
}

// Parse Herdr-style args: positionals, --flag value, --bool, repeated --until, and `--` rest.
const BOOL = new Set(["--focus", "--no-focus", "--current", "--wait", "--new-tab", "--new-workspace", "--ansi", "--raw", "--json", "--clear", "--toggle", "--on", "--off", "--awake", "--all"]);
function parse(argv: string[]) {
	const pos: string[] = [];
	const fl: Record<string, string> = {};
	const multi: Record<string, string[]> = {};
	let rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		let a = argv[i];
		if (a === "--") {
			rest = argv.slice(i + 1);
			break;
		}
		if (a.startsWith("--")) {
			let v: string | undefined;
			if (a.includes("=")) [a, v] = [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)];
			if (BOOL.has(a)) fl[a] = "1";
			else {
				v ??= argv[++i];
				fl[a] = v;
				(multi[a] ??= []).push(v);
			}
		} else pos.push(a);
	}
	return { pos, fl, multi, rest };
}
const envMap = (vals?: string[]) => (vals ? Object.fromEntries(vals.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)])) : undefined);
const focusFlag = (fl: Record<string, string>) => (fl["--no-focus"] ? false : fl["--focus"] ? true : undefined);
const callerPane = () => process.env.HERDR_PANE_ID || process.env.TMUX_PANE;

// CLI → [method, params, output mode].
function toRequest(group: string, cmd: string, args: string[]): [string, Params, "json" | "text" | "status"] {
	const { pos, fl, multi, rest } = parse(args);
	const num = (k: string) => (fl[k] != null ? Number(fl[k]) : undefined);
	const paneArg = () => fl["--pane"] ?? (fl["--current"] ? callerPane() : pos[0]) ?? callerPane();
	const readSrc = () => (fl["--source"] ?? "recent").replace(/-/g, "_");
	const readFmt = () => (fl["--ansi"] ? "ansi" : (fl["--format"] ?? "text"));
	switch (`${group} ${cmd}`) {
		case "workspace list": return ["workspace.list", {}, "json"];
		case "workspace get": return ["workspace.get", { workspace_id: pos[0] }, "json"];
		case "workspace create": return ["workspace.create", { cwd: fl["--cwd"], label: fl["--label"], focus: focusFlag(fl), env: envMap(multi["--env"]) }, "json"];
		case "workspace focus": return ["workspace.focus", { workspace_id: pos[0], client: fl["--client"] }, "json"];
		case "workspace rename": return ["workspace.rename", { workspace_id: pos[0], label: pos[1] }, "json"];
		case "workspace close": return ["workspace.close", { workspace_id: pos[0] }, "json"];
		case "tab list": return ["tab.list", { workspace_id: fl["--workspace"] }, "json"];
		case "tab get": return ["tab.get", { tab_id: pos[0] }, "json"];
		case "tab create": return ["tab.create", { workspace_id: fl["--workspace"], cwd: fl["--cwd"], label: fl["--label"], focus: focusFlag(fl), env: envMap(multi["--env"]) }, "json"];
		case "tab focus": return ["tab.focus", { tab_id: pos[0], client: fl["--client"] }, "json"];
		case "tab rename": return ["tab.rename", { tab_id: pos[0], label: pos[1] }, "json"];
		case "tab close": return ["tab.close", { tab_id: pos[0] }, "json"];
		case "pane list": return ["pane.list", { workspace_id: fl["--workspace"] }, "json"];
		case "pane get": return ["pane.get", { pane_id: pos[0] }, "json"];
		case "pane current": return ["pane.current", { caller_pane_id: fl["--pane"] ?? callerPane() }, "json"];
		case "pane layout": return ["pane.layout", { pane_id: paneArg() }, "json"];
		case "pane process-info": return ["pane.process_info", { pane_id: paneArg() }, "json"];
		case "pane neighbor": return ["pane.neighbor", { pane_id: paneArg(), direction: fl["--direction"] }, "json"];
		case "pane split": return ["pane.split", { target_pane_id: paneArg(), direction: fl["--direction"] ?? "right", ratio: num("--ratio"), cwd: fl["--cwd"], focus: focusFlag(fl), env: envMap(multi["--env"]) }, "json"];
		case "pane close": return ["pane.close", { pane_id: pos[0] }, "json"];
		case "pane focus": return ["pane.focus", { pane_id: paneArg(), client: fl["--client"] }, "json"];
		case "pane rename": return ["pane.rename", { pane_id: pos[0], label: fl["--clear"] ? "" : pos[1] }, "json"];
		case "pane send-text": return ["pane.send_text", { pane_id: pos[0], text: pos[1] ?? "" }, "json"];
		case "pane send-keys": return ["pane.send_keys", { pane_id: pos[0], keys: pos.slice(1) }, "json"];
		case "pane run": return ["pane.send_input", { pane_id: pos[0], text: pos[1] ?? "", keys: ["enter"] }, "json"];
		case "pane read": return ["pane.read", { pane_id: pos[0], source: readSrc(), lines: num("--lines"), format: readFmt() }, "text"];
		case "pane wait-output": return ["pane.wait_for_output", { pane_id: pos[0], match: fl["--regex"] != null ? { type: "regex", value: fl["--regex"] } : { type: "substring", value: fl["--match"] }, source: readSrc(), lines: num("--lines"), timeout_ms: num("--timeout") }, "json"];
		case "pane swap": return ["pane.swap", { source_pane_id: fl["--source-pane"], target_pane_id: fl["--target-pane"] }, "json"];
		case "pane move":
			return ["pane.move", {
				pane_id: pos[0], focus: focusFlag(fl),
				destination: fl["--new-tab"] ? { type: "new_tab", workspace_id: fl["--workspace"], label: fl["--label"] } : fl["--new-workspace"] ? { type: "new_workspace", label: fl["--label"], tab_label: fl["--tab-label"] } : { type: "tab", tab_id: fl["--tab"], split: fl["--split"], target_pane_id: fl["--target-pane"], ratio: num("--ratio") },
			}, "json"];
		case "pane report-agent": return ["pane.report_agent", { pane_id: pos[0], source: fl["--source"], agent: fl["--agent"], state: fl["--state"], message: fl["--message"], seq: num("--seq"), agent_session_id: fl["--agent-session-id"], agent_session_path: fl["--agent-session-path"] }, "json"];
		case "pane report-agent-session": return ["pane.report_agent_session", { pane_id: pos[0], source: fl["--source"], agent: fl["--agent"], seq: num("--seq"), agent_session_id: fl["--agent-session-id"], agent_session_path: fl["--agent-session-path"] }, "json"];
		case "pane release-agent": return ["pane.release_agent", { pane_id: pos[0], source: fl["--source"], agent: fl["--agent"], seq: num("--seq") }, "json"];
		case "pane register": return ["pane.register", { tmux_pane: pos[0] ?? process.env.TMUX_PANE }, "json"];
		case "agent list": return ["agent.list", {}, "json"];
		case "agent get": return ["agent.get", { target: pos[0] }, "json"];
		case "agent read": return ["agent.read", { target: pos[0], source: readSrc(), lines: num("--lines"), format: readFmt() }, "text"];
		case "agent send-keys": return ["agent.send_keys", { target: pos[0], keys: pos.slice(1) }, "json"];
		case "agent focus": return ["agent.focus", { target: pos[0], client: fl["--client"] }, "json"];
		case "agent rename": return ["agent.rename", { target: pos[0], name: fl["--clear"] ? null : pos[1] }, "json"];
		case "agent start": return ["agent.start", { name: pos[0], kind: fl["--kind"], pane_id: fl["--pane"], timeout_ms: num("--timeout"), args: rest }, "json"];
		case "agent prompt": return ["agent.prompt", { target: pos[0], text: pos[1] ?? "", wait: fl["--wait"] || multi["--until"] ? { until: multi["--until"], timeout_ms: num("--timeout") } : null }, "json"];
		case "agent wait": return ["agent.wait", { target: pos[0], until: multi["--until"], timeout_ms: num("--timeout") }, "json"];
		case "notification show": return ["notification.show", { title: pos[0], body: fl["--body"], sound: fl["--sound"] }, "json"];
		case "api snapshot": return ["session.snapshot", {}, "json"];
		case "api ping": return ["ping", {}, "json"];
		case "server reload-config": return ["server.reload_config", {}, "json"];
	}
	console.error(JSON.stringify({ error: { code: "unknown_command", message: `ag-mux: unknown command: ${group} ${cmd}` }, id: null }));
	process.exit(2);
}

async function cli(argv: string[]) {
	const [group, cmd, ...rest] = argv;
	if (group === "status") {
		const up = await call("ping", {}).then(() => true, () => false);
		console.log(`ag-mux backend: tmux (-L ${TMUX_L})\nstatus: ${up ? "running" : "stopped"}\nsocket: ${SOCK}`);
		return process.exit(up ? 0 : 1);
	}
	const [method, params, mode] = toRequest(group, cmd ?? "", rest);
	let res: any;
	try {
		res = await call(method, params, `cli:${group}:${cmd}`);
	} catch (e: any) {
		console.error(JSON.stringify({ error: { code: "server_unavailable", message: `agd not reachable at ${SOCK}: ${e?.message}` }, id: null }));
		process.exit(1);
	}
	if (res.error) {
		console.error(JSON.stringify(res));
		process.exit(1);
	}
	if (mode === "text") process.stdout.write(res.result.read.text);
	else console.log(JSON.stringify(res));
}

// ───────────────────────── other commands ─────────────────────────

async function attach(target?: string) {
	if (!(await call("ping", {}).then(() => true, () => false))) {
		Bun.spawn([process.execPath, process.argv[1], "daemon"], { stdio: ["ignore", Bun.file(`${STATE_DIR}/agd.log`), Bun.file(`${STATE_DIR}/agd.log`)] }).unref();
		for (let i = 0; i < 50 && !(await call("ping", {}).then(() => true, () => false)); i++) await Bun.sleep(100);
	}
	const snap = (await call("session.snapshot", {})).result.snapshot;
	const w = snap.workspaces.find((x: any) => x.label === target || x.workspace_id === target) ?? snap.workspaces.find((x: any) => x.focused) ?? snap.workspaces[0];
	const args = process.env.TMUX && process.env.AG_MUX === "1" ? ["switch-client", "-t", w.tmux_session] : ["attach-session", "-t", w.tmux_session];
	const r = Bun.spawnSync(["tmux", "-L", TMUX_L, ...args], { stdio: ["inherit", "inherit", "inherit"] });
	process.exit(r.exitCode ?? 0);
}

// Fuzzy tab switcher: every tab, needs-you first, then most recent agent change.
async function switcher(client?: string) {
	const snap = (await call("session.snapshot", {})).result.snapshot;
	const ws = Object.fromEntries(snap.workspaces.map((w: any) => [w.workspace_id, w.label]));
	const agentByTab = new Map<string, any>();
	for (const a of snap.agents) if (!agentByTab.has(a.tab_id)) agentByTab.set(a.tab_id, a);
	const icon: Record<string, string> = { blocked: "⚠", done: "●", working: "…", idle: " ", unknown: " " };
	const rows = snap.tabs
		.map((t: any) => {
			const a = agentByTab.get(t.tab_id);
			const rank = t.agent_status === "blocked" ? 3 : t.agent_status === "done" ? 2 : t.agent_status === "working" ? 1 : 0;
			return { t, rank, seq: a?.state_change_seq ?? 0 };
		})
		.sort((x: any, y: any) => y.rank - x.rank || y.seq - x.seq)
		.map(({ t }: any) => `${t.tab_id}\t${icon[t.agent_status] ?? " "} ${ws[t.workspace_id]} › ${t.label}`);
	const fzf = Bun.spawnSync(["fzf", "--with-nth=2..", "--delimiter=\t", "--prompt=tab> ", "--no-sort", "--reverse"], { stdin: Buffer.from(rows.join("\n")), stdout: "pipe", stderr: "inherit" });
	const pick = fzf.stdout.toString().split("\t")[0]?.trim();
	if (pick) await call("tab.focus", { tab_id: pick, client });
}

// Sleep screen for restored panes: any key (or a client viewing the tab) resumes the session.
function sleepScreen(sess: string) {
	process.stdout.write(`\x1b[2J\x1b[H  💤 Pi session asleep (restored by ag-mux):\n  ${sess}\n\n  Resuming when you open this tab. Any key resumes; Ctrl+C gives a shell.\n`);
	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdin.once("data", (d) => process.exit(d.includes(3) ? 130 : 0));
}

const SKILL = `# ag-mux (Ag on tmux)

ag-mux is Ag's session layer: tmux (\`tmux -L ag\`) runs the terminals and agd adds workspaces, tabs, panes
with stable IDs, agent states, snapshots, and events. The CLI mirrors Herdr's: \`ag-mux workspace|tab|pane|agent
|notification|api …\`, JSON on stdout, errors as JSON on stderr (exit 1; syntax errors exit 2).

- Workspace = tmux session, tab = window, pane = pane. IDs look like \`w3\`, \`w3:t8\`, \`w3:p4\`; a pane keeps
  its ID when its tab moves to another workspace.
- Agent states: idle / working / blocked / done (finished, not yet seen) / unknown. Agents report their own
  state through hooks; \`agent start|prompt [--wait]|wait|read|send-keys\` work as in Herdr.
- \`pane read --source visible|recent|recent-unwrapped\`, \`pane wait-output --match|--regex\`, \`pane run\`,
  \`pane send-text\`, \`pane send-keys\`. Use \`--no-focus\` for background work.
- Don't run \`tmux attach\` or bare \`ag-mux attach\` from inside a pane. Raw tmux is \`tmux -L ag …\`.
`;

// ───────────────────────── main ─────────────────────────

process.on("uncaughtException", (e: any) => {
	console.error(JSON.stringify({ error: { code: e?.code ?? "error", message: String(e?.message ?? e) }, id: null }));
	process.exit(1);
});
const argv = process.argv.slice(2);
const top = argv[0];
if (top === "daemon") await daemon();
else if (top === "_ping") process.exit((await call("ping", {}).then((r) => !r.error, () => false)) ? 0 : 1);
else if (top === "_sleep") sleepScreen(argv[1] ?? "");
else if (top === "--skill") console.log(SKILL);
else if (top === "_raw") {
	// One raw socket request from stdin ({"method","params"}), for tests and debugging.
	const req = JSON.parse(await Bun.stdin.text());
	console.log(JSON.stringify(await call(req.method, req.params ?? {}, req.id ?? "raw")));
}
else if (top === "backend") console.log(backend());
else if (top === "attach" || top === undefined) {
	if (backend() === "herdr" && top === undefined) fail("usage", "run `herdr` to attach to Herdr");
	await attach(argv[1]);
} else if (top === "switch") await switcher(parse(argv.slice(1)).fl["--client"]);
else if (top === "save") {
	const r = await call("layout.save", {});
	console.log(JSON.stringify(r));
} else if (top === "restore") {
	const { fl, multi } = parse(argv.slice(1));
	const r = await call("layout.restore", { from: fl["--from"], awake: !!fl["--awake"] });
	console.log(JSON.stringify(r));
	if (r.error) process.exit(1);
} else if (backend() === "herdr") {
	const h = herdrBin() ?? fail("no_backend", "no agd socket and no herdr binary");
	const r = Bun.spawnSync([h, ...argv], { stdio: ["inherit", "inherit", "inherit"] });
	process.exit(r.exitCode ?? 1);
} else await cli(argv);

