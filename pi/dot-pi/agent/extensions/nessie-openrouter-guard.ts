/**
 * Keep OpenRouter (the user's personal account) out of Nessie.
 *
 * Nessie syncs every pi session under ~/.pi, because work traces must all sync.
 * OpenRouter is paid personally and must not sync, and Nessie can't filter by
 * provider. So in a session stored under ~/.pi, selecting an `openrouter` model
 * is reverted to the previous (or default) model. Private OpenRouter pi sessions
 * run through `ag-pi-private`, which stores them in ~/private-chat/pi-sessions.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WATCHED = join(homedir(), ".pi") + "/";

export default function (pi: ExtensionAPI) {
	const guard = async (ctx: any, previous?: { provider: string; id: string }) => {
		if (ctx.model?.provider !== "openrouter") return;
		const file: string | undefined = ctx.sessionManager.getSessionFile();
		if (file && !file.startsWith(WATCHED)) return; // ag-pi-private or another unsynced dir
		const back =
			(previous && previous.provider !== "openrouter" && ctx.modelRegistry.find(previous.provider, previous.id)) ||
			ctx.modelRegistry.find("truefoundry", "anthropic-primary/claude-opus-5-5");
		if (back) await pi.setModel(back);
		ctx.ui.notify("OpenRouter is personal and this session syncs to Nessie. Use `ag-pi-private` for OpenRouter.", "warning");
	};
	pi.on("model_select", (event, ctx) => guard(ctx, event.previousModel));
	pi.on("session_start", (_event, ctx) => guard(ctx));
}
