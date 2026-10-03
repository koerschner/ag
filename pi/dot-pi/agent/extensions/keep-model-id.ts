/**
 * Keep the configured model id on assistant messages.
 *
 * Gateways like TrueFoundry answer `anthropic-primary/claude-opus-5-5` requests
 * with `"model": "claude-opus-5-5"`. Pi stores that on the message and restores
 * sessions from it, so every resume warned "Could not restore model
 * truefoundry/claude-opus-5-5". Store the id we asked for; keep the gateway's
 * name in `responseModel`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("message_end", async (event, ctx) => {
		const m = event.message;
		const model = ctx.model;
		if (m.role !== "assistant" || !model || m.provider !== model.provider || m.model === model.id) return;
		if (ctx.modelRegistry.find(m.provider, m.model)) return; // a real, different model (e.g. fallback)
		return { message: { ...m, model: model.id, responseModel: m.responseModel ?? m.model } };
	});
}
