// The shapes ag-dash's server sends (bin/dot-local/bin/ag-dash). Keep in step with its Card / board / transcript.

export type Status = "idle" | "done" | "blocked" | "working" | "unknown" | string;

export type Media = { src: string; kind: "image" | "video"; name: string };

export type Msg = { role: "user" | "assistant"; text: string; ts: number };

export type Tool = { name: string; detail: string; sum?: string; hosts?: string[]; ts: number; end?: number; error?: boolean };

export type Activity = { kind: "thinking" | "tool" | "idle" | "error"; since: number; tool?: string; detail?: string; sum?: string; hosts?: string[]; error?: string };

export type Waiting = { id?: string; title: string; kind: "check" | "event" | "online" | "at" | "person" | "manual"; detail: string; since?: number; due?: number };

export type Card = {
	tab: string;
	pane: string;
	title: string;
	status: Status;
	statusSince: number;
	pinned: boolean;
	pinnedAt?: number;
	needsYou: boolean;
	inbox: boolean;
	resolved: boolean;
	throb: boolean;
	ping: boolean;
	waiting: Waiting[];
	noWake?: { askedAt?: number; asks: number };
	focused: boolean;
	model?: string;
	thinkingLevel?: string;
	cwd?: string;
	startedAt?: number;
	first?: string;
	lastUser?: Msg;
	lastAssistant?: Msg;
	thinking?: string;
	thinkingTs?: number;
	activity?: Activity;
	tools: Tool[];
	media: Media[];
	stats: { cost: number; ctx: number; turns: number; tools: number };
	sessionFile?: string;
	sid?: string;
};

export type Mem = { usedPct: number; totalGB: number; availGB: number; swapUsedGB: number; swapTotalGB: number; psiSome: number; psiFull: number; level: "ok" | "warn" | "bad" };
export type CuaJob = { id: string; status: string; caller: string; task: string; urgent: boolean };
export type Sys = { mem?: Mem; cua?: { ok: boolean; error?: string; live: CuaJob[]; recent: CuaJob[] } };

export type Board = { cards: Card[]; page: number; sys?: Sys; rev: number; boot: string };

export type Origin = { kind: string; label?: string; title?: string; sid?: string };

export type ToolResult = { text: string; error: boolean; media: Media[] };

export type TxItem =
	| { k: string; role: "user"; ts: number; text: string; media?: Media[]; origins?: Origin[] }
	| { k: string; role: "assistant"; ts: number; text: string; media?: Media[] }
	| { k: string; role: "thinking"; ts: number; text: string }
	| { k: string; role: "error"; ts: number; text: string }
	| ({ k: string; role: "tool"; ts: number; args?: string; result?: ToolResult } & Omit<Tool, "ts">);

export type SessionInfo =
	| { state: "live"; sid: string; tab: string }
	| { state: "hibernated" | "closed"; sid: string; tab?: string; file: string; title: string; cwd?: string; startedAt?: number; lastAt: number; model?: string; stats: Card["stats"] }
	| { state: "missing"; sid: string };

export type Model = { id: string; name: string };
export type Config = { httpsUrl: string; home: string; userName: string; models: Model[]; defaultModel: string | null; pinnedModels: string[] };
