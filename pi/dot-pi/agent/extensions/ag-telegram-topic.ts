// Posts this session's finished turns back to its Telegram conversation (docs/reference.md, "Telegram").
// A session has one only after the user replied to an Ag message on Telegram (ag-telegram listen binds the
// topic and writes ~/.local/state/ag-telegram/topics.json). Every other session pays one small file read per
// turn and nothing else: no model call, no process.
// `ag-telegram post <session>` sends the reply (whole when short, else its TL;DR plus the session link).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOPICS = `${homedir()}/.local/state/ag-telegram/topics.json`;
const POST = `${homedir()}/.local/bin/ag-telegram`;

const sidOf = (file: string) => (file.split("/").pop() ?? "").replace(/\.jsonl$/, "").split("_").pop() ?? "";

function bound(sid: string): boolean {
	try {
		return Boolean(JSON.parse(readFileSync(TOPICS, "utf8"))[sid]);
	} catch {
		return false;
	}
}

function text(content: any): string {
	return typeof content === "string"
		? content
		: (content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}

export default function (pi: ExtensionAPI) {
	let posted = "";

	pi.on("agent_settled", (_e, ctx) => {
		if (ctx.isIdle() !== true) return;
		const file = ctx.sessionManager.getSessionFile();
		const sid = file ? sidOf(file) : "";
		if (!sid || !bound(sid)) return;
		const last = ctx.sessionManager
			.getEntries()
			.filter((e: any) => e.type === "message" && e.message?.role === "assistant" && text(e.message.content).trim())
			.at(-1) as any;
		if (!last || last.id === posted) return;
		posted = last.id;
		const child = execFile(POST, ["post", sid], { timeout: 60_000 }, () => {});
		child.stdin?.end(text(last.message.content));
	});
}
