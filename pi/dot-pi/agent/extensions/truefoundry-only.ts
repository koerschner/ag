/**
 * Keep synced Pi sessions (everything under ~/.pi: T3 threads and tmux sessions) on TrueFoundry.
 *
 * Pi also has direct provider logins (anthropic, openai-codex) whose models appear in T3's picker
 * next to the TrueFoundry copies of the same models. Picking one bills a personal subscription
 * instead of TrueFoundry, and the anthropic OAuth token can fail to refresh. When a session under
 * ~/.pi selects a non-TrueFoundry model, switch to the TrueFoundry copy of the same model
 * (anthropic/claude-opus-5-5 → truefoundry/anthropic-primary/claude-opus-5-5,
 * openai-codex/gpt-6-astra → truefoundry-openai/gpt-6-astra), or to the default TrueFoundry model
 * when there is no copy. OpenRouter is left to nessie-openrouter-guard. Sessions stored elsewhere
 * (ag-pi-private, the headless research runs with their own config) are untouched.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WATCHED = join(homedir(), ".pi") + "/";
const DEFAULT: [string, string] = ["truefoundry", "anthropic-primary/claude-opus-5-5"];
const onTrueFoundry = (provider?: string) => !!provider && provider.startsWith("truefoundry");

export default function (pi: ExtensionAPI) {
	const guard = async (ctx: any) => {
		const model = ctx.model;
		if (!model || onTrueFoundry(model.provider) || model.provider === "openrouter") return;
		const file: string | undefined = ctx.sessionManager.getSessionFile();
		if (file && !file.startsWith(WATCHED)) return;
		const available: any[] = ctx.modelRegistry.getAvailable();
		const copy =
			available.find((m) => onTrueFoundry(m.provider) && m.id === model.id) ??
			available.find((m) => onTrueFoundry(m.provider) && m.id.endsWith(`/${model.id}`));
		const target = copy ?? ctx.modelRegistry.find(...DEFAULT);
		if (!target) return;
		await pi.setModel(target);
		ctx.ui.notify(`${model.provider}/${model.id} isn't on TrueFoundry; using ${target.provider}/${target.id} instead.`, "warning");
	};
	pi.on("model_select", (_event, ctx) => guard(ctx));
	pi.on("session_start", (_event, ctx) => guard(ctx));
}
