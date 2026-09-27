// Tickler tool: lets the agent defer work to a later time from plain text ("do this Friday at 9",
// "remind me about this in 2 weeks"), or until Nathan is next online at his client Mac ("resume this next time
// I'm on the client"; detected by `presence`, bin/dot-local/bin/presence). Wraps the `tickler` CLI (bin/dot-local/bin/tickler), which the
// com.nathan.tickler LaunchAgent fires: a new Herdr tab running pi, forked from this session.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BIN = `${homedir()}/.local/bin/tickler`;

function herdrWorkspaceLabel(): string | undefined {
	const pane = process.env.HERDR_PANE_ID;
	if (!pane) return undefined;
	try {
		// Resolve live: HERDR_WORKSPACE_ID goes stale if the pane moves (e.g. auto-filed out of Inbox).
		const ws = JSON.parse(execFileSync("herdr", ["pane", "get", pane], { encoding: "utf8", timeout: 3000 })).result.pane.workspace_id;
		const r = JSON.parse(execFileSync("herdr", ["workspace", "get", ws], { encoding: "utf8", timeout: 3000 })).result;
		return (r.workspace ?? r).label;
	} catch {
		return undefined;
	}
}

function now(): string {
	const d = new Date();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return `${d.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} (${tz}, ISO ${d.toISOString()})`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "tickler",
		label: "Tickler",
		description:
			"GTD tickler: defer a task to a specific future time, or to the next time Nathan comes online at his client Mac (when: \"online\"). At that moment a new Herdr tab opens running pi (forked from this conversation by default, so it has full context) and the task is sent to it as a prompt. Also list or cancel scheduled items.",
		promptSnippet: "Schedule a task/reminder to come back at a future time, or when Nathan is next online at his Mac, as a new pi tab",
		promptGuidelines: [
			"When Nathan asks in plain text to do, check, or remind him of something at a later time (\"on Friday\", \"tomorrow at 9\", \"in two weeks\", \"defer this\", \"send this back to me later\"), call the tickler tool with action \"schedule\" yourself; never ask him to run a command.",
			"For the tickler tool, resolve the time to an ISO 8601 timestamp with offset using the current local time the tool reports (call tickler with action \"list\" first if you don't know the current date). If he gave no time of day, use 09:00 local. If he gave no date at all, ask once.",
			"When the work should resume once Nathan is back at his Mac (\"next time I'm on the client\", \"when I'm back at my computer\", \"when I'm online\", or it needs him physically: a phone press, a click, a login), call the tickler tool with action \"schedule\" and when: \"online\" instead of `at`. It fires on his next arrival at the client after now (sustained activity, not a brief wake), once. Run `presence` in bash to see whether he's online right now.",
			"The tickler task text must be self-contained: what to do and the key facts/decisions so far, written as an instruction to the future agent.",
			"After scheduling with the tickler tool, confirm in one line with the resolved local date and time.",
		],
		parameters: Type.Object({
			action: StringEnum(["schedule", "list", "cancel"] as const),
			at: Type.Optional(Type.String({ description: "schedule: ISO 8601 time with offset, e.g. 2026-10-03T09:00:00-05:00 (omit when using `when`)" })),
			when: Type.Optional(StringEnum(["online"] as const, { description: "schedule: instead of `at`, fire the next time Nathan comes online at his client Mac" })),
			task: Type.Optional(Type.String({ description: "schedule: self-contained instruction for the future agent" })),
			title: Type.Optional(Type.String({ description: "schedule: short tab title (≤ 35 chars)" })),
			workspace: Type.Optional(Type.String({ description: "schedule: Herdr workspace label to open in (default: the current one)" })),
			mode: Type.Optional(StringEnum(["fork", "fresh"] as const, { description: "schedule: fork this conversation (default) or start a fresh pi" })),
			id: Type.Optional(Type.String({ description: "cancel: item id" })),
		}),
		async execute(_id, p, _signal, _onUpdate, ctx) {
			let args: string[];
			if (p.action === "list") args = ["list"];
			else if (p.action === "cancel") args = ["cancel", p.id ?? ""];
			else {
				if (!p.task || !!p.at === !!p.when) throw new Error("schedule needs `task` and exactly one of `at` or `when`");
				const trigger = p.when ? ["--when", p.when] : ["--at", p.at!];
				args = ["add", ...trigger, "--task", p.task, "--cwd", ctx.cwd, "--mode", p.mode ?? "fork"];
				const session = ctx.sessionManager.getSessionFile();
				const workspace = p.workspace ?? herdrWorkspaceLabel();
				if (p.title) args.push("--title", p.title);
				if (session) args.push("--session", session);
				if (workspace) args.push("--workspace", workspace);
			}
			const out = execFileSync(BIN, args, { encoding: "utf8", timeout: 10_000 }).trim();
			return { content: [{ type: "text", text: `${out}\nCurrent local time: ${now()}` }], details: {} };
		},
	});
}
