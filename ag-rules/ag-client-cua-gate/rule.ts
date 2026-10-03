// ag-rule ag-client-cua-gate (spec: rule.md beside this). Hook `cua`, run by ag-client-cua-gate before a client/phone run.
// input: { kind: "cua" | "ssh", command, why, goal } → { allow, justified, drives, reason }.
import type { CuaRule } from "../types.ts";

const JUSTIFIED_MIN = 0.7;
const DRIVES_MIN = 0.5;
const RULE = `The user's rule for AI agents running on their development Mac ("ag-mac"): using computer use on their client Mac (the laptop they sit at, "ag-client") is an antipattern. Agents must do work on ag-mac through an API, CLI, or MCP tool, or through computer use on ag-mac's own desktop. Driving the client's desktop is allowed only when the thing exists solely on the client: a dialog or permission prompt that is showing on the client's screen, iPhone Mirroring (the user's iPhone is only reachable through the client), a setting or app of the client Mac itself that the task is about, or the user's own screen as the deliverable (they explicitly asked to have windows opened, arranged, or set up on the display they are sitting at, e.g. to watch, present, or screen-record them). It is never justified because an app, website, or account is already signed in on the client, or because ag-mac's copy is signed out, missing, or lacks permission; the fix then is to get that access onto ag.`;

const rule: CuaRule = async ({ kind, command, why, goal }, ag) => {
	const questions: Record<string, object> = {
		justified: {
			type: "noul",
			instructions: "An AI agent on ag-mac is about to drive the client Mac's desktop with `command`. Under `rule`, and given the agent's stated `justification` and its session's `goal`, is that truly necessary: does what it needs exist only on the client?",
			criteria: {
				true: "It exists only on the client: a permission prompt or system dialog showing on the client's screen, iPhone Mirroring or other work on the user's phone, a setting or app of the client Mac itself that the task is about, or the user's own screen as the deliverable: they explicitly asked to have windows opened, arranged, or set up on the display they are sitting at (e.g. to watch, present, or screen-record a demo), so the result can only exist on the client.",
				false: "It could be done on ag-mac: e.g. sending or reading messages (Slack, Discord, email, texts), using a website, web app, or desktop app, or anything behind an account that could be signed in on ag-mac, even if it is currently only signed in on the client. (Arranging windows on the user's own screen because they asked to see or record them there is not this case.)",
			},
		},
	};
	if (kind !== "cua") {
		questions.drives = {
			type: "noul",
			instructions: "An AI agent on ag-mac is about to run the shell command `command`, which reaches the client Mac over SSH. Would it operate the client's graphical desktop on the user's behalf: clicking, typing, controlling or scripting apps' UI, reading the screen, or submitting a computer-use task?",
			criteria: {
				true: "Yes: AppleScript/osascript that controls apps or System Events, Hammerspoon event taps or app/window control, cliclick, or similar UI automation or computer use.",
				false: "No: it only shows a notification, reloads configuration (e.g. Hammerspoon hs.reload()), quits, launches, or restarts an app (`osascript -e 'quit app \"X\"'`, `open -g X.app`, `pkill`), copies, reads, or edits files (including an app's own source or logs), syncs dotfiles, or runs ordinary non-GUI shell commands.",
			},
		};
	}
	const state = { rule: RULE, command: command.slice(0, 6000), justification: why.slice(0, 2000) || "(none given)", goal: goal.slice(0, 2000) || "(unknown)" };
	let a: any;
	try {
		a = await ag.jev(state, questions, 20_000);
	} catch {
		try {
			a = await ag.jev(state, questions, 20_000);
		} catch (e) {
			return { allow: false, reason: `Jev unreachable (${e}); failing closed` };
		}
	}
	const justified: number = a.justified.noul;
	const drives: number = kind === "cua" ? 1 : a.drives.noul;
	const reason = `Jev: client-only p=${justified.toFixed(2)}${kind !== "cua" ? `, drives desktop p=${drives.toFixed(2)}` : ""}`;
	return { allow: drives < DRIVES_MIN || justified >= JUSTIFIED_MIN, justified, drives, reason };
};
export default rule;
