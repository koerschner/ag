// Activity log for the time review: one JSON line per prompt this session receives, metadata only (no text;
// the session file has it). Appends to ~/.local/state/activity/prompts.jsonl:
//   origin   typed | ag-inbox | tickler | file-inbox | rpc | extension. Injecting scripts log a hash of what
//            they send (injections.jsonl); a matching hash means it wasn't typed.
//   devices  which devices had Herdr attached at that moment (from presence's poll, ≤30s old)
//   client   presence state and HID idle seconds on the client, to tell Nathan's typing from agent-sent prompts
// Private sessions (pi-private, ~/private-chat) are skipped entirely. Cost: a few small file reads per prompt.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DIR = `${homedir()}/.local/state/activity`;
const PRESENCE = `${homedir()}/.local/state/presence/state.json`;
const INJECT_WINDOW_MS = 5 * 60_000;

const parse = (s: string) => {
	try {
		return JSON.parse(s);
	} catch {
		return undefined;
	}
};
const readJson = (p: string) => (existsSync(p) ? parse(readFileSync(p, "utf8")) : undefined);

// Last ~16 KB of injections.jsonl is plenty for a 5-minute window.
function injectionFor(sha: string): any {
	const p = `${DIR}/injections.jsonl`;
	if (!existsSync(p)) return undefined;
	const fd = openSync(p, "r");
	try {
		const size = fstatSync(fd).size;
		const len = Math.min(size, 16 * 1024);
		const buf = Buffer.alloc(len);
		readSync(fd, buf, 0, len, size - len);
		const lines = buf.toString("utf8").split("\n").reverse();
		for (const l of lines) {
			if (!l.includes(sha)) continue;
			const e = parse(l);
			if (e?.sha === sha && Date.now() - +new Date(e.ts) < INJECT_WINDOW_MS) return e;
		}
	} finally {
		closeSync(fd);
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		try {
			const file = ctx.sessionManager.getSessionFile();
			if (!file || file.includes("/private-chat/")) return;
			const sha = createHash("sha1").update(event.text.trim()).digest("hex").slice(0, 12);
			const inj = event.source === "interactive" ? injectionFor(sha) : undefined;
			const act = readJson(`${DIR}/state.json`);
			const pres = readJson(PRESENCE);
			const devices = [...new Set(Object.values(act?.herdr ?? {}).map((c: any) => c.device ?? c.via))];
			mkdirSync(DIR, { recursive: true });
			appendFileSync(
				`${DIR}/prompts.jsonl`,
				JSON.stringify({
					ts: new Date().toISOString(),
					session: file,
					cwd: ctx.cwd,
					herdr_start: { ws: process.env.HERDR_WORKSPACE_ID, tab: process.env.HERDR_TAB_ID, pane: process.env.HERDR_PANE_ID },
					source: event.source,
					streaming: event.streamingBehavior,
					chars: event.text.length,
					images: event.images?.length ?? 0,
					origin: inj ? inj.by : event.source === "interactive" ? "typed" : event.source,
					inject: inj ? { ...inj, ts: undefined, sha: undefined } : undefined,
					devices,
					client: pres && {
						state: pres.state,
						idle_s: pres.idle_s,
						locked: pres.locked,
						age_s: pres.last_poll ? Math.round((Date.now() - +new Date(pres.last_poll)) / 1000) : undefined,
					},
				}) + "\n",
			);
		} catch {}
		return { action: "continue" };
	});
}
