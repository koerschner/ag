// distress_call: lets any agent text the user mid-task when it's stuck, via `ag-distress` (ag-text → Telegram,
// so the user's reply routes back to this session as a new prompt). Unlike ag-notify (end of turn, only when
// the user is away), it sends right away, from every session type (TUI, T3, subagents, scheduled runs).
// ag-distress rate-limits to one text per session per 10 minutes.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const bin = path.join(os.homedir(), ".local", "bin", "ag-distress");

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "distress_call",
		label: "Distress call",
		description:
			"Text the user's phone right now that you are stuck. Use only when truly stuck: the same step has failed 3 times with different approaches, you're caught in a loop, or you're blocked on something only the user can give (a login, a secret, a decision, access). Never for routine questions, progress updates, or things you can work out yourself. Their reply arrives later as a new prompt in this session. Max one per session per 10 minutes.",
		parameters: Type.Object({
			reason: Type.String({ description: "What's wrong, in one plain sentence the user can read on a phone" }),
			need: Type.String({ description: "What exactly you need from the user to continue" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const sessionFile = ctx?.sessionManager?.getSessionFile?.() ?? process.env.PI_SESSION_FILE ?? "";
			return await new Promise((resolve) => {
				execFile(
					bin,
					[params.reason, params.need],
					{ timeout: 90_000, env: { ...process.env, ...(sessionFile ? { AG_TEXT_SESSION: sessionFile } : {}) } },
					(err, stdout, stderr) => {
						const out = (String(stdout) + String(stderr)).trim() || String(err ?? "");
						resolve({ content: [{ type: "text", text: out }], details: { sent: !err }, isError: !!err });
					},
				);
			});
		},
	});
}
