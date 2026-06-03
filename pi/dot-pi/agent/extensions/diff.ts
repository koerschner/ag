import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);

const DIFF_COMMAND_NAME = "diff";
const DIFF_PR_COMMAND_NAME = "diff-pr";
const REVIEW_IN_HUNK_COMMAND_NAME = "review-in-hunk";
const STATUS_KEY = "hunk-diff";
const SESSION_REGISTER_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

type LaunchMode = "window" | "pane" | "session";

interface ParsedArgs {
	mode: LaunchMode;
	hunkArgs: string[];
	showHelp: boolean;
}

interface TmuxLaunch {
	mode: LaunchMode;
	paneId?: string;
	sessionName?: string;
	attachCommand?: string;
}

interface HunkSessionLocation {
	source?: string;
	paneId?: string;
	tty?: string;
}

interface HunkSession {
	sessionId: string;
	cwd?: string;
	repoRoot?: string;
	terminal?: {
		program?: string;
		locations?: HunkSessionLocation[];
	};
}

interface ReviewNote {
	noteId: string;
	source?: string;
	filePath: string;
	hunkIndex?: number;
	oldRange?: [number, number];
	newRange?: [number, number];
	body: string;
	author?: string;
	createdAt?: string;
	updatedAt?: string;
	editable?: boolean;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(input: string): string {
	try {
		return fs.realpathSync(input);
	} catch {
		return path.resolve(input);
	}
}

function directoryExists(input: string): boolean {
	try {
		return fs.statSync(input).isDirectory();
	} catch {
		return false;
	}
}

async function run(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string> {
	const result = await execFileAsync(command, args, {
		cwd: options.cwd,
		timeout: options.timeout ?? 5_000,
		maxBuffer: 10 * 1024 * 1024,
	});
	return String(result.stdout ?? "").trim();
}

function commandExists(command: string): boolean {
	const candidates = command.includes(path.sep)
		? [command]
		: (process.env.PATH ?? "")
				.split(path.delimiter)
				.filter(Boolean)
				.map((directory) => path.join(directory, command));

	return candidates.some((candidate) => {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildHunkShellCommand(hunkCommand: string, args: string[]): string {
	const pathPrefix = process.env.PATH ? `export PATH=${shellQuote(process.env.PATH)}; ` : "";
	return `${pathPrefix}exec ${[hunkCommand, ...args].map(shellQuote).join(" ")}`;
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) current += "\\";
	if (quote) throw new Error(`Unterminated ${quote} quote in /diff arguments.`);
	if (current) tokens.push(current);
	return tokens;
}

function parseArgs(rawArgs: string): ParsedArgs {
	const tokens = tokenizeArgs(rawArgs.trim());
	let mode: LaunchMode = process.env.TMUX ? "window" : "session";
	let showHelp = false;
	const hunkArgs: string[] = [];
	let passThrough = false;

	for (const token of tokens) {
		if (passThrough) {
			hunkArgs.push(token);
			continue;
		}

		if (token === "--") {
			passThrough = true;
			hunkArgs.push(token);
			continue;
		}

		switch (token) {
			case "--help":
			case "-h":
				showHelp = true;
				break;
			case "--window":
			case "--fullscreen":
				mode = process.env.TMUX ? "window" : "session";
				break;
			case "--pane":
			case "--split":
				mode = process.env.TMUX ? "pane" : "session";
				break;
			case "--session":
				mode = "session";
				break;
			default:
				hunkArgs.push(token);
		}
	}

	return { mode, hunkArgs: ["diff", ...hunkArgs], showHelp };
}

type DiffCommandName = typeof DIFF_COMMAND_NAME | typeof DIFF_PR_COMMAND_NAME;

function usage(commandName: DiffCommandName): string {
	const isPullRequestDiff = commandName !== DIFF_COMMAND_NAME;
	return [
		`Usage: /${commandName} [--window|--pane|--session] [hunk diff args...]`,
		"",
		isPullRequestDiff
			? "Opens `hunk diff <base>...HEAD` for the current branch/PR, watches for saved human notes,"
			: "Opens `hunk diff` for the current worktree, watches for saved human notes,",
		"and sends those notes back to Pi after Hunk quits.",
		"",
		"Inside tmux, the default is --window (fullscreen tmux window). Outside tmux,",
		"it opens a separate named tmux session and prints the attach command.",
		"",
		"Examples:",
		isPullRequestDiff ? `  /${commandName}` : "  /diff",
		isPullRequestDiff ? `  /${commandName} --pane -- src/ui` : "  /diff --pane --staged",
		isPullRequestDiff ? `  /${commandName} -- -- README.md` : "  /diff main...feature -- src/ui",
		"",
		"In Hunk: press `c` to create a note, `Ctrl-S` to save it, then `q` to quit.",
	].join("\n");
}

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
	try {
		await run("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

async function getGitHubPrBaseRef(cwd: string): Promise<string | undefined> {
	if (!commandExists("gh")) return undefined;
	try {
		const baseRefName = await run("gh", ["pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"], {
			cwd,
			timeout: 10_000,
		});
		return baseRefName || undefined;
	} catch {
		return undefined;
	}
}

async function getDefaultRemoteBaseRef(cwd: string): Promise<string | undefined> {
	try {
		const originHead = await run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
			cwd,
			timeout: 5_000,
		});
		if (originHead) return originHead;
	} catch {
		// Fall through to common branch names.
	}

	for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
		if (await gitRefExists(cwd, candidate)) return candidate;
	}

	return undefined;
}

async function resolvePullRequestDiffRange(cwd: string): Promise<{ range: string; baseDescription: string }> {
	try {
		await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 5_000 });
	} catch {
		throw new Error("/diff-pr must be run inside a git worktree.");
	}

	const prBaseRefName = await getGitHubPrBaseRef(cwd);
	if (prBaseRefName) {
		const remoteRef = `origin/${prBaseRefName}`;
		if (await gitRefExists(cwd, remoteRef)) {
			return { range: `${remoteRef}...HEAD`, baseDescription: `GitHub PR base ${remoteRef}` };
		}
		if (await gitRefExists(cwd, prBaseRefName)) {
			return { range: `${prBaseRefName}...HEAD`, baseDescription: `GitHub PR base ${prBaseRefName}` };
		}
		return { range: `${remoteRef}...HEAD`, baseDescription: `GitHub PR base ${remoteRef}` };
	}

	const defaultBase = await getDefaultRemoteBaseRef(cwd);
	if (!defaultBase) {
		throw new Error("Could not determine a PR base branch. Install/auth `gh` or configure origin/HEAD.");
	}
	return { range: `${defaultBase}...HEAD`, baseDescription: `default base ${defaultBase}` };
}

function sanitizeSessionNamePart(input: string): string {
	return input.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "repo";
}

function resolveExecutablePath(command: string): string | undefined {
	if (command.includes(path.sep)) return commandExists(command) ? command : undefined;
	return (process.env.PATH ?? "")
		.split(path.delimiter)
		.filter(Boolean)
		.map((directory) => path.join(directory, command))
		.find((candidate) => {
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return true;
			} catch {
				return false;
			}
		});
}

function createTmuxPane(args: string[]): string | undefined {
	const output = execFileSync("tmux", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return output.trim() || undefined;
}

function launchHunk(cwd: string, mode: LaunchMode, hunkArgs: string[]): TmuxLaunch {
	const hunkCommand = resolveExecutablePath("hunk") ?? "hunk";
	const shellCommand = buildHunkShellCommand(hunkCommand, hunkArgs);
	const printPaneArgs = ["-P", "-F", "#{pane_id}"];
	const tmuxEnvironmentArgs = process.env.PATH ? ["-e", `PATH=${process.env.PATH}`] : [];

	if (mode === "window") {
		const paneId = createTmuxPane([
			"new-window",
			...printPaneArgs,
			...tmuxEnvironmentArgs,
			"-n",
			"pi-diff",
			"-c",
			cwd,
			shellCommand,
		]);
		return { mode, paneId };
	}

	if (mode === "pane") {
		const paneId = createTmuxPane([
			"split-window",
			"-h",
			...printPaneArgs,
			...tmuxEnvironmentArgs,
			"-c",
			cwd,
			shellCommand,
		]);
		return { mode, paneId };
	}

	const sessionName = `pi-diff-${sanitizeSessionNamePart(path.basename(cwd))}-${process.pid}-${Date.now().toString(36)}`;
	const paneId = createTmuxPane([
		"new-session",
		"-d",
		...printPaneArgs,
		...tmuxEnvironmentArgs,
		"-s",
		sessionName,
		"-n",
		"hunk",
		"-c",
		cwd,
		shellCommand,
	]);

	return {
		mode,
		paneId,
		sessionName,
		attachCommand: `tmux attach -t ${shellQuote(sessionName)}`,
	};
}

async function tmuxPaneExists(paneId: string): Promise<boolean> {
	try {
		const output = await run("tmux", ["list-panes", "-a", "-F", "#{pane_id}"], { timeout: 3_000 });
		return output.split(/\r?\n/).includes(paneId);
	} catch {
		return false;
	}
}

async function listHunkSessions(): Promise<HunkSession[]> {
	const output = await run("hunk", ["session", "list", "--json"], { timeout: 5_000 });
	const parsed = JSON.parse(output || "{}");
	return Array.isArray(parsed.sessions) ? parsed.sessions : [];
}

function sessionMatchesPane(session: HunkSession, paneId: string): boolean {
	return (session.terminal?.locations ?? []).some(
		(location) => location.source === "tmux" && location.paneId === paneId,
	);
}

function sessionMatchesCwd(session: HunkSession, cwd: string): boolean {
	const normalizedCwd = normalizePath(cwd);
	return [session.repoRoot, session.cwd]
		.filter((candidate): candidate is string => Boolean(candidate))
		.some((candidate) => normalizePath(candidate) === normalizedCwd);
}

async function waitForHunkSession(launch: TmuxLaunch, cwd: string): Promise<HunkSession | undefined> {
	const started = Date.now();
	while (Date.now() - started < SESSION_REGISTER_TIMEOUT_MS) {
		const sessions = await listHunkSessions().catch(() => []);
		const byPane = launch.paneId ? sessions.find((session) => sessionMatchesPane(session, launch.paneId)) : undefined;
		if (byPane) return byPane;

		const byCwd = sessions.filter((session) => sessionMatchesCwd(session, cwd));
		if (byCwd.length === 1) return byCwd[0];

		if (launch.paneId && !(await tmuxPaneExists(launch.paneId))) return undefined;
		await sleep(250);
	}
	return undefined;
}

function isReviewNote(value: unknown): value is ReviewNote {
	if (!value || typeof value !== "object") return false;
	const note = value as Partial<ReviewNote>;
	return typeof note.noteId === "string" && typeof note.filePath === "string" && typeof note.body === "string";
}

async function listUserNotes(sessionId: string): Promise<ReviewNote[]> {
	const output = await run(
		"hunk",
		["session", "comment", "list", sessionId, "--type", "user", "--json"],
		{ timeout: 5_000 },
	);
	const parsed = JSON.parse(output || "{}");
	const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
	return comments.filter(isReviewNote).filter((note) => note.source === undefined || note.source === "user");
}

function sameNotes(left: ReviewNote[], right: ReviewNote[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

async function collectUserNotes(sessionId: string, launch: TmuxLaunch, onUpdate: (notes: ReviewNote[]) => void): Promise<ReviewNote[]> {
	let latestNotes: ReviewNote[] = [];

	while (true) {
		const sessions = await listHunkSessions().catch(() => undefined);
		const sessionStillAlive = sessions === undefined || sessions.some((session) => session.sessionId === sessionId);
		if (!sessionStillAlive) break;

		try {
			const notes = await listUserNotes(sessionId);
			if (!sameNotes(notes, latestNotes)) {
				latestNotes = notes;
				onUpdate(latestNotes);
			}
		} catch {
			if (launch.paneId && !(await tmuxPaneExists(launch.paneId))) break;
		}

		await sleep(POLL_INTERVAL_MS);
	}

	return latestNotes;
}

function formatRange(range: [number, number] | undefined, label: string): string | undefined {
	if (!range) return undefined;
	const [start, end] = range;
	return start === end ? `${label} line ${start}` : `${label} lines ${start}-${end}`;
}

function noteLocation(note: ReviewNote): string {
	const parts = [
		note.hunkIndex !== undefined ? `hunk ${note.hunkIndex + 1}` : undefined,
		formatRange(note.oldRange, "old"),
		formatRange(note.newRange, "new"),
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(", ") : "location unknown";
}

function sortNotes(notes: ReviewNote[]): ReviewNote[] {
	return [...notes].sort((left, right) => {
		const fileCompare = left.filePath.localeCompare(right.filePath);
		if (fileCompare !== 0) return fileCompare;
		const leftHunk = left.hunkIndex ?? Number.MAX_SAFE_INTEGER;
		const rightHunk = right.hunkIndex ?? Number.MAX_SAFE_INTEGER;
		if (leftHunk !== rightHunk) return leftHunk - rightHunk;
		const leftLine = left.newRange?.[0] ?? left.oldRange?.[0] ?? Number.MAX_SAFE_INTEGER;
		const rightLine = right.newRange?.[0] ?? right.oldRange?.[0] ?? Number.MAX_SAFE_INTEGER;
		return leftLine - rightLine;
	});
}

function indentBody(body: string): string {
	return body
		.trim()
		.split(/\r?\n/)
		.map((line) => `   ${line}`)
		.join("\n");
}

function buildAgentPrompt(notes: ReviewNote[]): string {
	const formattedNotes = sortNotes(notes)
		.map((note, index) => {
			return [
				`${index + 1}. \`${note.filePath}\` — ${noteLocation(note)}`,
				indentBody(note.body),
			].join("\n");
		})
		.join("\n\n");

	return [
		"I reviewed the current worktree diff in Hunk and saved these inline comments.",
		"Please address them in the working tree. Inspect the referenced files/hunks as needed.",
		"",
		formattedNotes,
	].join("\n");
}

function getPathspecFromHunkArgs(hunkArgs: string[]): string[] {
	const separatorIndex = hunkArgs.indexOf("--");
	return separatorIndex === -1 ? [] : hunkArgs.slice(separatorIndex + 1);
}

function getLastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!("role" in message) || message.role !== "assistant") continue;
		return message.content
			.filter((content): content is { type: "text"; text: string } => content.type === "text")
			.map((content) => content.text)
			.join("\n")
			.trim();
	}
	return undefined;
}

async function listChangedFiles(cwd: string): Promise<string[]> {
	const tracked = await run("git", ["diff", "--name-only", "HEAD", "--"], { cwd, timeout: 10_000 }).catch(() => "");
	const untracked = await run("git", ["ls-files", "--others", "--exclude-standard"], { cwd, timeout: 10_000 }).catch(() => "");
	return Array.from(new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)].map((file) => file.trim()).filter(Boolean)));
}

async function listTrackedFiles(cwd: string): Promise<string[]> {
	const tracked = await run("git", ["ls-files"], { cwd, timeout: 10_000 }).catch(() => "");
	return tracked.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
}

function textMentionsPath(text: string, file: string): boolean {
	const normalizedText = text.replace(/\\\//g, "/");
	const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_./-])`).test(normalizedText);
}

function extractDiscussedFiles(text: string, candidateFiles: string[]): string[] {
	return candidateFiles.filter((file) => textMentionsPath(text, file));
}

function buildFullFilePatch(cwd: string, files: string[]): string {
	return files
		.map((file) => {
			const absolutePath = path.join(cwd, file);
			const content = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
			const lines = content.length === 0 ? [] : content.replace(/\r\n/g, "\n").split("\n");
			if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
			const addedLines = lines.map((line) => `+${line}`).join("\n");
			return [
				`diff --git a/${file} b/${file}`,
				"new file mode 100644",
				"index 0000000..0000000",
				"--- /dev/null",
				`+++ b/${file}`,
				`@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
				addedLines || "+",
			].join("\n");
		})
		.join("\n\n");
}

function writeFullFilePatch(cwd: string, files: string[]): string {
	const patchPath = path.join(os.tmpdir(), `pi-review-in-hunk-files-${process.pid}-${Date.now().toString(36)}.patch`);
	fs.writeFileSync(patchPath, `${buildFullFilePatch(cwd, files)}\n`);
	return patchPath;
}

function trimContext(text: string): string {
	return text.length <= 8_000 ? text : `${text.slice(0, 8_000)}\n\n…truncated…`;
}

function summarizeContext(text: string): string {
	const firstMeaningfulLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return (firstMeaningfulLine ?? "Pi conversation context").slice(0, 160);
}

function writeReviewAgentContext(cwd: string, files: string[], assistantText: string, anchorAtTop: boolean): string {
	const contextPath = path.join(os.tmpdir(), `pi-review-in-hunk-${process.pid}-${Date.now().toString(36)}.json`);
	const summary = summarizeContext(assistantText);
	const rationale = trimContext(assistantText);
	const context = {
		version: 1,
		summary: "Context from the last Pi assistant message.",
		files: files.map((file) => ({
			path: file,
			summary: "Discussed in the last Pi assistant message.",
			annotations: [
				{
					summary,
					rationale,
					...(anchorAtTop ? { newRange: [1, 1] } : {}),
					author: "Pi",
					source: "last-assistant-message",
					createdAt: new Date().toISOString(),
				},
			],
		})),
	};
	fs.writeFileSync(contextPath, JSON.stringify(context, null, 2));
	return contextPath;
}

async function handleReviewInHunkCommand(pi: ExtensionAPI, args: string, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/review-in-hunk requires interactive Pi mode", "error");
		return;
	}

	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current response to finish before opening /review-in-hunk", "warning");
		return;
	}

	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(args);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		return;
	}

	if (parsed.showHelp) {
		ctx.ui.notify(
			[
				"Usage: /review-in-hunk [--window|--pane|--session] [-- pathspec...]",
				"",
				"Opens Hunk on changed files mentioned by the last assistant message,",
				"with that assistant message attached as Hunk agent notes.",
			].join("\n"),
			"info",
		);
		return;
	}

	if (!commandExists("tmux")) {
		ctx.ui.notify("/review-in-hunk uses tmux to run Hunk without corrupting Pi's TUI, but `tmux` was not found.", "error");
		return;
	}

	const assistantText = getLastAssistantText(ctx);
	if (!assistantText) {
		ctx.ui.notify("No assistant message found to attach as Hunk context.", "error");
		return;
	}

	const explicitPathspec = getPathspecFromHunkArgs(parsed.hunkArgs);
	const changedFiles = await listChangedFiles(ctx.cwd);
	const discussedChangedFiles = explicitPathspec.length > 0 ? explicitPathspec : extractDiscussedFiles(assistantText, changedFiles);

	if (changedFiles.length > 0) {
		const filesToReview = discussedChangedFiles.length > 0 ? discussedChangedFiles : changedFiles;
		const contextPath = writeReviewAgentContext(ctx.cwd, filesToReview, assistantText, false);
		parsed.hunkArgs = ["diff", "--agent-context", contextPath, "--agent-notes", "--", ...filesToReview];

		ctx.ui.notify(
			`Opening ${filesToReview.length} changed file${filesToReview.length === 1 ? "" : "s"} in Hunk with Pi conversation context.`,
			"info",
		);
		await handleLaunchedHunk(pi, ctx, parsed);
		return;
	}

	const trackedFiles = await listTrackedFiles(ctx.cwd);
	const discussedTrackedFiles = explicitPathspec.length > 0 ? explicitPathspec : extractDiscussedFiles(assistantText, trackedFiles);
	const filesToReview = discussedTrackedFiles.filter((file) => {
		try {
			return fs.statSync(path.join(ctx.cwd, file)).isFile();
		} catch {
			return false;
		}
	});

	if (filesToReview.length === 0) {
		ctx.ui.notify("No changed files, and no existing files from the last assistant message could be found.", "info");
		return;
	}

	const patchPath = writeFullFilePatch(ctx.cwd, filesToReview);
	const contextPath = writeReviewAgentContext(ctx.cwd, filesToReview, assistantText, true);
	parsed.hunkArgs = ["patch", patchPath, "--agent-context", contextPath, "--agent-notes"];

	ctx.ui.notify(
		`No changes found; opening ${filesToReview.length} full file${filesToReview.length === 1 ? "" : "s"} as a synthetic Hunk patch with Pi context.`,
		"info",
	);
	await handleLaunchedHunk(pi, ctx, parsed);
}

async function handleLaunchedHunk(pi: ExtensionAPI, ctx: ExtensionContext, parsed: ParsedArgs): Promise<void> {
	const cwd = ctx.cwd;
	if (!directoryExists(cwd)) {
		ctx.ui.notify(
			`Cannot open Hunk because Pi's working directory no longer exists: ${cwd}. Start Pi from an existing checkout or repo worktree first.`,
			"error",
		);
		return;
	}

	ctx.ui.setStatus(STATUS_KEY, "opening Hunk diff…");

	const launch = launchHunk(cwd, parsed.mode, parsed.hunkArgs);

	if (launch.attachCommand) {
		ctx.ui.notify(`Hunk opened in tmux session. Attach with: ${launch.attachCommand}`, "info");
	}

	void (async () => {
		try {
			const hunkSession = await waitForHunkSession(launch, cwd);
			if (!hunkSession) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify(
					"Hunk opened, but its live session API did not register. Saved notes cannot be ingested from this run.",
					"warning",
				);
				return;
			}

			ctx.ui.setStatus(STATUS_KEY, "Hunk open — 0 saved notes");
			const notes = await collectUserNotes(hunkSession.sessionId, launch, (currentNotes) => {
				ctx.ui.setStatus(STATUS_KEY, `Hunk open — ${currentNotes.length} saved note${currentNotes.length === 1 ? "" : "s"}`);
			});

			ctx.ui.setStatus(STATUS_KEY, undefined);

			if (notes.length === 0) {
				ctx.ui.notify("Hunk closed with no saved user notes; nothing was sent to the agent.", "info");
				return;
			}

			(pi as unknown as { appendEntry?: (customType: string, data?: unknown) => void }).appendEntry?.("hunk-diff-review", {
				cwd,
				hunkArgs: parsed.hunkArgs,
				notes,
				completedAt: new Date().toISOString(),
			});

			const prompt = buildAgentPrompt(notes);
			ctx.ui.notify(`Sending ${notes.length} Hunk note${notes.length === 1 ? "" : "s"} to the agent…`, "info");
			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			}
		} catch (error) {
			ctx.ui.notify(`Failed while monitoring Hunk notes: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	})();
}

async function handleDiffCommand(
	pi: ExtensionAPI,
	commandName: DiffCommandName,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(`/${commandName} requires interactive Pi mode`, "error");
		return;
	}

	if (!ctx.isIdle()) {
		ctx.ui.notify(`Wait for the current response to finish before opening /${commandName}`, "warning");
		return;
	}

	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(args);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		return;
	}

	if (parsed.showHelp) {
		ctx.ui.notify(usage(commandName), "info");
		return;
	}

	if (!commandExists("tmux")) {
		ctx.ui.notify(`/${commandName} uses tmux to run Hunk without corrupting Pi's TUI, but \`tmux\` was not found.`, "error");
		return;
	}

	const cwd = ctx.cwd;
	if (!directoryExists(cwd)) {
		ctx.ui.notify(
			`Cannot open Hunk because Pi's working directory no longer exists: ${cwd}. Start Pi from an existing checkout or repo worktree first.`,
			"error",
		);
		return;
	}

	if (commandName !== DIFF_COMMAND_NAME) {
		try {
			const { range, baseDescription } = await resolvePullRequestDiffRange(cwd);
			parsed.hunkArgs.splice(1, 0, range);
			ctx.ui.notify(`Opening PR diff against ${baseDescription}: ${range}`, "info");
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}
	}

	ctx.ui.setStatus(STATUS_KEY, "opening Hunk diff…");

	const launch = launchHunk(cwd, parsed.mode, parsed.hunkArgs);

	if (launch.attachCommand) {
		ctx.ui.notify(`Hunk opened in tmux session. Attach with: ${launch.attachCommand}`, "info");
	}

	void (async () => {
		try {
			const hunkSession = await waitForHunkSession(launch, cwd);
			if (!hunkSession) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify(
					"Hunk opened, but its live session API did not register. Saved notes cannot be ingested from this run.",
					"warning",
				);
				return;
			}

			ctx.ui.setStatus(STATUS_KEY, "Hunk open — 0 saved notes");
			const notes = await collectUserNotes(hunkSession.sessionId, launch, (currentNotes) => {
				ctx.ui.setStatus(STATUS_KEY, `Hunk open — ${currentNotes.length} saved note${currentNotes.length === 1 ? "" : "s"}`);
			});

			ctx.ui.setStatus(STATUS_KEY, undefined);

			if (notes.length === 0) {
				ctx.ui.notify("Hunk closed with no saved user notes; nothing was sent to the agent.", "info");
				return;
			}

			(pi as unknown as { appendEntry?: (customType: string, data?: unknown) => void }).appendEntry?.("hunk-diff-review", {
				cwd,
				hunkArgs: parsed.hunkArgs,
				notes,
				completedAt: new Date().toISOString(),
			});

			const prompt = buildAgentPrompt(notes);
			ctx.ui.notify(`Sending ${notes.length} Hunk note${notes.length === 1 ? "" : "s"} to the agent…`, "info");
			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			}
		} catch (error) {
			ctx.ui.notify(`Failed while monitoring Hunk notes: ${error instanceof Error ? error.message : String(error)}`, "error");
		} finally {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	})();
}

export default function hunkDiffExtension(pi: ExtensionAPI) {
	pi.registerCommand(DIFF_COMMAND_NAME, {
		description: "Open Hunk for the current worktree and ingest saved inline notes",
		handler: (args, ctx) => handleDiffCommand(pi, DIFF_COMMAND_NAME, args, ctx),
	});

	pi.registerCommand(DIFF_PR_COMMAND_NAME, {
		description: "Open Hunk for the whole current PR/branch diff and ingest saved inline notes",
		handler: (args, ctx) => handleDiffCommand(pi, DIFF_PR_COMMAND_NAME, args, ctx),
	});

	pi.registerCommand(REVIEW_IN_HUNK_COMMAND_NAME, {
		description: "Open Hunk on files discussed in the last assistant message, with that context attached as agent notes",
		handler: (args, ctx) => handleReviewInHunkCommand(pi, args, ctx),
	});
}
