import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function getLastAssistantMarkdown(branch: Array<any>): string | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;

		const message = entry.message;
		if (!("role" in message) || message.role !== "assistant") continue;

		const text = message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");

		if (text.trim()) return text;
	}

	return undefined;
}

function openInExternalEditor(initialText: string): { text: string; opened: boolean; exitStatus: number | null } {
	const editorCmd = process.env.VISUAL || process.env.EDITOR;
	if (!editorCmd) {
		return { text: initialText, opened: false, exitStatus: null };
	}

	const tmpFile = path.join(os.tmpdir(), `pi-edit-${Date.now()}.md`);
	try {
		fs.writeFileSync(tmpFile, initialText, "utf8");

		const result = spawnSync(`${editorCmd} "${tmpFile.replace(/"/g, '\\"')}"`, [], {
			stdio: "inherit",
			shell: true,
		});

		if (result.status === 0) {
			return {
				text: fs.readFileSync(tmpFile, "utf8").replace(/\n$/, ""),
				opened: true,
				exitStatus: 0,
			};
		}

		return { text: initialText, opened: true, exitStatus: result.status };
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors.
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("edit", {
		description: "Load the last assistant markdown into the prompt editor and open it in $EDITOR",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/edit requires interactive mode", "error");
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish before using /edit", "warning");
				return;
			}

			const text = getLastAssistantMarkdown(ctx.sessionManager.getBranch());
			if (!text) {
				ctx.ui.notify("No assistant markdown found in this session", "warning");
				return;
			}

			ctx.ui.setEditorText(text);

			const result = openInExternalEditor(text);
			ctx.ui.setEditorText(result.text);

			if (!result.opened) {
				ctx.ui.notify("Loaded last assistant markdown into the prompt editor. Set $VISUAL or $EDITOR, or press Ctrl+G.", "info");
				return;
			}

			if (result.exitStatus !== 0) {
				ctx.ui.notify("Editor closed with a non-zero exit status. Original text is still loaded in the prompt editor.", "warning");
				return;
			}

			ctx.ui.notify("Edited markdown loaded into the prompt editor. Submit when ready.", "info");
		},
	});
}
