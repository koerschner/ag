/**
 * Serial Execute Extension
 *
 * Provides a /serial-execute command that spawns isolated pi subprocesses
 * to run /skill:execute repeatedly until no open todos remain.
 *
 * Each iteration gets a fresh context window — the subprocess runs the
 * execute skill, picks one todo, does it, reconciles, then exits.
 * This extension checks the todo directory after each iteration and
 * stops when there are nothing actionable left.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const TODO_DIR_NAME = ".pi/todos";
const TODO_PATH_ENV = "PI_TODO_PATH";
const MAX_ITERATIONS = 50;

interface TodoFrontMatter {
	id: string;
	title: string;
	status: string;
	assigned_to_session?: string;
}

function getTodosDir(cwd: string): string {
	const overridePath = process.env[TODO_PATH_ENV];
	if (overridePath?.trim()) {
		return path.resolve(cwd, overridePath.trim());
	}
	return path.resolve(cwd, TODO_DIR_NAME);
}

function isTodoClosed(status: string): boolean {
	return ["closed", "done"].includes(status.toLowerCase());
}

function parseFrontMatter(content: string): Partial<TodoFrontMatter> {
	const trimmed = content.trim();
	if (!trimmed.startsWith("{")) return {};
	// Find the end of the JSON object
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i];
		if (inString) {
			if (escaped) { escaped = false; continue; }
			if (char === "\\") { escaped = true; continue; }
			if (char === '"') inString = false;
			continue;
		}
		if (char === '"') { inString = true; continue; }
		if (char === "{") depth++;
		if (char === "}") { depth--; if (depth === 0) { try { return JSON.parse(trimmed.slice(0, i + 1)); } catch { return {}; } } }
	}
	return {};
}

function getOpenTodos(cwd: string): TodoFrontMatter[] {
	const todosDir = getTodosDir(cwd);
	let entries: string[];
	try {
		entries = fs.readdirSync(todosDir);
	} catch {
		return [];
	}

	const open: TodoFrontMatter[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const id = entry.slice(0, -3);
		try {
			const content = fs.readFileSync(path.join(todosDir, entry), "utf8");
			const fm = parseFrontMatter(content);
			const status = fm.status || "open";
			if (!isTodoClosed(status)) {
				open.push({
					id,
					title: fm.title || "(untitled)",
					status,
					assigned_to_session: fm.assigned_to_session,
				});
			}
		} catch { /* skip unreadable */ }
	}
	return open;
}

/**
 * Release stale claims on open todos before each iteration.
 *
 * Because each subprocess runs with --no-session (ephemeral session ID),
 * any todo claimed by a previous iteration will have an assigned_to_session
 * that no longer exists. This function clears those assignments so the
 * next subprocess can claim and work on them.
 */
function releaseAllOpenClaims(cwd: string): number {
	const todosDir = getTodosDir(cwd);
	let entries: string[];
	try {
		entries = fs.readdirSync(todosDir);
	} catch {
		return 0;
	}

	let released = 0;
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const filePath = path.join(todosDir, entry);
		try {
			const content = fs.readFileSync(filePath, "utf8");
			const fm = parseFrontMatter(content) as Record<string, any>;
			const status = fm.status || "open";
			if (!isTodoClosed(status) && fm.assigned_to_session) {
				// Clear the assignment by rewriting the file
				fm.assigned_to_session = undefined;
				const jsonEnd = findJsonEnd(content);
				if (jsonEnd === -1) continue;
				const body = content.slice(jsonEnd + 1).replace(/^\r?\n+/, "");
				const newFm = JSON.stringify(
					{
						id: fm.id,
						title: fm.title,
						tags: fm.tags ?? [],
						status: fm.status,
						created_at: fm.created_at,
					},
					null,
					2,
				);
				const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
				const newContent = trimmedBody ? `${newFm}\n\n${trimmedBody}\n` : `${newFm}\n`;
				fs.writeFileSync(filePath, newContent, "utf8");
				released++;

				// Also remove stale lock files
				const lockPath = filePath.replace(/\.md$/, ".lock");
				try { fs.unlinkSync(lockPath); } catch { /* no lock */ }
			}
		} catch { /* skip */ }
	}
	return released;
}

function findJsonEnd(content: string): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (inString) {
			if (escaped) { escaped = false; continue; }
			if (char === "\\") { escaped = true; continue; }
			if (char === '"') inString = false;
			continue;
		}
		if (char === '"') { inString = true; continue; }
		if (char === "{") depth++;
		if (char === "}") { depth--; if (depth === 0) return i; }
	}
	return -1;
}

interface IterationResult {
	iteration: number;
	exitCode: number;
	output: string;
	stderr: string;
	stopReason?: string;
	aborted: boolean;
}

function runSubprocess(
	cwd: string,
	signal: AbortSignal,
	args?: string,
): Promise<IterationResult> {
	return new Promise((resolve) => {
		const prompt = args
			? `/skill:execute ${args}`
			: "/skill:execute";

		const procArgs = [
			"--mode", "json",
			"-p",
			"--no-session",
			prompt,
		];

		const proc = spawn("pi", procArgs, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let wasAborted = false;
		let lastStopReason: string | undefined;

		proc.stdout.on("data", (data) => {
			const chunk = data.toString();
			stdout += chunk;

			// Parse JSON events to extract stop reason and assistant text
			for (const line of chunk.split("\n")) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "message_end" && event.message?.role === "assistant") {
						if (event.message.stopReason) lastStopReason = event.message.stopReason;
					}
				} catch { /* not JSON */ }
			}
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			resolve({
				iteration: 0, // caller sets this
				exitCode: code ?? 1,
				output: extractFinalText(stdout),
				stderr,
				stopReason: lastStopReason,
				aborted: wasAborted,
			});
		});

		proc.on("error", () => {
			resolve({
				iteration: 0,
				exitCode: 1,
				output: "",
				stderr: stderr || "Failed to spawn pi subprocess",
				stopReason: "error",
				aborted: wasAborted,
			});
		});

		const killProc = () => {
			wasAborted = true;
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) proc.kill("SIGKILL");
			}, 5000);
		};

		if (signal.aborted) killProc();
		else signal.addEventListener("abort", killProc, { once: true });
	});
}

function extractFinalText(jsonOutput: string): string {
	const lines = jsonOutput.split("\n");
	let lastAssistantText = "";
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === "message_end" && event.message?.role === "assistant") {
				for (const part of event.message.content || []) {
					if (part.type === "text") lastAssistantText = part.text;
				}
			}
		} catch { /* skip */ }
	}
	return lastAssistantText;
}

export default function serialExecuteExtension(pi: ExtensionAPI): void {
	let activeAbort: AbortController | null = null;

	function updateWidget(ctx: ExtensionContext, text: string | undefined): void {
		if (!ctx.hasUI) return;
		if (!text) {
			ctx.ui.setWidget("serial-execute", undefined);
			return;
		}
		ctx.ui.setWidget("serial-execute", [ctx.ui.theme.fg("accent", text)]);
	}

	pi.registerCommand("serial-execute", {
		description: "Run /skill:execute in isolated subprocesses until all todos are done",
		handler: async (args, ctx) => {
			// Check for open todos first
			const initialTodos = getOpenTodos(ctx.cwd);
			if (initialTodos.length === 0) {
				ctx.ui.notify("No open todos found — nothing to execute.", "info");
				return;
			}

			// Confirm before starting
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"Serial Execute",
					`Found ${initialTodos.length} open todo(s). Start executing them one by one in isolated subprocesses?\n\n` +
					`Each iteration spawns a fresh pi process that runs /skill:execute.\n` +
					`Max iterations: ${MAX_ITERATIONS}. Press Escape during execution to abort.`,
				);
				if (!ok) {
					ctx.ui.notify("Serial execute cancelled.", "info");
					return;
				}
			}

			activeAbort = new AbortController();
			const signal = activeAbort.signal;
			const results: IterationResult[] = [];
			let iteration = 0;
			let previousOpenCount = -1;
			let stallCount = 0;
			const MAX_STALLS = 2;

			try {
				while (iteration < MAX_ITERATIONS) {
					// Check open todos before each iteration
					const openTodos = getOpenTodos(ctx.cwd);
					if (openTodos.length === 0) {
						updateWidget(ctx, undefined);
						ctx.ui.notify(
							`All todos done after ${iteration} iteration(s).`,
							"success",
						);
						break;
					}

					if (signal.aborted) break;

					// Release stale claims from previous subprocess iterations
					// so the next subprocess can pick up any todo
					const released = releaseAllOpenClaims(ctx.cwd);
					if (released > 0) {
						ctx.ui.notify(
							`Released ${released} stale claim(s) from previous iteration(s).`,
							"info",
						);
					}

					iteration++;
					const todoList = openTodos.map(t => t.title).slice(0, 5).join(", ");
					const remaining = openTodos.length > 5 ? ` (+${openTodos.length - 5} more)` : "";
					updateWidget(
						ctx,
						`Serial Execute: iteration ${iteration}/${MAX_ITERATIONS} • ${openTodos.length} open todos: ${todoList}${remaining}`,
					);

					ctx.ui.notify(
						`Iteration ${iteration}: ${openTodos.length} open todo(s) remaining. Spawning subprocess...`,
						"info",
					);

					const result = await runSubprocess(ctx.cwd, signal, args || undefined);
					result.iteration = iteration;
					results.push(result);

					if (result.aborted) {
						updateWidget(ctx, undefined);
						ctx.ui.notify(
							`Serial execute aborted at iteration ${iteration}.`,
							"warning",
						);
						break;
					}

					if (result.exitCode !== 0 || result.stopReason === "error") {
						updateWidget(ctx, undefined);
						const errorMsg = result.stderr || result.output || "(no output)";
						ctx.ui.notify(
							`Iteration ${iteration} failed (exit ${result.exitCode}): ${errorMsg.slice(0, 200)}`,
							"error",
						);

						if (ctx.hasUI) {
							const cont = await ctx.ui.confirm(
								"Iteration failed",
								`Iteration ${iteration} exited with code ${result.exitCode}.\n\n` +
								`Continue to next iteration?`,
							);
							if (!cont) break;
						} else {
							break;
						}
					} else {
						// Log a brief summary of what happened
						const preview = result.output.split("\n").slice(0, 3).join(" ").slice(0, 150);
						ctx.ui.notify(
							`Iteration ${iteration} complete: ${preview || "(no output)"}`,
							"info",
						);

						// Stall detection: if open count didn't decrease, we may be stuck
						const currentOpenCount = getOpenTodos(ctx.cwd).length;
						if (previousOpenCount >= 0 && currentOpenCount >= previousOpenCount) {
							stallCount++;
							if (stallCount >= MAX_STALLS) {
								ctx.ui.notify(
									`No progress after ${stallCount} consecutive iterations (${currentOpenCount} todos still open). Stopping.`,
									"warning",
								);
								break;
							}
						} else {
							stallCount = 0;
						}
						previousOpenCount = currentOpenCount;
					}
				}

				if (iteration >= MAX_ITERATIONS) {
					const openTodos = getOpenTodos(ctx.cwd);
					updateWidget(ctx, undefined);
					ctx.ui.notify(
						`Reached max iterations (${MAX_ITERATIONS}). ${openTodos.length} todo(s) still open.`,
						"warning",
					);
				}
			} finally {
				activeAbort = null;
				updateWidget(ctx, undefined);
			}

			// Final summary
			const succeeded = results.filter(r => r.exitCode === 0).length;
			const failed = results.filter(r => r.exitCode !== 0 && !r.aborted).length;
			const openRemaining = getOpenTodos(ctx.cwd).length;

			// Send summary as a message the LLM can see
			pi.sendMessage({
				customType: "serial-execute",
				content: [
					`Serial execute complete.`,
					`Iterations: ${results.length} (${succeeded} succeeded, ${failed} failed)`,
					`Open todos remaining: ${openRemaining}`,
				].join("\n"),
				display: true,
			});
		},
	});

	// Allow aborting via keyboard shortcut
	pi.registerShortcut("ctrl+shift+x", {
		description: "Abort serial execute",
		handler: async (ctx) => {
			if (activeAbort) {
				activeAbort.abort();
				ctx.ui.notify("Aborting serial execute...", "warning");
			} else {
				ctx.ui.notify("No serial execute running.", "info");
			}
		},
	});
}
