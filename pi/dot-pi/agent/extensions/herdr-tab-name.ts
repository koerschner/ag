// Keeps this Herdr tab's label accurate. On every prompt (in the background, never delaying the turn):
//   1. Default numeric label ("9")        → name it with a fast LLM.
//   2. Otherwise ask Jev (via TrueFoundry) whether the label still fits the recent prompts.
//      If P(accurate) < RENAME_BELOW      → rename it with the fast LLM.
// A label you change by hand is pinned: this session never touches it again.
// Every decision is logged to ~/.local/state/herdr-tab-name/log.jsonl.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const JEV_URL = "https://tfy.promptlens.trilogy.com/proxy-api/jev-account/jev-endpoint/v1/systemone";
const RENAME_BELOW = 0.6;
const RECENT = 3; // prompts Jev and the namer see
// First one that exists with auth wins.
const NAMERS: [string, string][] = [
	["truefoundry-chat", "gemini-group/gemini-3.5-flash-lite"],
	["truefoundry-openai", "gpt-5.4-nano"],
];
const LOG_DIR = `${homedir()}/.local/state/herdr-tab-name`;

function herdr(args: string[]): any {
	return JSON.parse(execFileSync("herdr", args, { encoding: "utf8", timeout: 3000 })).result;
}

// Herdr appends " ●" to labels of tabs with unread output; that's not part of the name.
function tabLabel(tab: string): string {
	return herdr(["tab", "get", tab]).tab.label.replace(/\s*●$/, "");
}

function log(data: Record<string, unknown>) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(`${LOG_DIR}/log.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n");
	} catch {}
}

function tfyToken(): string {
	const env = process.env.TFY_TOKEN || process.env.TFY_API_KEY;
	if (env) return env;
	return readFileSync(`${homedir()}/.zshenv.local`, "utf8").match(/TFY_TOKEN=["']?([^"'\s]+)/)?.[1] ?? "";
}

function text(content: any): string {
	return typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
}

// Jev: how likely is it that `label` still names the recent work?
async function pAccurate(label: string, prompts: string[]): Promise<number> {
	const res = await fetch(JEV_URL, {
		method: "POST",
		headers: { authorization: `Bearer ${tfyToken()}`, "content-type": "application/json" },
		body: JSON.stringify({
			model: "jev-latest",
			state: { tab_label: label, recent_prompts: prompts },
			questions: {
				fit: {
					type: "choice",
					instructions: "How well does `tab_label` name the work in `recent_prompts`? Judge mainly by the most recent prompts.",
					criteria: {
						accurate: "The label names the same topic or feature the prompts are about, even if short.",
						wrong_topic: "The label names a different topic, feature, or task than the prompts.",
						misleading_word: "The topic is roughly right but a key word in the label is wrong or misleading.",
						superseded: "The label matches the early prompts, but the recent prompts moved on to a different task.",
					},
				},
			},
		}),
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) throw new Error(`jev ${res.status}`);
	return (await res.json()).answers.fit.probabilities.accurate;
}

export default function (pi: ExtensionAPI) {
	let initial: string | undefined; // label when this session first looked
	let lastSet: string | undefined; // label this session last wrote
	let pinned = false;

	pi.on("before_agent_start", (event, ctx) => {
		const tab = process.env.HERDR_TAB_ID;
		if (pinned || process.env.HERDR_ENV !== "1" || !tab || !event.prompt.trim()) return;

		const prompts = [
			...ctx.sessionManager
				.getEntries()
				.filter((e: any) => e.type === "message" && e.message?.role === "user")
				.map((e: any) => text(e.message.content)),
			event.prompt,
		]
			.filter((p) => p.trim())
			.slice(-RECENT)
			.map((p) => p.slice(0, 600));

		void (async () => {
			try {
				const label = tabLabel(tab);
				initial ??= label;
				if (label !== initial && label !== lastSet) {
					pinned = true; // renamed by hand
					log({ tab, label, action: "pinned" });
					return;
				}

				let p: number | null = null;
				if (!/^\d+$/.test(label)) {
					p = await pAccurate(label, prompts);
					if (p >= RENAME_BELOW) return log({ tab, label, p_accurate: p, action: "keep" });
				}

				const model = NAMERS.map(([prov, id]) => ctx.modelRegistry.find(prov, id)).find(
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
										text: `Name a terminal tab for this work in 1-3 words (ideally 2), Title Case, no quotes or punctuation. Name the specific system or feature, weighted toward the latest request. Reply with only the name.\n\nRequests, oldest first:\n${prompts.map((q) => `- ${q}`).join("\n")}`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none" },
				);
				const name = text(res.content).replace(/["'`*.]/g, "").trim().split(/\s+/).slice(0, 3).join(" ");
				// Re-check: the label may have changed while we were thinking.
				if (!name || name === label || tabLabel(tab) !== label) return;
				herdr(["tab", "rename", tab, name]);
				lastSet = name;
				log({ tab, label, p_accurate: p, action: "rename", name });
			} catch (e) {
				log({ tab, action: "error", error: String(e) }); // best-effort
			}
		})();
	});
}
