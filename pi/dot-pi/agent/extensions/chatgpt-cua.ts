import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const bin = path.join(os.homedir(), ".local", "bin", "chatgpt-cua");

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "chatgpt_cua",
		label: "ChatGPT Computer Use",
		description:
			"Delegate a computer-use task (see the screen, click, type, operate any native Mac app or browser) to ChatGPT/Codex's native computer-use agent (always gpt-6-astra). Give a complete, self-contained task; returns its final report. Slow (tens of seconds to minutes). Prefer APIs/CLIs when they exist.",
		parameters: Type.Object({
			task: Type.String({ description: "Self-contained task for the computer-use agent" }),
			keepOpen: Type.Optional(
				Type.Boolean({ description: "Leave the apps/tabs the run opened (default: close them afterwards)" }),
			),
		}),
		async execute(_id, params, signal, onUpdate) {
			return await new Promise((resolve) => {
				const child = spawn(bin, [params.task], {
					signal,
					// No stdin: a script that falls back to reading it would otherwise hang forever on Pi's open pipe.
					stdio: ["ignore", "pipe", "pipe"],
					env: params.keepOpen ? { ...process.env, CHATGPT_CUA_KEEP_OPEN: "1" } : process.env,
				});
				let stdout = "";
				let log = "";
				child.stdout.on("data", (d) => (stdout += d));
				child.stderr.on("data", (d) => {
					log += d;
					const line = String(d).trim().split("\n").pop();
					if (line) onUpdate?.({ content: [{ type: "text", text: line }], details: {} });
				});
				const done = (text: string) => resolve({ content: [{ type: "text", text }], details: {} });
				child.on("error", (e) => done(`chatgpt-cua failed to start: ${e.message}`));
				child.on("close", (code) =>
					done(code === 0 ? stdout.trim() : `chatgpt-cua exited ${code}\n${stdout}\n${log.slice(-2000)}`),
				);
			});
		},
	});
}
