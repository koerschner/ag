/**
 * Write the session file as soon as the first prompt is sent.
 *
 * Pi defers creating `<session>.jsonl` until the first assistant message lands (so sessions nobody prompts leave no
 * file). Everything in Ag reads that file: AG Dash's card and transcript, tab naming, Nessie, links. So for the whole
 * first model call (thinking can take a minute) a new session looked empty: no prompt, 0 prompts, transcript stuck.
 *
 * On the first user message we write the entries pi holds so far (header, model, thinking level) and mark the session
 * flushed; pi then appends the user message itself (extensions see `message_end` before pi persists it) and everything
 * after, the same path it uses for resumed sessions. Unprompted sessions still leave no file.
 *
 * Uses SessionManager internals (`flushed`, `_rewriteFile`, pi 0.87); if those change it does nothing.
 */
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "user") return;
		const sm: any = ctx.sessionManager;
		if (!sm || sm.flushed !== false || typeof sm._rewriteFile !== "function" || !sm.persist) return;
		const file = sm.getSessionFile?.();
		if (!file || existsSync(file)) return;
		try {
			sm._rewriteFile();
			sm.flushed = true;
		} catch {}
	});
}
