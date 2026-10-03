/**
 * ag rules: Nathan's personal UX shortcuts on top of Ag, written in plain language and backed by code.
 * Each rule is ~/ag/rules/<name>.md (front matter + the rule in words) plus the code it names (<name>.ts).
 * This extension runs every enabled `on: prompt` rule on each prompt before the agent sees it.
 * Docs: docs/reference.md → "ag rules"; `ag rule list`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DIR = join(process.env.AG_DIR ?? join(homedir(), "ag"), "rules");

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
	const rules: { name: string; run: Function }[] = [];
	for (const f of readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
		const meta = frontMatter(join(DIR, f));
		if (meta.enabled === "false" || meta.on !== "prompt" || !meta.code) continue;
		try {
			const mod = await import(join(DIR, meta.code));
			rules.push({ name: f.slice(0, -3), run: mod.default });
		} catch (e) {
			console.error(`ag-rules: ${f}: ${e}`);
		}
	}
	if (!rules.length) return;

	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" }; // headless runs (routines, pi -p) are agent-driven
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
					notify(code === 0 ? `ag rule: spun out a new session ${link}` : `ag rule: ag spawn failed (exit ${code})`);
				});
				child.on("error", (e) => notify(`ag rule: ag spawn failed: ${e.message}`));
				child.stdin.end(prompt);
				child.unref();
			},
		};
		let text = event.text;
		for (const rule of rules) {
			try {
				const r = rule.run({ text, source: event.source }, ag);
				if (r?.handled !== undefined) {
					notify(`ag rule ${rule.name}: ${r.handled}`);
					return { action: "handled" };
				}
				if (typeof r?.text === "string") text = r.text;
			} catch (e) {
				notify(`ag rule ${rule.name} failed: ${e}`);
			}
		}
		return text === event.text ? { action: "continue" } : { action: "transform", text, images: event.images };
	});
}
