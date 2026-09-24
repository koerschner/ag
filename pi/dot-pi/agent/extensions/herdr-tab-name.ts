// On the first prompt of a session, if this Herdr tab still has its default numeric label,
// ask a fast model for a ~2-word name and rename the tab. Fire-and-forget: never delays the turn.
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// First one that exists with auth wins.
const MODELS: [string, string][] = [
	["truefoundry-chat", "gemini-group/gemini-3.5-flash-lite"],
	["truefoundry-openai", "gpt-5.4-nano"],
];

function herdr(args: string[]): any {
	return JSON.parse(execFileSync("herdr", args, { encoding: "utf8", timeout: 3000 })).result;
}

export default function (pi: ExtensionAPI) {
	let done = false;

	pi.on("before_agent_start", (event, ctx) => {
		const tab = process.env.HERDR_TAB_ID;
		if (done || process.env.HERDR_ENV !== "1" || !tab) return;
		done = true;
		// Only a session's first prompt (resumed sessions already have user messages).
		const prior = ctx.sessionManager.getEntries().some((e: any) => e.type === "message" && e.message?.role === "user");
		if (prior || !event.prompt.trim()) return;

		void (async () => {
			try {
				// Default labels are just the tab number; anything else was named on purpose.
				if (!/^\d+$/.test(herdr(["tab", "get", tab]).tab.label)) return;
				const model = MODELS.map(([p, id]) => ctx.modelRegistry.find(p, id)).find(
					(m) => m && ctx.modelRegistry.hasConfiguredAuth(m),
				);
				if (!model) return;
				const res = await ctx.modelRegistry.complete(
					model,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: `Name a terminal tab for this task in 1-3 words (ideally 2), Title Case, no quotes or punctuation. Reply with only the name.\n\nTask:\n${event.prompt.slice(0, 2000)}`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none" },
				);
				const name = res.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join(" ")
					.replace(/["'`*.]/g, "")
					.trim()
					.split(/\s+/)
					.slice(0, 3)
					.join(" ");
				// Re-check: the user may have renamed it while we were thinking.
				if (name && /^\d+$/.test(herdr(["tab", "get", tab]).tab.label)) herdr(["tab", "rename", tab, name]);
			} catch {
				// Naming is best-effort.
			}
		})();
	});
}
