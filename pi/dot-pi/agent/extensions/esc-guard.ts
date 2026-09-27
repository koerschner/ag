/**
 * Esc guard: while the agent is running, a single stray Esc no longer aborts it.
 * Press Esc twice within WINDOW_MS to interrupt. When idle, or while a dialog
 * or prompt is open, Esc behaves normally.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";

const WINDOW_MS = 800;

export default function (pi: ExtensionAPI) {
	let armedAt = 0;
	let openPrompts = 0;
	let unsubscribe: (() => void) | undefined;

	pi.on("ui_prompt_start", async () => {
		openPrompts++;
	});
	pi.on("ui_prompt_end", async () => {
		openPrompts = Math.max(0, openPrompts - 1);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		unsubscribe?.();
		unsubscribe = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "escape") || isKeyRelease(data)) return undefined;
			if (ctx.isIdle() || openPrompts > 0) return undefined;
			const now = Date.now();
			if (now - armedAt <= WINDOW_MS) {
				armedAt = 0;
				return undefined; // second press: let Pi interrupt
			}
			armedAt = now;
			ctx.ui.notify("Press Esc again to interrupt", "info");
			return { consume: true };
		});
	});

	pi.on("session_shutdown", async () => {
		unsubscribe?.();
		unsubscribe = undefined;
	});
}
