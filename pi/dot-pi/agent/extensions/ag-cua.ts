import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const bin = path.join(os.homedir(), ".local", "bin", "ag-cua");

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ag_cua",
		label: "Computer Use",
		description:
			"Ag's one computer-use tool (same as `ag cua`): see the screen, click, type, operate any native Mac app, browser, or (via iPhone Mirroring) the user's iPhone. Routes by target: \"mac\" (default) = ag-mac's desktop, queued one run at a time, so it may first wait behind another session's run; \"client\" = the client Mac the user sits at, and \"phone\" = their iPhone, both last resorts gated by Jev and needing `why`. Give a complete, self-contained task; returns the final report. Slow (tens of seconds to minutes). Prefer APIs/CLIs when they exist.",
		parameters: Type.Object({
			task: Type.String({ description: "Self-contained task for the computer-use agent" }),
			target: Type.Optional(
				Type.Union([Type.Literal("mac"), Type.Literal("client"), Type.Literal("phone")], {
					description:
						"Which desktop: mac (ag-mac, default), client (only for things that exist solely on the client Mac, e.g. a dialog showing there), phone (the user's iPhone via iPhone Mirroring on the client)",
				}),
			),
			why: Type.Optional(
				Type.String({ description: "Required for client/phone: why this can only be done there (judged by the client-CUA gate)" }),
			),
			keepOpen: Type.Optional(
				Type.Boolean({ description: "Leave the apps/tabs the run opened (default: close them afterwards)" }),
			),
			urgent: Type.Optional(
				Type.Boolean({
					description:
						"Time-critical only (the user is waiting on it right now, or it expires in minutes). Jumps the queue and pauses the currently running non-urgent job, which saves its progress and resumes after this one. Default false.",
				}),
			),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			// A job id we know up front, so the run can be found in `ag-screen-queue list` / cancelled / attached.
			const sm = ctx?.sessionManager;
			const sessionId = sm?.getSessionId?.() ?? "";
			const jobId = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-${randomBytes(3).toString("hex")}`;
			const caller = [sm?.getSessionName?.() || "pi session", sessionId && `http://ag:7376/${sessionId}`]
				.filter(Boolean)
				.join(" ");
			const env: NodeJS.ProcessEnv = { ...process.env, CUA_JOB_ID: jobId, CUA_CALLER: caller };
			if (params.keepOpen) env.CHATGPT_CUA_KEEP_OPEN = "1";
			if (params.urgent) env.CUA_URGENT = "1";
			return await new Promise((resolve) => {
				const target = params.target ?? "mac";
				const args = target === "mac" ? [] : [`--${target}`, "--why", params.why ?? ""];
				const child = spawn(bin, [...args, "--", params.task], {
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
				child.on("error", (e) => done(`ag-cua failed to start: ${e.message}`));
				child.on("close", (code) => {
					if (aborted) done(`Computer-use job ${jobId} was cancelled (tool call aborted).\n${log.slice(-500)}`);
					else if (code === 0) done(stdout.trim());
					else
						done(
							`ag-cua exited ${code}${target === "mac" ? ` (job ${jobId}; \`ag cua attach ${jobId}\` re-reads its result)` : ""}\n${stdout}\n${log.slice(-2000)}`,
						);
				});
			});
		},
	});
}
