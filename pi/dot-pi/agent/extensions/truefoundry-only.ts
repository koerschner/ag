/**
 * Run every Pi session on TrueFoundry: T3 threads in either lane (synced under ~/.pi or private in ~/private-chat),
 * tmux sessions and routines.
 *
 * Pi also knows the user's personal OpenRouter account and the direct provider logins (anthropic, openai-codex),
 * whose models appear in pickers next to the TrueFoundry copies. When a session selects one of those, switch to the
 * TrueFoundry copy of the same model (anthropic/claude-opus-5-5 and openrouter's anthropic/claude-opus-5.5 →
 * truefoundry/anthropic-primary/claude-opus-5-5, openai-codex/gpt-6-astra → truefoundry-openai/gpt-6-astra), or to
 * the default TrueFoundry model when there is no copy. Runs with their own Pi agent dir (e.g. headless research
 * pipelines) load their own extensions and are untouched.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT: [string, string] = ["truefoundry", "anthropic-primary/claude-opus-5-5"];
const onTrueFoundry = (provider?: string) => !!provider && provider.startsWith("truefoundry");
// A model's own name, without vendor or group prefixes, dots as dashes: openrouter's anthropic/claude-opus-5.5 and
// TrueFoundry's anthropic-primary/claude-opus-5-5 are both claude-opus-5-5. These are unique among TrueFoundry models.
const bare = (id: string) => id.split("/").pop()!.replace(/\./g, "-");

export default function (pi: ExtensionAPI) {
	const guard = async (ctx: any) => {
		const model = ctx.model;
		if (!model || onTrueFoundry(model.provider)) return;
		const available: any[] = ctx.modelRegistry.getAvailable().filter((m: any) => onTrueFoundry(m.provider));
		const target =
			available.find((m) => m.id === model.id) ??
			available.find((m) => bare(m.id) === bare(model.id)) ??
			ctx.modelRegistry.find(...DEFAULT);
		if (!target) return;
		await pi.setModel(target);
		ctx.ui.notify(`${model.provider}/${model.id} isn't on TrueFoundry; using ${target.provider}/${target.id} instead.`, "warning");
	};
	pi.on("model_select", (_event, ctx) => guard(ctx));
	pi.on("session_start", (_event, ctx) => guard(ctx));
}
