// Report pi crashes to ag-telemetry (http://ag:7378): an uncaught exception or unhandled rejection that kills pi, or a
// non-zero exit. Observes only: uses uncaughtExceptionMonitor (doesn't change how pi handles errors) and the exit hook
// (synchronous), and appends one JSON line to ~/.local/state/ag-telemetry/spool.jsonl, which the session host ingests
// within seconds (a Mac's collector ships it within a minute). Ctrl+C / closed-tab exits (129, 130, 143) aren't crashes.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIR = `${homedir()}/.local/state/ag-telemetry`;
const KEY = Symbol.for("ag-telemetry.pi");

export default function (pi: ExtensionAPI) {
	const g = globalThis as any;
	const state = g[KEY] ?? (g[KEY] = { file: undefined as string | undefined, err: undefined as any, hooked: false });
	pi.on("session_start", async (_e, ctx) => {
		state.file = (ctx.sessionManager as any)?.getSessionFile?.() ?? state.file;
	});
	if (state.hooked) return; // /reload re-runs extensions; hook the process once
	state.hooked = true;
	process.on("uncaughtExceptionMonitor", (err, origin) => {
		state.err = { origin, message: String((err as any)?.message ?? err), stack: String((err as any)?.stack ?? "").slice(0, 4000) };
	});
	process.on("exit", (code) => {
		if (!state.err && (code === 0 || [129, 130, 143].includes(code))) return;
		const e = {
			id: crypto.randomUUID(),
			at: new Date().toISOString(),
			machine: hostname().split(".")[0],
			source: "pi",
			kind: state.err ? "exception" : "exit",
			severity: "crash",
			message: state.err ? `pi crashed: ${state.err.message.slice(0, 300)}` : `pi exited with code ${code}`,
			detail: { code, session: state.file, pane: process.env.AG_PANE_ID, cwd: process.cwd(), version: process.env.PI_VERSION, ...(state.err ?? {}) },
		};
		try {
			mkdirSync(DIR, { recursive: true });
			appendFileSync(`${DIR}/spool.jsonl`, JSON.stringify(e) + "\n");
		} catch {}
	});
}
