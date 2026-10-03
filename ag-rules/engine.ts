// ag-rules engine for runtimes written in TypeScript (ag-dash, ag-inbox, ag-client-cua-gate, Pi extensions): find the
// enabled rules of a hook and run them. The rules themselves are folders in AG_RULES_PATH (`ag-rules path`; ag's
// defaults in ~/ag/ag-rules, then the user's ~/.ag/ag-rules), listed by the `ag-rules` CLI so every
// runtime sees the same set. A rule's code (rule.ts) default-exports `(input, ag) => output`; `ag` (makeAg) is
// what rules may use, so they never import ag's files themselves.
//
//   const out = await runRule("answer", { request, reply });   // first enabled rule of the hook that returns something
//
// Rules are re-read when the list or a rule file changes, so long-running services pick up edits without a restart.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const AG_RULES = join(process.env.AG_DIR || join(HOME, "ag"), "bin/dot-local/bin/ag-rules"); // this checkout's CLI
// The AI gateway (TrueFoundry): $AG_AI_GATEWAY, else its line in the private ~/ag-personal/env.
const AI_GATEWAY = (process.env.AG_AI_GATEWAY || (() => { try { return readFileSync(`${HOME}/ag-personal/env`, "utf8").match(/^AG_AI_GATEWAY=(.*)$/m)?.[1].trim() ?? ""; } catch { return ""; } })()).replace(/\/$/, "");
export const JEV_URL = `${AI_GATEWAY}/proxy-api/jev-account/jev-endpoint/v1/systemone`;

export type RuleInfo = { name: string; on?: string; app?: string; enabled: boolean; path?: string; dir: string; source?: string; sessions?: string; description?: string; text: string };

let listed: { at: number; rules: RuleInfo[] } = { at: 0, rules: [] };
/** Every rule `ag-rules list --json` reports (cached for 10 s). */
export function listRules(): RuleInfo[] {
	if (Date.now() - listed.at < 10_000) return listed.rules;
	try {
		listed = { at: Date.now(), rules: JSON.parse(execFileSync(AG_RULES, ["list", "--json"], { encoding: "utf8", timeout: 5000 })) };
	} catch (e) {
		console.error(`ag-rules: list failed: ${e}`);
		listed = { at: Date.now(), rules: [] };
	}
	return listed.rules;
}

/** The enabled rules of one hook, in `ag-rules list` order. */
export const rulesFor = (hook: string) => listRules().filter((r) => r.enabled && r.on === hook && r.path);

/** Import a rule's code; re-imported when the file changes. */
export async function loadRule(r: RuleInfo): Promise<Function | null> {
	try {
		const v = statSync(r.path!).mtimeMs;
		try {
			return (await import(`${r.path}?v=${v}`)).default;
		} catch {
			return (await import(r.path!)).default; // runtimes whose loader doesn't take a query
		}
	} catch (e) {
		console.error(`ag-rules: ${r.name}: ${e}`);
		return null;
	}
}

export function tfyToken(): string {
	if (process.env.TFY_TOKEN) return process.env.TFY_TOKEN;
	const m = readFileSync(`${HOME}/.zshenv.local`, "utf8").match(/TFY_TOKEN=["']?([^"'\s]+)/);
	if (!m) throw new Error("TFY_TOKEN not found in ~/.zshenv.local");
	return m[1];
}

/** One Jev (TypeSafe System One) call: `state` plus `questions` → its `answers`. */
export async function jev(state: Record<string, unknown>, questions: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
	const res = await fetch(JEV_URL, {
		method: "POST",
		headers: { authorization: `Bearer ${tfyToken()}`, "content-type": "application/json" },
		body: JSON.stringify({ model: "jev-latest", state, questions }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return (await res.json()).answers;
}

/** What a rule gets as its second argument. Runtimes may add hook-specific helpers. */
export function makeAg(extra: Record<string, unknown> = {}) {
	return { jev, ...extra };
}

/**
 * Run the enabled rules of `hook` in order; the first that returns something other than undefined wins.
 * Undefined when the hook has no rules (the runtime then does its built-in default) or every rule passed.
 * A rule that throws is logged and skipped.
 */
export async function runRule<O = any>(hook: string, input: unknown, extra: Record<string, unknown> = {}): Promise<O | undefined> {
	for (const r of rulesFor(hook)) {
		const run = await loadRule(r);
		if (!run) continue;
		try {
			const out = await run(input, makeAg(extra));
			if (out !== undefined) return out as O;
		} catch (e) {
			console.error(`ag-rules: ${r.name} (${hook}) failed: ${e}`);
		}
	}
	return undefined;
}
