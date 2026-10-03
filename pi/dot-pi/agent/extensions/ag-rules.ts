/**
 * ag-rules, the prompt hook: plain-English rules that boil down to code (~/ag/ag-rules/README.md).
 * Runs every enabled `on: prompt` rule (found by `ag-rules list`: ag's defaults, then ~/.ag/ag-rules)
 * on each prompt before the agent sees it: typed, from the ag-inbox, ag send/spawn, the ag-tickler. Headless runs
 * (routines, pi -p) only get rules with `sessions: all`. Docs: docs/reference.md → "ag-rules".
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { originTag, parseOrigins } from "./ag-origin.ts";

const ENGINE = join(process.env.AG_DIR || join(homedir(), "ag"), "ag-rules/engine.ts");

export default async function (pi: ExtensionAPI) {
	if (!existsSync(ENGINE)) return; // no ag checkout here
	const engine = await import(ENGINE);
	// Re-read on every prompt (the list is cached 10 s, code re-imported only when its file changes), so a rule
	// edited, added or moved after this session started applies here too instead of a stale startup copy.
	const loadRules = async () => {
		const rules: { name: string; run: Function; headless: boolean }[] = [];
		for (const r of engine.rulesFor("prompt")) {
			const run = await engine.loadRule(r);
			if (run) rules.push({ name: r.name, run, headless: r.sessions === "all" });
		}
		return rules;
	};

	pi.on("input", async (event, ctx) => {
		const rules = await loadRules();
		if (!rules.length) return { action: "continue" };
		const notify = (msg: string) => ctx.hasUI && ctx.ui.notify(msg, "info");
		const ag = engine.makeAg({
			notify,
			originTag,
			parseOrigins,
			spawn(prompt: string) {
				const child = spawn("ag", ["spawn", "--json", "-"], { stdio: ["pipe", "pipe", "ignore"], detached: true });
				let out = "";
				child.stdout.on("data", (d) => (out += d));
				child.on("close", (code) => {
					let link = "";
					try { link = JSON.parse(out).link ?? ""; } catch {}
					notify(code === 0 ? `ag-rules: spun out a new session ${link}` : `ag-rules: ag spawn failed (exit ${code})`);
				});
				child.on("error", (e) => notify(`ag-rules: ag spawn failed: ${e.message}`));
				child.stdin.end(prompt);
				child.unref();
			},
		});
		let text = event.text;
		for (const rule of rules) {
			if (!ctx.hasUI && !rule.headless) continue; // headless runs (routines, pi -p) are agent-driven
			try {
				const r = rule.run({ text, source: event.source }, ag);
				if (r?.handled !== undefined) {
					notify(`ag-rules ${rule.name}: ${r.handled}`);
					return { action: "handled" };
				}
				if (typeof r?.text === "string") text = r.text;
			} catch (e) {
				notify(`ag-rules ${rule.name} failed: ${e}`);
			}
		}
		return text === event.text ? { action: "continue" } : { action: "transform", text, images: event.images };
	});
}
