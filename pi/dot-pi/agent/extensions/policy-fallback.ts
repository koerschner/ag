/**
 * Swap models when a provider blocks a request under its usage policy.
 *
 * When a turn ends with a provider refusal ("blocked under Anthropic's Usage
 * Policy", "The model refused to complete the request", OpenAI/Gemini/Azure
 * safety or content-filter blocks), drop the failed attempt from context, switch
 * to the strongest model on LADDER not yet tried in this run, and resend the same
 * request. Once a fallback chain has started, any terminal error on a fallback
 * model (e.g. it is unavailable) also moves down the ladder. The session stays on
 * the model that answered; switch back with /model.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Strongest first: provider/model ids from ~/.pi/agent/models.json.
const LADDER: [string, string][] = [
	["truefoundry", "claude-fable-5-1"],
	["truefoundry", "anthropic-primary/claude-opus-5-5"],
	["truefoundry-openai", "gpt-6-astra"],
	["truefoundry-chat", "xai-group/grok-4.5"],
	["truefoundry-chat", "fireworks-group/deepseek-v4-pro-0813"],
	["truefoundry-chat", "fireworks-group/kimi-k3"],
	["truefoundry-chat", "fireworks-group/glm-5p3"],
	["truefoundry-chat", "fireworks-group/qwen3p8-max"],
];

const POLICY =
	/usage polic|acceptable use|terms of service|refused to complete|blocked (under|due to|as it)|violat\w* (our |the )?(content|usage|safety)|policy violation|content[ _-]?(filter|policy|management)|safety (system|filter|reasons)|finish_?reason.{0,4}safety|\bSAFETY\b|responsible ?ai|flagged as/i;

export default function (pi: ExtensionAPI) {
	const tried = new Set<string>(); // models that failed in the current run

	pi.on("agent_settled", () => tried.clear());

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "error") return;
		const entry = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((e: any) => e.type === "message" && e.message.role === "assistant") as any;
		const msg = entry?.message;
		if (!msg || msg.stopReason !== "error") return;
		const text = String(msg.errorMessage ?? "");
		const inChain = tried.size > 0;
		if (!POLICY.test(text) && !inChain) return;

		if (ctx.model) tried.add(`${ctx.model.provider}/${ctx.model.id}`);
		tried.add(`${msg.provider}/${msg.model}`);
		const next = LADDER.map(([p, id]) => ctx.modelRegistry.find(p, id)).find(
			(m) => m && !tried.has(`${m.provider}/${m.id}`),
		);
		if (!next) {
			ctx.ui.notify("Usage-policy fallback: every model on the ladder failed.", "error");
			return;
		}
		if (!(await pi.setModel(next))) return;
		tried.add(`${next.provider}/${next.id}`);
		ctx.ui.notify(`${msg.model} blocked the request (${text.slice(0, 80)}…). Retrying on ${next.id}.`, "warning");
		return {
			entries: [...event.entries, { type: "context_edit", targetId: entry.id, replacement: null }],
			continue: true,
		};
	});
}
