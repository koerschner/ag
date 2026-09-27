// GTD auto-filing: a session in the Herdr "Inbox" workspace files itself into a topic workspace
// when Nathan sends his first reply (the 2nd prompt this pi process sees; the 1st is the capture).
// A fast LLM picks one of the existing workspaces from their labels and tab names, or "Inbox" to
// leave it for manual filing. Only existing workspaces are used; none are created.
// The pane moves into a new tab of the same name there. If Nathan is looking at it, focus follows;
// otherwise a Herdr toast says where it went. Decisions log to ~/.local/state/herdr-inbox-file/log.jsonl.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const INBOX = "inbox";
// Never file into these (lowercased labels): the inbox itself and unnamed "~" scratch spaces.
const NOT_TARGETS = new Set([INBOX, "~"]);
const MODELS: [string, string][] = [
	["truefoundry-chat", "gemini-group/gemini-3.5-flash-lite"],
	["truefoundry-openai", "gpt-5.4-nano"],
];
const LOG_DIR = `${homedir()}/.local/state/herdr-inbox-file`;

function herdr(args: string[]): any {
	return JSON.parse(execFileSync("herdr", args, { encoding: "utf8", timeout: 5000 })).result;
}

function log(data: Record<string, unknown>) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(`${LOG_DIR}/log.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n");
	} catch {}
}

function text(content: any): string {
	return typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
}

export default function (pi: ExtensionAPI) {
	let prompts = 0;

	pi.on("before_agent_start", (event, ctx) => {
		const paneEnv = process.env.HERDR_PANE_ID;
		if (process.env.HERDR_ENV !== "1" || !paneEnv || !event.prompt.trim()) return;
		if (++prompts !== 2) return;

		const history = [
			...ctx.sessionManager
				.getEntries()
				.filter((e: any) => e.type === "message" && e.message?.role === "user")
				.map((e: any) => text(e.message.content)),
			event.prompt,
		]
			.filter((p) => p.trim())
			.slice(-4)
			.map((p) => p.slice(0, 800));

		void (async () => {
			try {
				// The env pane ID stays valid after moves (Herdr aliases it), so resolve where we are now.
				const pane = herdr(["pane", "get", paneEnv]).pane;
				const workspaces = herdr(["workspace", "list"]).workspaces as any[];
				const here = workspaces.find((w) => w.workspace_id === pane.workspace_id);
				if (here?.label.toLowerCase() !== INBOX) return;
				const tabs = herdr(["tab", "list", "--workspace", pane.workspace_id]).tabs as any[];
				const tab = tabs.find((t) => t.tab_id === pane.tab_id);
				if (!tab || tab.pane_count > 1) return log({ tab: pane.tab_id, action: "skip", reason: "multi-pane tab" });

				const targets = workspaces
					.filter((w) => !NOT_TARGETS.has(w.label.toLowerCase()))
					.map((w) => ({
						w,
						tabs: (herdr(["tab", "list", "--workspace", w.workspace_id]).tabs as any[])
							.map((t) => t.label.replace(/\s*●+$/, ""))
							.slice(0, 12),
					}));
				const model = MODELS.map(([prov, id]) => ctx.modelRegistry.find(prov, id)).find(
					(m) => m && ctx.modelRegistry.hasConfiguredAuth(m),
				);
				if (!model || !targets.length) return;

				const res = await ctx.modelRegistry.complete(
					model,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: `File this terminal session into one of these topic workspaces. Each line is a workspace name, then the tabs already in it.\n\n${targets.map(({ w, tabs }) => `- ${w.label}: ${tabs.join(", ")}`).join("\n")}\n\nSession requests, oldest first:\n${history.map((q) => `- ${q}`).join("\n")}\n\nReply with only the exact workspace name. If none clearly fits, reply Inbox.`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none" },
				);
				const answer = text(res.content).replace(/["'`*]/g, "").trim().toLowerCase();
				const dest = targets.find(({ w }) => w.label.toLowerCase() === answer)?.w;
				const label = tab.label.replace(/\s*●+$/, "");
				if (!dest) return log({ tab: tab.tab_id, label, answer, action: "keep" });

				// Re-check: Nathan may have filed it by hand while the model was thinking.
				const now = herdr(["pane", "get", paneEnv]).pane;
				if (now.workspace_id !== pane.workspace_id) return log({ tab: tab.tab_id, label, action: "moved-by-hand" });
				const watching = here.focused && tab.focused;
				herdr(["pane", "move", paneEnv, "--new-tab", "--workspace", dest.workspace_id, "--label", label, watching ? "--focus" : "--no-focus"]);
				if (!watching) herdr(["notification", "show", `Filed “${label}”`, "--body", `Inbox → ${dest.label}`]);
				log({ tab: tab.tab_id, label, to: dest.label, followed: watching, action: "file" });
			} catch (e) {
				log({ action: "error", error: String(e) }); // best-effort
			}
		})();
	});
}
