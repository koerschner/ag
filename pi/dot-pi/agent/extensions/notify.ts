/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
	].join("; ");
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	// Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
	process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
	const { execFile } = require("child_process");
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

function notify(title: string, body: string): void {
	if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

const piPane = process.env.TMUX_PANE;
const suspendHandlerKey = Symbol.for("nat.pi.notify.tmuxSuspendHandlerInstalled");

function tmux(args: string[]): string | undefined {
	if (!process.env.TMUX) return;

	try {
		const { execFileSync } = require("child_process");
		return execFileSync("tmux", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		// Don't let tmux integration failures break Pi.
	}
}

function tintPane(): void {
	if (!piPane) return;
	tmux(["set-option", "-p", "-t", piPane, "@rang", "1"]);
	// tmux 3.6 removed `select-pane -P`; pane-local `window-style` is the supported tint.
	// Use a subtle gray background rather than inverting the pane to a bright theme.
	tmux(["set-option", "-p", "-t", piPane, "window-style", "bg=colour240"]);
}

function clearPaneTint(): void {
	if (!piPane) return;
	tmux(["set-option", "-p", "-t", piPane, "@rang", "0"]);
	tmux(["set-option", "-p", "-t", piPane, "window-style", "default"]);
}

function installSuspendTintCleanup(): void {
	if ((globalThis as Record<symbol, boolean>)[suspendHandlerKey]) return;
	(globalThis as Record<symbol, boolean>)[suspendHandlerKey] = true;

	const onSuspend = () => {
		clearPaneTint();

		// Let the terminal's normal Ctrl+Z behavior continue after clearing the tint.
		process.removeListener("SIGTSTP", onSuspend);
		process.once("SIGCONT", () => process.on("SIGTSTP", onSuspend));
		process.kill(process.pid, "SIGTSTP");
	};

	process.on("SIGTSTP", onSuspend);
}

export default function (pi: ExtensionAPI) {
	installSuspendTintCleanup();

	pi.on("input", async () => {
		clearPaneTint();
	});

	pi.on("before_agent_start", async () => {
		clearPaneTint();
	});

	pi.on("session_shutdown", async () => {
		clearPaneTint();
	});

	pi.on("agent_end", async () => {
		notify("Pi", "Ready for input");
		tintPane();
	});
}
