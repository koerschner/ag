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
 *
 * The one exception is T3's personal Pi lane (piPersonal; ag's docs/t3.md, "Personal Pi lane"): its instance sets
 * AG_PI_SUBSCRIPTION=claude-bridge and loads pi-claude-bridge, so the session bills the user's personal Claude plan
 * through Claude Code. There the guard does the reverse: it keeps the session on a claude-bridge model and refuses
 * prompts while none is selected, so those threads never fall back to TrueFoundry. A Pi started with the variable but
 * without the bridge (e.g. a subagent child) is an ordinary TrueFoundry session.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT: [string, string] = ["truefoundry", "anthropic-primary/claude-opus-5-5"];
const SUBSCRIPTION: [string, string] = ["claude-bridge", "claude-opus-5-5"];
const onTrueFoundry = (provider?: string) => !!provider && provider.startsWith("truefoundry");
// A model's own name, without vendor or group prefixes, dots as dashes: openrouter's anthropic/claude-opus-5.5 and
// TrueFoundry's anthropic-primary/claude-opus-5-5 are both claude-opus-5-5. These are unique among TrueFoundry models.
const bare = (id: string) => id.split("/").pop()!.replace(/\./g, "-");
const subscriptionLane = (ctx: any) =>
	process.env.AG_PI_SUBSCRIPTION === SUBSCRIPTION[0] && !!ctx.modelRegistry.find(...SUBSCRIPTION);

export default function (pi: ExtensionAPI) {
	const keepOnSubscription = async (ctx: any) => {
		const model = ctx.model;
		if (model?.provider === SUBSCRIPTION[0]) return;
		const target =
			(model && ctx.modelRegistry.find(SUBSCRIPTION[0], bare(model.id))) ?? ctx.modelRegistry.find(...SUBSCRIPTION);
		if (!target) return;
		await pi.setModel(target);
		if (model) ctx.ui.notify(`This lane runs on your personal Claude plan; using ${target.provider}/${target.id} instead of ${model.provider}/${model.id}.`, "warning");
	};
	const guard = async (ctx: any) => {
		if (subscriptionLane(ctx)) return keepOnSubscription(ctx);
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
	// Backstop: the personal lane never sends a prompt anywhere but the bridge.
	pi.on("input", (event: any, ctx: any) => {
		if (!subscriptionLane(ctx) || ctx.model?.provider === SUBSCRIPTION[0] || String(event.text ?? "").startsWith("/")) return;
		ctx.ui.notify("This lane only runs on your personal Claude plan, and no claude-bridge model is selected; nothing was sent.", "error");
		return { action: "handled" as const };
	});
}
