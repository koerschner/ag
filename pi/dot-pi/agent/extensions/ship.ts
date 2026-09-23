/**
 * /ship — straight-through SC-10 autopilot for the arcade repo.
 *
 * The process lives in the local skill `~/.agents/skills/ship/SKILL.md`
 * (issue → worktree → build → simplify → PR → CI/bot loop → merge to dev).
 * This extension keeps it moving without a human typing "go":
 *
 *   /ship ARC-123            ship an existing Linear issue
 *   /ship "spec…" SC-10      create the issue from a spec, then ship it
 *   /ship stop               abandon the active run (nothing is undone)
 *
 * - Sends the skill as the kickoff message.
 * - Re-prompts on every agent_end while a run is active (capped at MAX_TURNS).
 * - ship_done(pr) ends the run only once `gh` says the PR is MERGED.
 * - ship_halt(reason) ends the run when the agent is truly blocked.
 * - State persists in the session and is re-injected into the system prompt.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATE_ENTRY = "ship-state";
const SKILL_PATH = path.join(os.homedir(), ".agents", "skills", "ship", "SKILL.md");
const REPO = path.join(os.homedir(), "arcade.school");
const MAX_TURNS = 80;

type ShipState = {
	active: boolean;
	argument?: string;
	startedAt?: number;
	turns?: number;
	outcome?: string;
};

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();
	const end = markdown.indexOf("\n---\n", 4);
	return end === -1 ? markdown.trim() : markdown.slice(end + "\n---\n".length).trim();
}

function kickoffPrompt(skill: string, argument: string): string {
	return [
		`<skill name="ship" location="${SKILL_PATH}">`,
		skill,
		`</skill>`,
		``,
		`# /ship kickoff`,
		``,
		`Argument: ${argument}`,
		`Arcade checkout: ${REPO}`,
		``,
		`This kickoff is the only approval you get. Run every step without checking in. The harness re-prompts you between turns, so never ask "shall I continue". While you wait on CI or review bots, poll with \`gh\` inside a bash call (sleep up to a few minutes) instead of ending the turn.`,
		``,
		`Worktree: \`git -C ${REPO} fetch origin && herdr worktree create --cwd ${REPO} --branch <linear-branch> --base origin/dev --path ~/arcade-<short-topic> --no-focus\` (fallback: \`git worktree add\`). Never touch the main checkout's branch.`,
		``,
		`End with \`ship_done({ pr, summary })\` once merged (verified with gh), or \`ship_halt({ reason, summary })\` if truly blocked.`,
	].join("\n");
}

function continuationPrompt(state: ShipState): string {
	return [
		`/ship autopilot — continuation ${state.turns ?? 0}/${MAX_TURNS} for \`${state.argument}\`.`,
		``,
		`Continue from where you are. If you're waiting on CI or bots, poll now instead of ending the turn. Once merged, call \`ship_done\`; if truly blocked, call \`ship_halt\`. Don't narrate — act.`,
	].join("\n");
}

export default function shipExtension(pi: ExtensionAPI): void {
	let state: ShipState = { active: false };

	function widget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!state.active) {
			ctx.ui.setWidget("ship", undefined);
			return;
		}
		const label = (state.argument ?? "").slice(0, 48);
		ctx.ui.setWidget("ship", [ctx.ui.theme.fg("accent", `/ship ${label} (turn ${state.turns ?? 0})`)]);
	}

	function persist(next: ShipState, ctx: ExtensionContext): void {
		state = next;
		pi.appendEntry(STATE_ENTRY, next);
		widget(ctx);
	}

	function end(ctx: ExtensionContext, outcome: string): void {
		persist({ active: false, outcome }, ctx);
		if (ctx.hasUI) ctx.ui.notify(`/ship ended: ${outcome}`, "info");
	}

	pi.registerTool({
		name: "ship_done",
		label: "Ship done",
		description: "End the active /ship run after the PR merged. Verifies with gh that the PR is MERGED; refuses (and keeps the run active) otherwise.",
		parameters: Type.Object({
			pr: Type.Number({ description: "PR number that was merged" }),
			summary: Type.String({ description: "The final report, as shown to the user" }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (!state.active) return { content: [{ type: "text", text: "No active /ship run." }], details: {} };
			const r = await pi.exec("gh", ["pr", "view", String(params.pr), "--json", "state,url"], { cwd: REPO, timeout: 60_000 });
			if (r.code !== 0) {
				return { content: [{ type: "text", text: `Could not verify PR #${params.pr}: ${r.stderr.trim()}. Run stays active.` }], details: {} };
			}
			const view = JSON.parse(r.stdout) as { state: string; url: string };
			if (view.state !== "MERGED") {
				return { content: [{ type: "text", text: `PR #${params.pr} is ${view.state}, not MERGED. Run stays active — finish the merge or call ship_halt.` }], details: { view } };
			}
			end(ctx, `merged ${view.url}`);
			return { content: [{ type: "text", text: `Verified: ${view.url} is MERGED. /ship run ended.\n\n${params.summary}` }], details: { view } };
		},
	});

	pi.registerTool({
		name: "ship_halt",
		label: "Ship halt",
		description: "End the active /ship run because it cannot proceed: already_done (issue closed / someone else's PR) or blocked (external blocker). Push everything first.",
		parameters: Type.Object({
			reason: Type.Union([Type.Literal("already_done"), Type.Literal("blocked")]),
			summary: Type.String({ description: "What is blocked and what the human must do" }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (!state.active) return { content: [{ type: "text", text: "No active /ship run." }], details: {} };
			end(ctx, `halted: ${params.reason}`);
			return { content: [{ type: "text", text: `/ship halted (${params.reason}).\n\n${params.summary}` }], details: { reason: params.reason } };
		},
	});

	pi.registerCommand("ship", {
		description: "SC-10 autopilot: ship an arcade Linear issue or spec straight through to a merge on dev",
		handler: async (args, ctx) => {
			const argument = args.trim();
			if (!argument) {
				ctx.ui.notify('Usage: /ship <ARC-123 | Linear URL | "spec"> [SC-N]   ·   /ship stop', "warning");
				return;
			}
			if (argument === "stop") {
				if (state.active) end(ctx, "stopped by user");
				else ctx.ui.notify("No active /ship run.", "info");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /ship when it is idle.", "warning");
				return;
			}
			if (state.active && ctx.hasUI) {
				const replace = await ctx.ui.confirm("Replace active /ship run?", `A run for "${state.argument}" is active. Replace it?`);
				if (!replace) return;
			}
			let skill: string;
			try {
				skill = stripFrontmatter(await fs.readFile(SKILL_PATH, "utf8"));
			} catch {
				ctx.ui.notify(`ship skill not found at ${SKILL_PATH}`, "error");
				return;
			}
			persist({ active: true, argument, startedAt: Date.now(), turns: 0 }, ctx);
			ctx.ui.notify("/ship autopilot active", "info");
			pi.sendUserMessage(kickoffPrompt(skill, argument));
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.active || ctx.hasPendingMessages()) return;

		const last = [...event.messages].reverse().find((m: any) => m.role === "assistant") as any;
		if (ctx.hasUI && last?.stopReason === "aborted") {
			if (await ctx.ui.confirm("Stop /ship?", "The turn was aborted. End the autopilot run?")) {
				end(ctx, "aborted by user");
				return;
			}
		}

		const turns = (state.turns ?? 0) + 1;
		if (turns > MAX_TURNS) {
			end(ctx, `turn cap ${MAX_TURNS} reached`);
			pi.sendMessage({ customType: "ship", content: `/ship hit its ${MAX_TURNS}-turn cap and stopped. Report where the run stands and what remains.`, display: true }, { deliverAs: "followUp", triggerTurn: true });
			return;
		}
		persist({ ...state, turns }, ctx);
		pi.sendMessage({ customType: "ship", content: continuationPrompt(state), display: true }, { deliverAs: "followUp", triggerTurn: true });
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;
		const context = [
			`<ship_context>`,
			`A /ship autopilot run is active for: ${state.argument} (turn ${state.turns ?? 0}/${MAX_TURNS}).`,
			`Run every step without asking; poll CI/bots inside a turn instead of ending it; end with ship_done (verified merge) or ship_halt (truly blocked).`,
			`If the skill text was compacted away, re-read ${SKILL_PATH}.`,
			`</ship_context>`,
		].join("\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
	});

	pi.on("session_start", async (_e, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i] as { type: string; customType?: string; data?: ShipState };
			if (e.type === "custom" && e.customType === STATE_ENTRY && e.data) {
				state = e.data;
				break;
			}
		}
		widget(ctx);
	});
}
