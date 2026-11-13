/**
 * Web fence: once a session has read the open web, a hostile page could be steering it, so it loses
 * the machine's AWS role and the ways to hand work to something unfenced.
 *
 * A session becomes web-exposed the first time it fetches outside content: the Brave search/fetch
 * scripts, the browser-tools scripts, or a preview tab opened on a non-local URL. From then on, for
 * the rest of the session (it's saved in the session, so it survives resume and /reload):
 *   - every bash call runs under `ag-noaws` (no EC2 instance metadata, so no AWS login; no sudo; no
 *     Docker), including bash called from codemode;
 *   - hand-offs that would run a prompt or command outside the fence are blocked: `ag spawn/send/
 *     resume/merge/cua/dev`, ag-mux/tmux input to other panes, `ag-mac run`, `ag-client run`, ssh to
 *     other machines, `ag-t3`, systemd-run/cron jobs, and T3's delegate/launch/send/schedule tools. `ag report` stays allowed.
 * The user's own `!` commands are never fenced. `/unfence` (typed by the user; the model can't run
 * slash commands) lifts it for the session.
 *
 * Same Linux user, so this is a speed bump against prompt injection, not a sandbox.
 */
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENTRY = "web-fence";
const NOAWS = "ag-noaws";

// Outside content entering the session.
const WEB_BASH = /brave-search\/(?:search|content)\.js|browser-tools\/browser-(?:nav|content|hn-scraper)\.js/;
const PREVIEW_TOOL = /preview_(?:open|navigate)$/;
const LOCAL_URL = /^(?:https?:\/\/)?(?:localhost|127\.|0\.0\.0\.0|\[::1\]|ag(?:-[\w-]+)?(?:[.:\/]|$)|[\w-]+\.[\w-]+\.ts\.net)/i;

// Hand-offs to something outside the fence.
const HANDOFF_BASH = new RegExp([
	String.raw`(?:^|[\s;&|(\x60]|\$\()ag\s+(?:spawn|send|resume|merge|cua|dev\s+(?:open|run))\b`,
	String.raw`\bag-mux\s+(?:--\S+\s+)*(?:agent\s+(?:prompt|send-keys|start)|pane\s+(?:run|send-text|send-keys))\b`,
	String.raw`\btmux\b[^\n;|&]*\b(?:send-keys|send|new-window|split-window|respawn-pane|run-shell)\b`,
	String.raw`(?:^|[\s;&|(\x60]|\$\()(?:ag-mac|ag-client)\s+run\b`,
	String.raw`(?:^|[\s;&|(\x60]|\$\()ssh\s+(?!-T\s+git@)(?!git@)`,
	String.raw`\bag-t3\b`,
	// Jobs started by the user's systemd manager, cron or at run outside the fence.
	String.raw`\bsystemd-run\b|\bsystemctl\s+(?:--user\s+)?(?:start|restart|enable|edit|set-environment)\b|\bcrontab\b|(?:^|[\s;&|(])at\s+(?:now|-f)\b`,
].join("|"));
const HANDOFF_TOOL = /(?:delegate_task|t3_thread_send|t3_thread_send_attachments|t3_thread_launch|create_threads|schedule_task|run_scheduled_task_now|schedule_prompt)$/;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

type State = { exposed: boolean; by?: string; at?: string };

export default function (pi: ExtensionAPI) {
	let state: State = { exposed: false };

	const save = (next: State) => { state = next; pi.appendEntry(ENTRY, next); };

	pi.on("session_start", async (_e, ctx) => {
		state = { exposed: false };
		for (const e of (ctx.sessionManager.getBranch?.() ?? []) as any[]) {
			if (e?.type === "custom" && e.customType === ENTRY && e.data) state = e.data;
		}
	});

	pi.registerCommand("unfence", {
		description: "Lift the web fence for this session (AWS, sudo, Docker and hand-offs come back)",
		handler: async (_args, ctx) => {
			if (!state.exposed) return ctx.ui.notify("This session isn't fenced.", "info");
			save({ exposed: false, by: "unfenced by the user", at: new Date().toISOString() });
			ctx.ui.notify("Web fence lifted for this session.", "info");
		},
	});

	const blocked = (what: string) => ({
		block: true,
		reason:
			`Blocked by the web fence: this session has read the open web (${state.by}), so it can't ${what}. ` +
			`A web page could be steering it. Finish what you can here, then tell the user which step needs ` +
			`a fresh session (or that they can type /unfence if they trust what this session read).`,
	});

	pi.on("tool_call", async (event, ctx) => {
		const name = event.toolName;
		const input = (event.input ?? {}) as any;

		// Mark exposure first, so a command that fetches a page and then calls AWS is fenced too.
		if (!state.exposed) {
			let by: string | undefined;
			if (isToolCallEventType("bash", event) && WEB_BASH.test(event.input.command)) by = "a web search or page fetch";
			else if (PREVIEW_TOOL.test(name) && typeof input.url === "string" && !LOCAL_URL.test(input.url)) by = `a browser tab on ${input.url.slice(0, 80)}`;
			if (by) {
				save({ exposed: true, by, at: new Date().toISOString() });
				ctx.ui.notify(`Web fence on: this session read the open web (${by}). Its shell commands now run without AWS, sudo or Docker.`, "warning");
				// Tell the model too, so a failing AWS call later isn't a mystery it tries to work around.
				pi.sendMessage({
					customType: ENTRY,
					display: true,
					content:
						`[web fence] This session just read the open web (${by}). From now on its shell commands run without AWS, sudo or Docker, ` +
						`and it can't hand work to other sessions or machines. That's deliberate; don't try to work around it. If a step needs ` +
						`those, finish what you can and tell the user it needs a fresh session (or that they can type /unfence).`,
				}, { deliverAs: "steer" });
			}
		}
		if (!state.exposed) return;

		if (HANDOFF_TOOL.test(name)) return blocked(`hand work to another session or schedule one (${name})`);
		if (!isToolCallEventType("bash", event)) return;
		const command = event.input.command;
		const m = command.match(HANDOFF_BASH);
		if (m) return blocked(`run \`${m[0].trim()}\` (it would run outside the fence)`);
		event.input.command = `exec ${NOAWS} bash -c ${shq(command)}`;
	});
}
