/**
 * Client-CUA guard: agents on ag-mac must not drive the client Mac's desktop unless the thing exists
 * only there (a dialog or permission prompt showing on the client, iPhone Mirroring, a client-only
 * setting). Never "because it's already signed in on the client".
 *
 * Before a bash call that runs `ag-client-cua` (or sets CLIENT_CUA_HOST, or SSHes to the client with
 * osascript / Hammerspoon UI control / cliclick), this asks `ag-client-cua-gate` (Jev). Unjustified,
 * unsure, or Jev unreachable → the call is blocked with the reason, and the gate spins out a new
 * Inbox session to get the missing access onto ag. Allowed → the command gets a one-time
 * CLIENT_CUA_GATE_TOKEN so ag-client-cua doesn't re-judge it. ag-client-cua enforces the same gate for
 * non-Pi agents (Codex, Claude Code).
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GATE = `${homedir()}/.local/bin/ag-client-cua-gate`;
// ag-client-cua (or CLIENT_CUA_HOST=) in command position, not just mentioned (grep, cat, git diff).
const CUA = /(?:^|[;&|(\n`'"]|\$\(|\b(?:then|do|else|exec|env|time|nohup|timeout\s+\S+)\s)\s*(?:\w+=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:\S*\/)?ag-client-cua(?=\s|$|[;&|)'"`])|\bCLIENT_CUA_HOST=/;
// Extra names the client answers to (old hostnames, its IP): $AG_CLIENT_ALIASES, else its line in ~/ag-personal/env.
const CLIENT_ALIASES = (process.env.AG_CLIENT_ALIASES || (() => { try { return readFileSync(`${homedir()}/ag-personal/env`, "utf8").match(/^AG_CLIENT_ALIASES=(.*)$/m)?.[1] ?? ""; } catch { return ""; } })())
	.split(/[\s,]+/).filter(Boolean).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const CLIENT = new RegExp(String.raw`\bssh\b[^\n;|&]*?\b(${["ag-client", ...CLIENT_ALIASES].join("|")})\b`, "i");
const UI = /\bosascript\b|System Events|\bcliclick\b|\bhs\b[^\n]*\b(eventtap|keyStroke|application|window|mouse|axuielement)/i;

// Text that is data, not code, must not trip the guard: heredoc bodies fed to non-shell commands
// (`cat > notes.md <<'EOF'` that mentions `ag-client-cua`) and, for the ag-client-cua check, quoted
// strings (grep patterns, commit messages, test fixtures like `t 'ssh ag-client …'`). Heredocs and
// strings handed to a shell, `hs -c` or ssh stay in.
const SHELLISH = /\b(?:ba|z|da)?sh\b|\bssh\b|\beval\b|\bsource\b|\bxargs\b/;
function stripHeredocs(cmd: string): string {
	const lines = cmd.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		out.push(line);
		const m = line.match(/<<-?\s*(['"]?)(\w+)\1/);
		if (!m) continue;
		const before = line.slice(0, m.index).split(/[;&|]/).at(-1) ?? "";
		let j = i + 1;
		while (j < lines.length && lines[j].trim() !== m[2]) j++;
		if (SHELLISH.test(before)) continue; // executed: keep the body for matching
		i = j - 1; // skip body; the delimiter line is pushed next iteration
	}
	return out.join("\n");
}
function stripQuotedData(cmd: string): string {
	// Placeholder is not a quote: a leftover `''` followed by a space looked like command position,
	// so `sed -i '' … bin/ag-client-cua` or `grep 'x' …/ag-client-cua` (editing the script) got blocked.
	// Only a shell's (or Hammerspoon's) `-c` runs its string; `grep -c`/`jq -c` patterns are data.
	return cmd.replace(/(\b(?:(?:ba|z|da)?sh|hs)\s+-\w*c\s+|\bssh\b[^'"\n]*)?('[^']*'|"(?:[^"\\]|\\.)*")/g, (all, exec) => (exec ? all : "_"));
}

// The session's goal: its first prompt (the task) plus the latest one, if different. The latest alone
// is often a mid-task aside (a coordination note) that hides why the client is needed (e.g. the task
// is iPhone Mirroring verification), which made Jev block legitimate phone work.
function sessionGoal(ctx: any): string {
	const branch = ctx.sessionManager.getBranch?.() ?? [];
	const prompts = branch
		.filter((e: any) => e?.type === "message" && e.message?.role === "user")
		.map((e: any) => { const c = e.message.content; return typeof c === "string" ? c : c.filter((x: any) => x.type === "text").map((x: any) => x.text).join(" "); })
		.filter(Boolean);
	if (!prompts.length) return "";
	const first = prompts[0], last = prompts.at(-1);
	return last === first ? first.slice(0, 2000) : `Task (first prompt): ${first.slice(0, 1400)}\nLatest prompt: ${last.slice(0, 600)}`;
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
		const scan = stripHeredocs(command);
		// A bare `osascript -e 'display notification …'` (the "lock your iPhone" ping) isn't UI control.
		const notifyOnly = /display notification/.test(command) && !/tell app|System Events|keystroke|click|\bhs\b|cliclick/i.test(command);
		const scanCode = stripQuotedData(scan);
		const kind = CUA.test(scanCode) ? "cua" : CLIENT.test(scanCode) && UI.test(scanCode) && !notifyOnly ? "ssh" : null;
		if (!kind) return;

		const why = command.match(/CLIENT_CUA_WHY=("([^"]*)"|'([^']*)')/)?.slice(2).find(Boolean) ?? command.match(/--why\s+("([^"]*)"|'([^']*)')/)?.slice(2).find(Boolean) ?? "";
		const args = ["--kind", kind, "--why", [why, lastAssistantText(ctx)].filter(Boolean).join("\nAgent's message before the call: "), "--goal", sessionGoal(ctx), "--session", ctx.sessionManager.getSessionFile() ?? "", "--", command];
		const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
			execFile(GATE, args, { timeout: 60_000, maxBuffer: 1 << 20 }, (err: any, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })),
		);
		let verdict: any = null;
		try { verdict = JSON.parse(stdout.trim().split("\n").at(-1) ?? ""); } catch {}

		if (code === 0 && verdict?.allow && verdict.token) {
			event.input.command = `export CLIENT_CUA_GATE_TOKEN=${verdict.token}\n${command}`;
			return;
		}
		const reason = verdict?.reason ?? `Blocked by the client-CUA guard: the gate failed (${(stderr || stdout).trim().slice(0, 300) || `exit ${code}`}), so it fails closed. Do this on ag-mac instead, or tell the user what ag-mac is missing.`;
		ctx.ui.notify(`Client-CUA guard blocked a client desktop call. ${verdict?.access ?? ""}`, "warning");
		return { block: true, reason };
	});
}
