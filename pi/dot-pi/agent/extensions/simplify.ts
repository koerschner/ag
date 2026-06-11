import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const skillPath = path.join(os.homedir(), ".pi", "agent", "skills", "simplify", "SKILL.md");

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();

	const end = markdown.indexOf("\n---\n", 4);
	if (end === -1) return markdown.trim();

	return markdown.slice(end + "\n---\n".length).trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("simplify", {
		description: "Simplify recently modified code while preserving behavior",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /simplify again when it is idle.", "warning");
				return;
			}

			let skill: string;
			try {
				skill = stripFrontmatter(await fs.readFile(skillPath, "utf8"));
			} catch (error) {
				ctx.ui.notify(`Could not read simplify skill at ${skillPath}: ${String(error)}`, "error");
				return;
			}

			const request = args.trim()
				? `User scope/request: ${args.trim()}`
				: "Scope: simplify recently modified or touched code in the current session only.";

			pi.sendUserMessage(`Follow these simplify-skill instructions exactly:\n\n<skill name="simplify">\n${skill}\n</skill>\n\n${request}`);
		},
	});
}
