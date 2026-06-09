import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { basename, join } from "path";

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const RUN_DURATION_CUSTOM_TYPE = "previous-prompt-footer-run-duration";
const LOC_STATS_REFRESH_MS = 2000;

const execFile = promisify(execFileCb);

type SessionPreviewState = {
	submittedPrompt: string;
	startedPrompt: string;
	observedUserPrompt: string;
	aiSummary: string;
	summaryInFlight: boolean;
	runStartedAt: number | null;
	lastRunMs: number | null;
};

type LocStatsState = {
	text: string;
	updatedAt: number;
	inFlight: boolean;
};

function sanitizeSingleLine(text: string): string {
	return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h${minutes.toString().padStart(2, "0")}m`;
	if (minutes > 0) return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
	return `${seconds}s`;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const item = part as { type?: string; text?: string };
			if (item.type === "text") return item.text ?? "";
			if (item.type === "image") return "[image]";
			return "";
		})
		.join(" ");
}

function getLatestUserPromptFromBranch(ctx: ExtensionContext): string {
	const prompts: string[] = [];

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = sanitizeSingleLine(contentToText(entry.message.content));
		if (text) prompts.push(text);
	}

	return prompts.length > 0 ? prompts[prompts.length - 1]! : "";
}

function getSessionKey(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? `ephemeral:${ctx.cwd}`;
}

function getDisplayPrompt(_ctx: ExtensionContext, state: SessionPreviewState): string {
	return state.aiSummary;
}

function getCompletedThreadRunDurationMs(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		const candidate = entry as { type?: string; customType?: string; data?: { ms?: unknown } };
		if (candidate.type !== "custom" || candidate.customType !== RUN_DURATION_CUSTOM_TYPE) continue;
		const ms = candidate.data?.ms;
		if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
			total += Math.floor(ms / 1000) * 1000;
		}
	}
	return total;
}

function parseNumstat(stdout: string): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of stdout.split("\n")) {
		const [addedText, deletedText] = line.split("\t");
		if (!addedText || !deletedText) continue;
		if (addedText !== "-") added += Number.parseInt(addedText, 10) || 0;
		if (deletedText !== "-") deleted += Number.parseInt(deletedText, 10) || 0;
	}
	return { added, deleted };
}

function formatLocStats(added: number, deleted: number): string {
	return `LOC +${formatTokens(added)}/-${formatTokens(deleted)}`;
}

function countLines(buffer: Buffer): number {
	if (buffer.length === 0) return 0;
	let lines = 0;
	for (const byte of buffer) {
		if (byte === 10) lines += 1;
	}
	return buffer[buffer.length - 1] === 10 ? lines : lines + 1;
}

async function countUntrackedAddedLines(cwd: string): Promise<number> {
	const { stdout } = await execFile("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer" });
	const files = stdout
		.toString("utf8")
		.split("\0")
		.filter(Boolean);

	let added = 0;
	await Promise.all(
		files.map(async (file) => {
			try {
				added += countLines(await fs.readFile(join(cwd, file)));
			} catch {
				// Ignore unreadable untracked files in the footer indicator.
			}
		}),
	);
	return added;
}

async function calculateLocStats(cwd: string): Promise<{ added: number; deleted: number }> {
	const [{ stdout }, untrackedAdded] = await Promise.all([
		execFile("git", ["diff", "--numstat", "HEAD", "--"], { cwd }),
		countUntrackedAddedLines(cwd),
	]);
	const tracked = parseNumstat(String(stdout));
	return { added: tracked.added + untrackedAdded, deleted: tracked.deleted };
}

export default function previousPromptFooterExtension(pi: ExtensionAPI) {
	const previewStateBySession = new Map<string, SessionPreviewState>();
	const footerRenderersBySession = new Map<string, Set<() => void>>();
	const runRenderIntervalsBySession = new Map<string, ReturnType<typeof setInterval>>();
	const locStatsByCwd = new Map<string, LocStatsState>();

	const getPreviewState = (ctx: ExtensionContext): SessionPreviewState => {
		const key = getSessionKey(ctx);
		let state = previewStateBySession.get(key);
		if (!state) {
			state = { submittedPrompt: "", startedPrompt: "", observedUserPrompt: "", aiSummary: "", summaryInFlight: false, runStartedAt: null, lastRunMs: null };
			previewStateBySession.set(key, state);
		}
		return state;
	};

	const resetPreviewState = (ctx: ExtensionContext) => {
		previewStateBySession.set(getSessionKey(ctx), {
			submittedPrompt: "",
			startedPrompt: "",
			observedUserPrompt: "",
			aiSummary: "",
			summaryInFlight: false,
			runStartedAt: null,
			lastRunMs: null,
		});
	};

	const generateAiSummary = async (ctx: ExtensionContext) => {
		const state = getPreviewState(ctx);
		if (state.summaryInFlight) return;

		const branch = ctx.sessionManager.getBranch();
		const sections: string[] = [];
		for (const entry of branch) {
			if (entry.type !== "message" || !entry.message.role) continue;
			const role = entry.message.role;
			if (role !== "user" && role !== "assistant") continue;
			const text = sanitizeSingleLine(contentToText(entry.message.content));
			if (!text) continue;
			const label = role === "user" ? "User" : "Assistant";
			sections.push(`${label}: ${text.slice(0, 500)}`);
		}

		if (sections.length === 0) return;

		const conversationSnippet = sections.slice(-10).join("\n");
		const systemPrompt =
			"You summarize coding sessions for a footer. Return a very brief lowercase activity phrase, ideally 2 to 5 words, like 'deploying the app', 'fixing auth bug', or 'reviewing prisma schema'. Do not mention the user, assistant, tools, or process details. No quotes. No punctuation unless necessary.";
		const userPrompt = `Write the shortest possible footer summary for the current coding work. Prefer a simple activity phrase, not a full sentence. Keep it under 32 characters if possible.\n\n${conversationSnippet}`;

		const candidates = [
			{
				provider: "openai",
				id: "gpt-4.1-nano",
				getOptions: async () => {
					const model = ctx.modelRegistry.find("openai", "gpt-4.1-nano");
					if (!model) return null;
					const apiKey = await ctx.modelRegistry.getApiKey(model);
					if (!apiKey) return null;
					return { model, options: { apiKey, maxTokens: 40, temperature: 0.2 } };
				},
			},
			{
				provider: "anthropic",
				id: "claude-haiku-4-5",
				getOptions: async () => {
					const model = ctx.modelRegistry.find("anthropic", "claude-haiku-4-5");
					if (!model) return null;
					const apiKey = await ctx.modelRegistry.getApiKey(model);
					if (!apiKey) return null;
					return { model, options: { apiKey, maxTokens: 40, temperature: 0.2 } };
				},
			},
			{
				provider: "openai-codex",
				id: "gpt-5.1-codex-mini",
				getOptions: async () => {
					const model = ctx.modelRegistry.find("openai-codex", "gpt-5.1-codex-mini");
					if (!model) return null;
					const apiKey = await ctx.modelRegistry.getApiKey(model);
					if (!apiKey) return null;
					return { model, options: { apiKey, maxTokens: 40 } };
				},
			},
		] as const;

		state.summaryInFlight = true;
		try {
			for (const candidate of candidates) {
				const resolved = await candidate.getOptions();
				if (!resolved) continue;

				const response = await complete(
					resolved.model,
					{
						systemPrompt,
						messages: [
							{
								role: "user" as const,
								content: [{ type: "text" as const, text: userPrompt }],
								timestamp: Date.now(),
							},
						],
					},
					resolved.options,
				);

				const summary = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join(" ")
					.trim();

				if (summary) {
					state.aiSummary = sanitizeSingleLine(summary);
					requestFooterRender(ctx);
					return;
				}
			}
		} catch {
			// fall through to blank summary
		} finally {
			state.summaryInFlight = false;
			requestFooterRender(ctx);
		}
	};

	const getRendererSet = (ctx: ExtensionContext): Set<() => void> => {
		const key = getSessionKey(ctx);
		let renderers = footerRenderersBySession.get(key);
		if (!renderers) {
			renderers = new Set();
			footerRenderersBySession.set(key, renderers);
		}
		return renderers;
	};

	const requestFooterRender = (ctx: ExtensionContext) => {
		for (const render of getRendererSet(ctx)) render();
	};

	const refreshLocStats = (ctx: ExtensionContext) => {
		const key = ctx.cwd;
		let state = locStatsByCwd.get(key);
		if (!state) {
			state = { text: "LOC +0/-0", updatedAt: 0, inFlight: false };
			locStatsByCwd.set(key, state);
		}

		const now = Date.now();
		if (state.inFlight || now - state.updatedAt < LOC_STATS_REFRESH_MS) return state.text;

		state.inFlight = true;
		calculateLocStats(ctx.cwd)
			.then(({ added, deleted }) => {
				state.text = formatLocStats(added, deleted);
			})
			.catch(() => {
				state.text = "";
			})
			.finally(() => {
				state.updatedAt = Date.now();
				state.inFlight = false;
				requestFooterRender(ctx);
			});

		return state.text;
	};

	const stopRunRenderInterval = (ctx: ExtensionContext) => {
		const key = getSessionKey(ctx);
		const interval = runRenderIntervalsBySession.get(key);
		if (!interval) return;
		clearInterval(interval);
		runRenderIntervalsBySession.delete(key);
	};

	const startRunRenderInterval = (ctx: ExtensionContext) => {
		const key = getSessionKey(ctx);
		if (runRenderIntervalsBySession.has(key)) return;
		runRenderIntervalsBySession.set(
			key,
			setInterval(() => {
				requestFooterRender(ctx);
			}, 1000),
		);
	};

	const resetSessionState = (ctx: ExtensionContext) => {
		stopRunRenderInterval(ctx);
		resetPreviewState(ctx);
		footerRenderersBySession.delete(getSessionKey(ctx));
	};

	const applyFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const sessionKey = getSessionKey(ctx);
			const requestRender = () => tui.requestRender();
			const renderers = getRendererSet(ctx);
			renderers.add(requestRender);
			const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					renderers.delete(requestRender);
					if (renderers.size === 0 && footerRenderersBySession.get(sessionKey) === renderers) {
						footerRenderersBySession.delete(sessionKey);
					}
					unsubscribeBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					const branchEntries = ctx.sessionManager.getBranch();
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;
					let totalCost = 0;

					for (const entry of branchEntries) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						totalInput += entry.message.usage.input;
						totalOutput += entry.message.usage.output;
						totalCacheRead += entry.message.usage.cacheRead;
						totalCacheWrite += entry.message.usage.cacheWrite;
						totalCost += entry.message.usage.cost.total;
					}

					const contextUsage = ctx.getContextUsage();
					const model = ctx.model;
					const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
					const contextPercentValue = contextUsage?.percent ?? 0;
					const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
					const contextDisplay =
						contextPercent === "?" ? `?/${formatTokens(contextWindow)}` : `${contextPercent}%/${formatTokens(contextWindow)}`;

					let contextText = contextDisplay;
					if (contextPercentValue > 90) contextText = theme.fg("error", contextDisplay);
					else if (contextPercentValue > 70) contextText = theme.fg("warning", contextDisplay);

					const statsParts: string[] = [];
					if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
					if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
					if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
					if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

					const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
					if (totalCost || usingSubscription) {
						statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
					}

					const currentState = getPreviewState(ctx);
					const completedThreadRunMs = getCompletedThreadRunDurationMs(ctx);
					const now = Date.now();
					const activeRunMs = currentState.runStartedAt !== null ? now - currentState.runStartedAt : null;
					const currentRunMs = activeRunMs ?? currentState.lastRunMs;
					const threadRunMs = completedThreadRunMs + (activeRunMs ?? 0);
					if (currentRunMs !== null) {
						statsParts.push(`⏱ ${formatDuration(currentRunMs)} Σ${formatDuration(threadRunMs)}`);
					} else if (threadRunMs > 0) {
						statsParts.push(`Σ${formatDuration(threadRunMs)}`);
					}

					statsParts.push(contextText);

					const locStats = refreshLocStats(ctx);
					if (locStats) statsParts.push(locStats);

					let statsLeft = statsParts.join(" ");
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						statsLeft = truncateToWidth(statsLeft, width, "...");
						statsLeftWidth = visibleWidth(statsLeft);
					}

					const modelName = model?.id || "no-model";
					let rightSide = model?.reasoning ? `${modelName} • ${pi.getThinkingLevel()}` : modelName;

					if (footerData.getAvailableProviderCount() > 1 && model) {
						const withProvider = `(${model.provider}) ${rightSide}`;
						if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) rightSide = withProvider;
					}

					const availableForRight = Math.max(0, width - statsLeftWidth - 2);
					const rightRendered = availableForRight > 0 ? truncateToWidth(rightSide, availableForRight, "") : "";
					const padding = " ".repeat(Math.max(1, width - statsLeftWidth - visibleWidth(rightRendered)));
					const statsLine = theme.fg("dim", statsLeft) + theme.fg("dim", `${padding}${rightRendered}`);

					const dirName = basename(ctx.cwd) || ctx.cwd;
					const branch = footerData.getGitBranch();
					const sessionName = ctx.sessionManager.getSessionName();
					const locationText = `${dirName}${branch ? ` (${branch})` : ""}${sessionName ? ` • ${sessionName}` : ""}`;

					const aiSummary = currentState.aiSummary || getDisplayPrompt(ctx, currentState);

					let topLine = theme.fg("dim", locationText);
					if (aiSummary) {
						const separator = "  ";
						const reserved = visibleWidth(locationText) + visibleWidth(separator);
						const availableForPreview = width - reserved;

						if (availableForPreview > 0) {
							const previewText = truncateToWidth(aiSummary, availableForPreview, "...");
							topLine = theme.fg("dim", locationText) + theme.fg("dim", separator) + previewText;
						} else {
							topLine = truncateToWidth(theme.fg("dim", locationText), width, theme.fg("dim", "..."));
						}
					}

					const lines = [truncateToWidth(topLine, width, theme.fg("dim", "...")), statsLine];
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const statusLine = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => sanitizeSingleLine(text))
							.join(" ");
						lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});

		requestFooterRender(ctx);
	};

	pi.on("session_start", (_event, ctx) => {
		resetSessionState(ctx);
		applyFooter(ctx);
		generateAiSummary(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		resetSessionState(ctx);
		applyFooter(ctx);
		generateAiSummary(ctx);
	});

	pi.on("session_fork", (_event, ctx) => {
		resetSessionState(ctx);
		applyFooter(ctx);
	});

	pi.on("input", (event, ctx) => {
		const text = sanitizeSingleLine(event.text);
		if (text) getPreviewState(ctx).submittedPrompt = text;
		applyFooter(ctx);
		requestFooterRender(ctx);
		return { action: "continue" } as const;
	});

	pi.on("before_agent_start", (event, ctx) => {
		const text = sanitizeSingleLine(event.prompt);
		const state = getPreviewState(ctx);
		state.startedPrompt = text;
		if (text) state.submittedPrompt = text;
		applyFooter(ctx);
		requestFooterRender(ctx);
	});

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "user") return;
		const text = sanitizeSingleLine(contentToText(event.message.content));
		if (!text) return;
		const state = getPreviewState(ctx);
		state.observedUserPrompt = text;
		state.startedPrompt = text;
		state.submittedPrompt = text;
		requestFooterRender(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "user") return;
		const text = sanitizeSingleLine(contentToText(event.message.content));
		if (!text) return;
		const state = getPreviewState(ctx);
		state.observedUserPrompt = text;
		state.startedPrompt = text;
		state.submittedPrompt = text;
		requestFooterRender(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		const state = getPreviewState(ctx);
		state.runStartedAt = Date.now();
		state.lastRunMs = null;
		startRunRenderInterval(ctx);
		requestFooterRender(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		stopRunRenderInterval(ctx);
		const state = getPreviewState(ctx);
		if (state.runStartedAt !== null) {
			const endedAt = Date.now();
			state.lastRunMs = Math.floor((endedAt - state.runStartedAt) / 1000) * 1000;
			(pi as unknown as { appendEntry?: (customType: string, data?: unknown) => void }).appendEntry?.(
				RUN_DURATION_CUSTOM_TYPE,
				{
					ms: state.lastRunMs,
					startedAt: new Date(state.runStartedAt).toISOString(),
					endedAt: new Date(endedAt).toISOString(),
				},
			);
			state.runStartedAt = null;
		}
		applyFooter(ctx);
		requestFooterRender(ctx);
		generateAiSummary(ctx).catch(() => {});
	});

	pi.on("model_select", (_event, ctx) => {
		applyFooter(ctx);
		requestFooterRender(ctx);
	});
}
