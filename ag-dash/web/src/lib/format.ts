import type { Card } from "./types";

// No emoji anywhere in the app: ag-tickler/wake-up icons become plain text glyphs, every other emoji is dropped.
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u{1F000}-\u{1FAFF}])(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F?|[\u{1F000}-\u{1FAFF}]))*[\u{1F3FB}-\u{1F3FF}]?\uFE0F?( ?)/gu;
const EMOJI_TEXT: Record<string, string> = { "⏰": "◷", "🔔": "↺", "🟢": "●", "⏳": "⧖", "⌛": "⧖", "✅": "✓", "❌": "✗", "⚠": "!", "🔄": "↻", "💤": "z" };
export const noEmoji = (s: unknown) =>
	String(s ?? "").replace(EMOJI_RE, (m, sp) => {
		const t = EMOJI_TEXT[m.trim().replace(/\uFE0F/g, "")];
		return t ? t + sp : "";
	});

// What ag-dash sends, read with every emoji already turned into text (titles, messages, chips, search results).
export const cleanJson = async <T = any>(r: Response): Promise<T> => JSON.parse(noEmoji(await r.text()));

export const esc = (s: unknown) => noEmoji(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function ago(ts?: number, now = Date.now()) {
	if (!ts) return "";
	const s = (now - ts) / 1000;
	if (s < 60) return "now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
	return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dur(ms: number) {
	const s = Math.max(1, Math.round(ms / 1000));
	return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const shortModel = (m?: string | null) =>
	(m || "")
		.split("/")
		.pop()!
		.replace(/^claude-/, "Claude ")
		.replace(/^gpt-/, "GPT-")
		.replace(/-(\d)-(\d)/, " $1.$2")
		.replace(/-/g, " ");

export const tildify = (p?: string) => (p || "").replace(/^\/home\/[^/]+|^\/Users\/[^/]+/, "~");

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- card facts (one definition each, used everywhere) ----------
export const lastAt = (c: Card) => Math.max(c.lastUser?.ts || 0, c.lastAssistant?.ts || 0, c.activity?.since || 0, c.statusSince || 0, c.startedAt || 0);
export const isWorking = (c?: Card | null) => !!c && c.status === "working";
export const isWaiting = (c: Card) => !!c.waiting?.length;
export const needsYou = (c: Card) => c.needsYou && !isWaiting(c);
export const urlOf = (c: Card) => (c.sid ? `/chat/${c.sid}` : `/chat/t/${encodeURIComponent(c.tab)}`);
export const refOf = (c: { sid?: string; tab?: string }) => (c.sid ? `sid=${c.sid}` : `tab=${encodeURIComponent(c.tab ?? "")}`);
// Where a chat's unsent text is kept: by session id (stable when its pane moves to another tab), else tab.
export const draftKeyOf = (c: { sid?: string; tab: string }) => (c.sid ? `s:${c.sid}` : `t:${c.tab}`);
export const snippet = (c: Card) =>
	(c.lastAssistant?.text || c.lastUser?.text || c.first || "")
		.replace(/[#*`>_[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
// What changes when the transcript does: the open chat refetches it when this does.
export const sigOf = (c: Card) => [c.lastUser?.ts, c.lastAssistant?.ts, c.tools?.length, c.tools?.at(-1)?.ts, c.tools?.at(-1)?.end, c.status, c.thinkingTs, c.stats?.tools].join("|");

export const newId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
