import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const bin = path.join(os.homedir(), ".local", "bin", "chatgpt-cua");

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "chatgpt_cua",
		label: "ChatGPT Computer Use",
		description:
			"Delegate a computer-use task (see the screen, click, type, operate any native Mac app or browser) to ChatGPT/Codex's native computer-use agent (always gpt-6-astra). Give a complete, self-contained task; returns its final report. Slow (tens of seconds to minutes). Runs are queued one at a time on ag-mac's desktop, so it may first wait behind another session's run. Prefer APIs/CLIs when they exist.",
		parameters: Type.Object({
			task: Type.String({ description: "Self-contained task for the computer-use agent" }),
			keepOpen: Type.Optional(
				Type.Boolean({ description: "Leave the apps/tabs the run opened (default: close them afterwards)" }),
			),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			// A job id we know up front, so the run can be found in `cua-queue list` / cancelled / attached.
			const sm = ctx?.sessionManager;
			const sessionId = sm?.getSessionId?.() ?? "";
			const jobId = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${randomBytes(3).toString("hex")}`;
			const caller = [sm?.getSessionName?.() || "pi session", sessionId && `http://ag:7376/${sessionId}`]
				.filter(Boolean)
				.join(" ");
			const env: NodeJS.ProcessEnv = { ...process.env, CUA_JOB_ID: jobId, CUA_CALLER: caller };
			if (params.keepOpen) env.CHATGPT_CUA_KEEP_OPEN = "1";
			return await new Promise((resolve) => {
				const child = spawn(bin, [params.task], {
					// No stdin: a script that falls back to reading it would otherwise hang forever on Pi's open pipe.
					stdio: ["ignore", "pipe", "pipe"],
					env,
				});
				let stdout = "";
				let log = "";
				let aborted = false;
				// On abort, SIGTERM the wrapper: it cancels the queued/running job on ag-mac (never orphans it)
				// and exits once the cancel is confirmed.
				const onAbort = () => {
					aborted = true;
					child.kill("SIGTERM");
				};
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
				child.stdout.on("data", (d) => (stdout += d));
				child.stderr.on("data", (d) => {
					log += d;
					const line = String(d).trim().split("\n").pop();
					if (line) onUpdate?.({ content: [{ type: "text", text: line }], details: {} });
				});
				const done = (text: string) => {
					signal?.removeEventListener("abort", onAbort);
					resolve({ content: [{ type: "text", text }], details: { jobId } });
				};
				child.on("error", (e) => done(`chatgpt-cua failed to start: ${e.message}`));
				child.on("close", (code) => {
					if (aborted) done(`Computer-use job ${jobId} was cancelled (tool call aborted).\n${log.slice(-500)}`);
					else if (code === 0) done(stdout.trim());
					else
						done(
							`chatgpt-cua exited ${code} (job ${jobId}; \`cua-queue attach ${jobId}\` re-reads its result)\n${stdout}\n${log.slice(-2000)}`,
						);
				});
			});
		},
	});
}
