/**
 * Client-CUA guard: agents on ag must not drive the client Mac's desktop unless the thing exists
 * only there (a dialog or permission prompt showing on the client, iPhone Mirroring, a client-only
 * setting). Never "because it's already signed in on the client".
 *
 * Before a bash call that runs `client-cua` (or sets CLIENT_CUA_HOST, or SSHes to the client with
 * osascript / Hammerspoon UI control / cliclick), this asks `client-cua-gate` (Jev). Unjustified,
 * unsure, or Jev unreachable → the call is blocked with the reason, and the gate spins out a new
 * Inbox session to get the missing access onto ag. Allowed → the command gets a one-time
 * CLIENT_CUA_GATE_TOKEN so client-cua doesn't re-judge it. client-cua enforces the same gate for
 * non-Pi agents (Codex, Claude Code).
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GATE = `${homedir()}/.local/bin/client-cua-gate`;
// client-cua (or CLIENT_CUA_HOST=) in command position, not just mentioned (grep, cat, git diff).
const CUA = /(?:^|[;&|(\n`]|\$\(|\b(?:then|do|else|exec|env|time|nohup|timeout\s+\S+)\s)\s*(?:\w+=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:\S*\/)?client-cua(?=\s|$|[;&|)'"`])|\bCLIENT_CUA_HOST=/;
const CLIENT = /\bssh\b[^\n;|&]*?\b(nathan-dev-client|100\.68\.116\.104|nathans-macbook-pro-2)\b/i;
const UI = /\bosascript\b|System Events|\bcliclick\b|\bhs\b[^\n]*\b(eventtap|keyStroke|application|window|mouse|axuielement)/i;

function lastUserPrompt(ctx: any): string {
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const m = branch[i]?.message;
		if (branch[i]?.type !== "message" || m?.role !== "user") continue;
		const c = m.content;
		return (typeof c === "string" ? c : c.filter((x: any) => x.type === "text").map((x: any) => x.text).join(" ")).slice(0, 2000);
	}
	return "";
}

// The agent's own words right before the call (its reasoning for reaching for the client).
function lastAssistantText(ctx: any): string {
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	for (let i = branch.length - 1; i >= 0; i--) {
		const m = branch[i]?.message;
		if (branch[i]?.type !== "message" || m?.role !== "assistant" || !Array.isArray(m.content)) continue;
		const t = m.content.filter((x: any) => x.type === "text").map((x: any) => x.text).join(" ").trim();
		if (t) return t.slice(-1500);
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		// A bare `osascript -e 'display notification …'` (the "lock your iPhone" ping) isn't UI control.
		const notifyOnly = /display notification/.test(command) && !/tell app|System Events|keystroke|click|\bhs\b|cliclick/i.test(command);
		const kind = CUA.test(command) ? "cua" : CLIENT.test(command) && UI.test(command) && !notifyOnly ? "ssh" : null;
		if (!kind) return;

		const why = command.match(/CLIENT_CUA_WHY=("([^"]*)"|'([^']*)')/)?.slice(2).find(Boolean) ?? command.match(/--why\s+("([^"]*)"|'([^']*)')/)?.slice(2).find(Boolean) ?? "";
		const args = ["--kind", kind, "--why", [why, lastAssistantText(ctx)].filter(Boolean).join("\nAgent's message before the call: "), "--goal", lastUserPrompt(ctx), "--session", ctx.sessionManager.getSessionFile() ?? "", "--", command];
		const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
			execFile(GATE, args, { timeout: 60_000, maxBuffer: 1 << 20 }, (err: any, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })),
		);
		let verdict: any = null;
		try { verdict = JSON.parse(stdout.trim().split("\n").at(-1) ?? ""); } catch {}

		if (code === 0 && verdict?.allow && verdict.token) {
			event.input.command = `export CLIENT_CUA_GATE_TOKEN=${verdict.token}\n${command}`;
			return;
		}
		const reason = verdict?.reason ?? `Blocked by the client-CUA guard: the gate failed (${(stderr || stdout).trim().slice(0, 300) || `exit ${code}`}), so it fails closed. Do this on ag instead, or tell Nathan what ag is missing.`;
		ctx.ui.notify(`Client-CUA guard blocked a client desktop call. ${verdict?.access ?? ""}`, "warning");
		return { block: true, reason };
	});
}
