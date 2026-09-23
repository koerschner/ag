// On the first prompt of a session, tell the agent where it sits in Herdr:
// every open workspace, the one it's in, and that workspace's tabs (marking the current one).
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function herdr(args: string[]): any {
	return JSON.parse(execFileSync("herdr", args, { encoding: "utf8", timeout: 3000 })).result;
}

function herdrContext(): string | undefined {
	const ws = process.env.HERDR_WORKSPACE_ID;
	const tab = process.env.HERDR_TAB_ID;
	if (process.env.HERDR_ENV !== "1" || !ws || !tab) return undefined;
	try {
		const workspaces = herdr(["workspace", "list"]).workspaces as { workspace_id: string; label: string }[];
		const tabs = herdr(["tab", "list", "--workspace", ws]).tabs as { tab_id: string; label: string }[];
		const mark = (id: string, cur: string) => (id === cur ? "  ← you are here" : "");
		return [
			"Herdr context (snapshot at session start):",
			"Open workspaces:",
			...workspaces.map((w) => `- ${w.label} (${w.workspace_id})${mark(w.workspace_id, ws)}`),
			"Tabs in this workspace:",
			...tabs.map((t) => `- ${t.label} (${t.tab_id})${mark(t.tab_id, tab)}`),
		].join("\n");
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (_event, ctx) => {
		// Once per session: skip if this session (new or resumed) already carries the snapshot.
		const has = ctx.sessionManager
			.getEntries()
			.some((e: any) => e.type === "custom_message" && e.customType === "herdr-context");
		if (has) return;
		const content = herdrContext();
		if (!content) return;
		return { message: { customType: "herdr-context", content, display: false } };
	});
}
