import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const skillPath = path.join(os.homedir(), ".pi", "agent", "skills", "grill-me", "SKILL.md");

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();

	const end = markdown.indexOf("\n---\n", 4);
	if (end === -1) return markdown.trim();

	return markdown.slice(end + "\n---\n".length).trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("grill-me", {
		description: "Relentlessly interview you to stress-test a plan or design",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /grill-me again when it is idle.", "warning");
				return;
			}

			let skill: string;
			try {
				skill = stripFrontmatter(await fs.readFile(skillPath, "utf8"));
			} catch (error) {
				ctx.ui.notify(`Could not read grill-me skill at ${skillPath}: ${String(error)}`, "error");
				return;
			}

			const request = args.trim()
				? `Plan/design to grill me on: ${args.trim()}`
				: "Ask me what plan or design I want grilled, then proceed one question at a time.";

			pi.sendUserMessage(`Follow these grill-me skill instructions exactly:\n\n<skill name="grill-me">\n${skill}\n</skill>\n\n${request}`);
		},
	});
}
