/**
 * ag-rules, the prompt hook: Nathan's plain-English rules that boil down to code (~/ag/ag-rules/README.md).
 * Runs every enabled `on: prompt` rule (~/ag/ag-rules/<name>.md + the .ts it names) on each prompt before the
 * agent sees it: typed, from the ag inbox, ag send/spawn, the tickler. Headless runs (routines, pi -p) only get
 * rules with `sessions: all`. Docs: docs/reference.md → "ag-rules"; `ag-rules list`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DIR = join(process.env.AG_DIR || join(homedir(), "ag"), "ag-rules");

function frontMatter(file: string): Record<string, string> {
	const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
	const out: Record<string, string> = {};
	for (const line of m?.[1].split("\n") ?? []) {
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) out[kv[1]] = kv[2].trim();
	}
	return out;
}

export default async function (pi: ExtensionAPI) {
	if (!existsSync(DIR)) return;
	const rules: { name: string; run: Function; headless: boolean }[] = [];
	for (const f of readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
		const meta = frontMatter(join(DIR, f));
		if (meta.enabled === "false" || meta.on !== "prompt" || !meta.code) continue;
		try {
			const mod = await import(join(DIR, meta.code));
			rules.push({ name: f.slice(0, -3), run: mod.default, headless: meta.sessions === "all" });
		} catch (e) {
			console.error(`ag-rules: ${f}: ${e}`);
		}
	}
	if (!rules.length) return;

	pi.on("input", async (event, ctx) => {
		const notify = (msg: string) => ctx.hasUI && ctx.ui.notify(msg, "info");
		const ag = {
			notify,
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
		};
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
