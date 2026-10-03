// Tickler tool: lets the agent defer work to a later time from plain text ("do this Friday at 9",
// "remind me about this in 2 weeks"), or until the user is next online at their client Mac ("resume this next time
// I'm on the client"; detected by `ag-presence`, bin/dot-local/bin/ag-presence). Wraps the `ag-tickler` CLI (bin/dot-local/bin/ag-tickler), which the
// ag-tickler timer (systemd) fires: a new tab running pi, forked from this session.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BIN = `${homedir()}/.local/bin/ag-tickler`;

// Whether this session is pinned on ag-dash (e.g. the user captured it with Cmd+Enter): its deferred items come back pinned too.
function currentSessionPinned(): boolean {
	if (process.env.AG_MUX !== "1") return false;
	try {
		return JSON.parse(execFileSync(`${homedir()}/.local/bin/ag`, ["me", "--json"], { encoding: "utf8", timeout: 5000 })).pinned === true;
	} catch {
		return false;
	}
}

function now(): string {
	const d = new Date();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return `${d.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })} (${tz}, ISO ${d.toISOString()})`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ag-tickler",
		label: "ag-tickler",
		description:
			"GTD tickler: defer a task to a specific future time, to the next time the user comes online at their client Mac (when: \"online\"), or wake this session when something finishes (when: \"check\" with a shell check, or \"event\" via a webhook). At that moment a new tab opens running pi (forked from this conversation by default, so it has full context) and the task is sent to it as a prompt. Also list or cancel scheduled items.",
		promptSnippet: "Schedule a task/reminder to come back at a future time, or when the user is next online at their Mac, as a new pi tab",
		promptGuidelines: [
			"When the user asks in plain text to do, check, or remind them of something at a later time (\"on Friday\", \"tomorrow at 9\", \"in two weeks\", \"defer this\", \"send this back to me later\"), call the ag-tickler tool with action \"schedule\" yourself; never ask them to run a command.",
			"For the ag-tickler tool, resolve the time to an ISO 8601 timestamp with offset using the current local time the tool reports (call ag-tickler with action \"list\" first if you don't know the current date). If they gave no time of day, use 09:00 local. If they gave no date at all, ask once.",
			"When the work should resume once the user is back at their Mac (\"next time I'm on the client\", \"when I'm back at my computer\", \"when I'm online\", or it needs them physically: a phone press, a click, a login), call the ag-tickler tool with action \"schedule\" and when: \"online\" instead of `at`. It fires on their next arrival at the client after now (sustained activity, not a brief wake), once. Run `ag-presence` in bash to see whether they're online right now.",
			"When you're waiting on something slow that isn't about the user (a machine coming back online, CI, a deploy, a long job, someone's reply) and there's nothing else useful to do, don't hold the turn open with long sleeps: schedule a wake-up with the ag-tickler tool, when: \"check\" plus `check` (a cheap shell command that exits 0 once it's ready, e.g. `ssh -o ConnectTimeout=5 ag-client true`), or when: \"event\" and hand the printed webhook URL to whatever finishes. It runs every minute without a model, then resumes this session in place (or a forked tab if this one closed). Then end your turn saying what you're waiting for.",
			"When you're waiting on another person (asked someone for something: a reply, an access grant, a code), schedule a GTD \"waiting for\" item: action \"schedule\", `waitingFor` = their name, `at` = the first check-in (default: next business day, their afternoon), and optionally `check` for a programmatic signal that fires it early (e.g. a DNS or API status change). When it fires you get a prompt to check for their reply, do the next step if they answered, or follow up once and requeue with `attempt` + 1 on the backoff it gives. A timeline they state overrides the backoff.",
			"When the wake-up is waiting on the user themselves (you asked them to sign in, click, approve, answer, or do anything physical), pass `needsUser: true`. The session then stays in ag-dash's Needs you column instead of Waiting for; still use a `check` so it resumes the moment they're done. Never use `waitingFor` for the user.",
			"The ag-tickler task text must be self-contained: what to do and the key facts/decisions so far, written as an instruction to the future agent.",
			"After scheduling with the ag-tickler tool, confirm in one line with the resolved local date and time.",
		],
		parameters: Type.Object({
			action: StringEnum(["schedule", "list", "cancel"] as const),
			at: Type.Optional(Type.String({ description: "schedule: ISO 8601 time with offset, e.g. 2026-10-03T09:00:00-05:00 (omit when using `when`)" })),
			when: Type.Optional(
				StringEnum(["online", "check", "event"] as const, {
					description:
						"schedule, instead of `at`: online = next time the user comes online at their client Mac; check = once `check` exits 0 (polled every minute, no model); event = only when triggered via the printed webhook",
				}),
			),
			check: Type.Optional(Type.String({ description: "when=check (or with waitingFor, to fire early): shell command that exits 0 when the thing is ready (keep it fast; 20s cap)" })),
			expires: Type.Optional(Type.String({ description: "when=check|event: ISO time to give up and fire as expired (default 7 days)" })),
			task: Type.Optional(Type.String({ description: "schedule: self-contained instruction for the future agent" })),
			title: Type.Optional(Type.String({ description: "schedule: short tab title (≤ 35 chars)" })),
			mode: Type.Optional(StringEnum(["fork", "fresh"] as const, { description: "schedule: fork this conversation (default) or start a fresh pi" })),
			waitingFor: Type.Optional(Type.String({ description: "schedule with `at`: GTD waiting-for; the person we're waiting on (enables the check/follow-up/backoff prompt)" })),
			attempt: Type.Optional(Type.Number({ description: "waitingFor: which check-in this is (1 = first; increment on each requeue)" })),
			pin: Type.Optional(Type.Boolean({ description: "schedule: pin the session it comes back in on ag-dash. Automatic when this session is pinned (e.g. captured with Cmd+Enter)" })),
			needsUser: Type.Optional(Type.Boolean({ description: "schedule: true when the wake-up waits on the user themselves (a login, click, approval, answer). Keeps the card in ag-dash's Needs you instead of Waiting for" })),
			id: Type.Optional(Type.String({ description: "cancel: item id" })),
		}),
		async execute(_id, p, _signal, _onUpdate, ctx) {
			let args: string[];
			if (p.action === "list") args = ["list"];
			else if (p.action === "cancel") args = ["cancel", p.id ?? ""];
			else {
				if (!p.task || !!p.at === !!p.when) throw new Error("schedule needs `task` and exactly one of `at` or `when`");
				if (p.when === "check" && !p.check) throw new Error("when: \"check\" needs `check`");
				const trigger = p.when ? ["--when", p.when] : ["--at", p.at!];
				if (p.check) trigger.push("--check", p.check);
				if (p.waitingFor) trigger.push("--waiting-for", p.waitingFor, "--attempt", String(p.attempt ?? 1));
				if (p.expires) trigger.push("--expires", p.expires);
				if (p.needsUser || (p as { needsNathan?: boolean }).needsNathan) trigger.push("--needs-user"); // needsNathan: the old name, from sessions started before the rename
				if (p.pin ?? currentSessionPinned()) trigger.push("--pin");
				args = ["add", ...trigger, "--task", p.task, "--cwd", ctx.cwd, "--mode", p.mode ?? "fork"];
				const session = ctx.sessionManager.getSessionFile();
				if (p.title) args.push("--title", p.title);
				if (session) args.push("--session", session);
			}
			const out = execFileSync(BIN, args, { encoding: "utf8", timeout: 10_000 }).trim();
			return { content: [{ type: "text", text: `${out}\nCurrent local time: ${now()}` }], details: {} };
		},
	});
}
