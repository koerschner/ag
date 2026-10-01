// On the first prompt of a session, tell the agent where it sits in Ag's sessions (ag-mux on tmux):
// every open workspace, the one it's in, and that workspace's tabs (marking the current one).
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function mux(args: string[]): any {
	return JSON.parse(execFileSync("ag-mux", args, { encoding: "utf8", timeout: 3000 })).result;
}

function sessionContext(): string | undefined {
	if (process.env.AG_MUX !== "1") return undefined;
	try {
		const { workspace_id: ws, tab_id: tab } = mux(["pane", "current"]).pane; // resolved live, never stale
		const workspaces = mux(["workspace", "list"]).workspaces as { workspace_id: string; label: string }[];
		const tabs = mux(["tab", "list", "--workspace", ws]).tabs as { tab_id: string; label: string }[];
		const mark = (id: string, cur: string) => (id === cur ? "  ← you are here" : "");
		return [
			"Session context (snapshot at session start):",
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
			.some((e: any) => e.type === "custom_message" && e.customType === "ag-context");
		if (has) return;
		const content = sessionContext();
		if (!content) return;
		return { message: { customType: "ag-context", content, display: false } };
	});
}
