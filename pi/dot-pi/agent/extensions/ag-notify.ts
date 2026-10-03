// Texts the user's phone (via `ag-text`) when this session finishes a turn they'd want to know about:
//   ✅ Done · <tab>: <what happened, and what to do with it>
//   ⚠️ Attention needed · <tab>: <what's needed from the user>
//   <ag-session-link>   (opens this session in Moshi; see ag-file-inbox /m/<session>)
// A fast LLM writes the headline and decides Done vs Attention from the final reply.
// Sends only when it's worth it: the user is away (`ag-presence`), or the turn ran ≥ LONG_TURN_MS.
// Override per session with AG_NOTIFY=always|off. TUI root sessions only (not subagents/print mode).
// Status emoji on those texts are edited in place via `ag-telegram status|supersede`: when the user
// comes back to a session its latest text turns 🔄 (in progress), then ✅ or ⚠️ when the turn
// ends; a newer text from the same session turns the older ones ➡️ (followed up).
// Log: ~/.local/state/ag-notify/log.jsonl.
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LONG_TURN_MS = 2 * 60_000;
const WRITERS: [string, string][] = [
	["truefoundry-chat", "gemini-group/gemini-3.5-flash-lite"],
	["truefoundry-openai", "gpt-5.4-nano"],
];
const BIN = `${homedir()}/.local/bin`;
const LOG_DIR = `${homedir()}/.local/state/ag-notify`;

function log(data: Record<string, unknown>) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(`${LOG_DIR}/log.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n");
	} catch {}
}

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 }).trim();

function text(content: any): string {
	return typeof content === "string"
		? content
		: (content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

function away(): boolean {
	try {
		return JSON.parse(run(`${BIN}/ag-presence`, ["status", "--json"])).state !== "online";
	} catch {
		return true; // unknown → assume away; a spare text beats a missed one
	}
}

function tabLabel(): string {
	try {
		const pane = JSON.parse(run(`${BIN}/ag-mux`, ["pane", "current"])).result.pane;
		return JSON.parse(run(`${BIN}/ag-mux`, ["tab", "get", pane.tab_id])).result.tab.label;
	} catch {
		return "pi";
	}
}

export default function (pi: ExtensionAPI) {
	let root = false;
	let started = 0;
	let prompt = "";

	pi.on("session_start", (_e, ctx) => {
		root = ctx.mode === "tui" && process.env.AG_MUX === "1";
	});

	const tgStatus = (sessionFile: string, state: string) =>
		execFile(`${BIN}/ag-telegram`, ["status", sessionFile, state], { timeout: 30_000 }, () => {});

	pi.on("before_agent_start", (event, ctx) => {
		started = Date.now();
		prompt = event.prompt ?? "";
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (root && process.env.AG_NOTIFY !== "off" && sessionFile) tgStatus(sessionFile, "working");
	});

	pi.on("agent_settled", (_e, ctx) => {
		const mode = process.env.AG_NOTIFY ?? "auto";
		if (!root || mode === "off" || !started || ctx.isIdle() !== true) return;
		const took = Date.now() - started;
		started = 0;
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;

		void (async () => {
			try {
				const isAway = away();
				const send = mode === "always" || isAway || took >= LONG_TURN_MS;
				// Not texting: still settle a 🔄 left on this session's latest text.
				if (!send && run(`${BIN}/ag-telegram`, ["status", sessionFile]) !== "working") return;

				const last = ctx.sessionManager
					.getEntries()
					.filter((e: any) => e.type === "message" && e.message?.role === "assistant")
					.map((e: any) => text(e.message.content))
					.filter((t: string) => t.trim())
					.at(-1);
				if (!last) return;

				const model = WRITERS.map(([p, id]) => ctx.modelRegistry.find(p, id)).find(
					(m) => m && ctx.modelRegistry.hasConfiguredAuth(m),
				);
				let status = /\?\s*$/.test(last.trim()) ? "attention" : "done";
				let headline = last.replace(/\s+/g, " ").slice(0, 110);
				if (model) {
					const res = await ctx.modelRegistry.complete(
						model,
						{
							messages: [
								{
									role: "user",
									content: [
										{
											type: "text",
											text: `An AI coding agent just stopped working. Write the phone notification the user will read to decide how to handle it.
Reply with JSON only: {"status": "done" | "attention", "headline": "..."}
- "attention": the agent needs something from the user before it can continue (a question, a decision, approval, a login, a blocker).
- "done": the work is finished; nothing is required, or they just need to review/confirm the result.
- headline: at most 90 characters, plain words, no emoji. Say what happened AND what the user should do, e.g. "PR #412 merged to dev; nothing to do" or "Needs your Telegram bot token to finish the notifier".

The user's request: ${prompt.slice(0, 800)}

Agent's final reply:
${last.slice(-3000)}`,
										},
									],
									timestamp: Date.now(),
								},
							],
						},
						{ cacheRetention: "none" },
					);
					const j = JSON.parse(text(res.content).replace(/^[^{]*|[^}]*$/g, ""));
					if (j.status === "attention" || j.status === "done") status = j.status;
					if (typeof j.headline === "string" && j.headline.trim()) headline = j.headline.trim();
				}

				if (!send) {
					tgStatus(sessionFile, status);
					return log({ session: sessionFile, status, took, action: "status" });
				}
				const link = run(`${BIN}/ag-session-link`, [sessionFile]);
				const head = status === "attention" ? "⚠️ Attention needed" : "✅ Done";
				const msg = `${head} · ${tabLabel()}\n${headline}\n${link}`;
				execFile(`${BIN}/ag-text`, [msg], { timeout: 60_000, env: { ...process.env, AG_TEXT_SESSION: sessionFile, AG_TEXT_KIND: "notify" } }, (err, _o, stderr) =>
					log({ session: sessionFile, status, headline, took, away: isAway, sent: !err, error: err ? String(stderr || err) : undefined }),
				);
			} catch (e) {
				log({ session: sessionFile, action: "error", error: String(e) });
			}
		})();
	});
}
