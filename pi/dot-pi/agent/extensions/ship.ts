/**
 * /ship — SC-10 autopilot for the arcade repo.
 *
 * The process lives in the repo: `.agents/skills/arcade-ship/SKILL.md`
 * (issue → worktree → plan with bone pre-check → build → simplify → PR →
 * CI/review-bot loop → bones check → merge to dev). This extension is only the
 * harness glue that keeps that process moving without a human typing "go":
 *
 *   /ship ARC-123            ship an existing Linear issue
 *   /ship "spec…" SC-10      create the issue from a spec, then ship it
 *   /ship stop               abandon the active run (nothing is undone)
 *
 * What it does mechanically:
 *   1. Loads the skill from the arcade checkout (cwd if it's an arcade
 *      worktree, else ~/arcade.school) and sends it as the kickoff message.
 *   2. On every agent_end while a run is active, sends a continuation prompt —
 *      the "it stops, I say go" loop, automated. Capped at MAX_TURNS.
 *   3. Registers two tools that end the run:
 *        ship_done(pr)   — verified: `gh pr view` must say MERGED and the PR
 *                          must not carry the `bones` label. The model's
 *                          claim alone can't close the loop.
 *        ship_halt(code) — H1–H4 from the skill; ends the loop, keeps the
 *                          report on screen.
 *   4. Persists state in the session (survives /resume) and re-injects a short
 *      <ship_context> into the system prompt each turn, so compaction can't
 *      lose the fact that a run is active or the no-override rule.
 *
 * The bones gate itself is `bun run bones check` in the repo; the skill runs
 * it and halts on a hit. See docs/architecture/bones.md there.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATE_ENTRY = "ship-state";
const SKILL_REL = path.join(".agents", "skills", "arcade-ship", "SKILL.md");
const DEFAULT_REPO = path.join(os.homedir(), "arcade.school");
const MAX_TURNS = 80;
const BONES_LABEL = "bones";

type ShipState = {
	active: boolean;
	argument?: string;
	repo?: string;
	startedAt?: number;
	turns?: number;
	outcome?: string;
};

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown.trim();
	const end = markdown.indexOf("\n---\n", 4);
	return end === -1 ? markdown.trim() : markdown.slice(end + "\n---\n".length).trim();
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/** The arcade checkout to read the skill from: cwd if it has the skill, else the main checkout. */
async function resolveRepo(cwd: string): Promise<string | undefined> {
	for (const candidate of [cwd, DEFAULT_REPO]) {
		if (await exists(path.join(candidate, SKILL_REL))) return candidate;
	}
	return undefined;
}

function kickoffPrompt(skill: string, argument: string, repo: string): string {
	return [
		`<skill name="arcade-ship" location="${path.join(repo, SKILL_REL)}">`,
		skill,
		`</skill>`,
		``,
		`# /ship kickoff`,
		``,
		`Argument: ${argument}`,
		`Arcade checkout: ${repo}`,
		``,
		`You are in the SC-10 autopilot lane described by the skill above. The kickoff is the only approval you will get; run every phase without checking in. Between turns the harness re-prompts you automatically, so do not stop to ask "shall I continue" — but do not idle either: when you are waiting on CI or review bots, poll with \`gh\` (sleep up to a few minutes inside one bash call) rather than ending the turn.`,
		``,
		`End the run with exactly one of:`,
		`- \`ship_done({ pr })\` after the merge landed — the tool verifies the PR is MERGED and unlabeled \`${BONES_LABEL}\`; it refuses otherwise.`,
		`- \`ship_halt({ code, summary })\` for H1–H4, after doing everything the skill's halt table says you have already done.`,
		``,
		`Worktree convention here: create the branch in a sibling worktree \`~/arcade-<short-topic>\` via \`herdr worktree create --cwd ${DEFAULT_REPO} --branch <linear-branch> --base origin/dev --path ~/arcade-<short-topic> --no-focus\` (fallback: \`git worktree add\`). Never touch the main checkout's branch.`,
	].join("\n");
}

function continuationPrompt(state: ShipState): string {
	const turn = state.turns ?? 0;
	return [
		`/ship autopilot — continuation ${turn}/${MAX_TURNS}. The run for \`${state.argument}\` is still active.`,
		``,
		`Continue the arcade-ship phases from where you are. If you are waiting on CI or bots, poll now (\`gh pr checks --watch\`, then the review-bot query) instead of ending the turn. If the loop is done, call \`ship_done({ pr })\`; if a halt condition holds, call \`ship_halt\`. Do not narrate that you are continuing — act.`,
	].join("\n");
}

async function ghJson(pi: ExtensionAPI, args: string[], cwd: string): Promise<any> {
	const r = await pi.exec("gh", args, { cwd, timeout: 60_000 });
	if (r.code !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.code}`);
	return JSON.parse(r.stdout);
}

export default function shipExtension(pi: ExtensionAPI): void {
	let state: ShipState = { active: false };

	function persist(next: ShipState, ctx: ExtensionContext): void {
		state = next;
		pi.appendEntry(STATE_ENTRY, next);
		widget(ctx);
	}

	function widget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!state.active) {
			ctx.ui.setWidget("ship", undefined);
			return;
		}
		const label = (state.argument ?? "").slice(0, 48);
		ctx.ui.setWidget("ship", [ctx.ui.theme.fg("accent", `/ship ${label} (turn ${state.turns ?? 0})`)]);
	}

	function end(ctx: ExtensionContext, outcome: string): void {
		persist({ active: false, outcome }, ctx);
		if (ctx.hasUI) ctx.ui.notify(`/ship ended: ${outcome}`, "info");
	}

	async function restore(ctx: ExtensionContext): Promise<void> {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i] as { type: string; customType?: string; data?: ShipState };
			if (e.type === "custom" && e.customType === STATE_ENTRY && e.data) {
				state = e.data;
				break;
			}
		}
		widget(ctx);
	}

	pi.registerTool({
		name: "ship_done",
		label: "Ship done",
		description:
			"End the active /ship run after the PR merged. Verifies with gh that the PR is MERGED and does not carry the `bones` label; refuses (and keeps the run active) otherwise.",
		parameters: Type.Object({
			pr: Type.Number({ description: "PR number that was merged" }),
			summary: Type.String({ description: "The final report, as shown to the user" }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (!state.active) return { content: [{ type: "text", text: "No active /ship run." }], details: {} };
			const cwd = state.repo ?? ctx.cwd;
			let view: { state: string; labels: { name: string }[]; url: string };
			try {
				view = await ghJson(pi, ["pr", "view", String(params.pr), "--json", "state,labels,url"], cwd);
			} catch (err) {
				return { content: [{ type: "text", text: `Could not verify PR #${params.pr}: ${String(err)}. Run stays active.` }], details: {} };
			}
			const labels = view.labels.map((l) => l.name);
			if (view.state !== "MERGED") {
				return { content: [{ type: "text", text: `PR #${params.pr} is ${view.state}, not MERGED. Run stays active — finish the merge or call ship_halt.` }], details: { view } };
			}
			if (labels.includes(BONES_LABEL)) {
				return { content: [{ type: "text", text: `PR #${params.pr} carries the \`${BONES_LABEL}\` label — a bone moved. This should have been an H2 halt, not a merge. Run stays active; report this to the user via ship_halt({ code: "H2" }).` }], details: { view } };
			}
			end(ctx, `merged ${view.url}`);
			return { content: [{ type: "text", text: `Verified: ${view.url} is MERGED, no \`${BONES_LABEL}\` label. /ship run ended.\n\n${params.summary}` }], details: { view } };
		},
	});

	pi.registerTool({
		name: "ship_halt",
		label: "Ship halt",
		description: "End the active /ship run at a halt (H1 bone predicted, H2 bone moved, H3 cannot converge/decide, H4 already done). Call only after doing what the skill's halt table requires.",
		parameters: Type.Object({
			code: Type.Union([Type.Literal("H1"), Type.Literal("H2"), Type.Literal("H3"), Type.Literal("H4")]),
			summary: Type.String({ description: "What is blocked and what the human must decide" }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			if (!state.active) return { content: [{ type: "text", text: "No active /ship run." }], details: {} };
			end(ctx, `halted ${params.code}`);
			return { content: [{ type: "text", text: `/ship halted (${params.code}). Waiting on the human.\n\n${params.summary}` }], details: { code: params.code } };
		},
	});

	pi.registerCommand("ship", {
		description: "SC-10 autopilot: ship a Linear issue or spec end-to-end via the arcade-ship skill (halts on bone risk)",
		handler: async (args, ctx) => {
			const argument = args.trim();
			if (!argument) {
				ctx.ui.notify('Usage: /ship <ARC-123 | Linear URL | "spec"> [SC-N]   ·   /ship stop', "warning");
				return;
			}
			if (argument === "stop") {
				if (!state.active) {
					ctx.ui.notify("No active /ship run.", "info");
					return;
				}
				end(ctx, "stopped by user");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /ship when it is idle.", "warning");
				return;
			}
			if (state.active) {
				const replace = ctx.hasUI ? await ctx.ui.confirm("Replace active /ship run?", `A run for "${state.argument}" is active. Replace it?`) : true;
				if (!replace) return;
			}
			const repo = await resolveRepo(ctx.cwd);
			if (!repo) {
				ctx.ui.notify(`arcade-ship skill not found in ${ctx.cwd} or ${DEFAULT_REPO}`, "error");
				return;
			}
			const skill = stripFrontmatter(await fs.readFile(path.join(repo, SKILL_REL), "utf8"));
			persist({ active: true, argument, repo, startedAt: Date.now(), turns: 0 }, ctx);
			ctx.ui.notify("/ship autopilot active", "info");
			pi.sendUserMessage(kickoffPrompt(skill, argument, repo));
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.active) return;
		if (ctx.hasPendingMessages()) return;

		const last = [...event.messages].reverse().find((m: any) => m.role === "assistant") as any;
		if (ctx.hasUI && last?.stopReason === "aborted") {
			const stop = await ctx.ui.confirm("Stop /ship?", "The turn was aborted. End the autopilot run?");
			if (stop) {
				end(ctx, "aborted by user");
				return;
			}
		}

		const turns = (state.turns ?? 0) + 1;
		if (turns > MAX_TURNS) {
			end(ctx, `turn cap ${MAX_TURNS} reached`);
			pi.sendMessage({ customType: "ship", content: `/ship reached its ${MAX_TURNS}-turn cap and stopped. Report where the run stands and what remains.`, display: true }, { deliverAs: "followUp", triggerTurn: true });
			return;
		}
		persist({ ...state, turns }, ctx);
		pi.sendMessage({ customType: "ship", content: continuationPrompt(state), display: true }, { deliverAs: "followUp", triggerTurn: true });
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;
		const context = [
			`<ship_context>`,
			`A /ship autopilot run is active (arcade-ship skill, SC-10 lane) for: ${state.argument}`,
			`Turn ${state.turns ?? 0}/${MAX_TURNS}. The harness re-prompts you after every turn until you call ship_done (verified merge) or ship_halt (H1–H4).`,
			`Standing rules: run every phase without asking; poll CI/bots inside a turn instead of ending it; any bone move (\`bun run bones check\`) is an H2 halt with no override; the manifest docs/architecture/bones.yml is read-only inside a run.`,
			`If the skill text has been compacted out of context, re-read it from ${path.join(state.repo ?? DEFAULT_REPO, SKILL_REL)} before continuing.`,
			`</ship_context>`,
		].join("\n");
		return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
	});

	pi.on("session_start", async (_e, ctx) => restore(ctx));
}
