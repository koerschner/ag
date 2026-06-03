import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const TODO_DIR_NAME = ".pi/todos";
const TODO_PATH_ENV = "PI_TODO_PATH";
const TODO_ID_PREFIX = "TODO-";
const TODO_ID_PATTERN = /^[a-f0-9]{8}$/i;

interface TodoFrontMatter {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	assigned_to_session?: string;
}

interface TodoRecord extends TodoFrontMatter {
	body: string;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeTodoId(id: string): string {
	let trimmed = id.trim();
	if (trimmed.startsWith("#")) trimmed = trimmed.slice(1);
	if (trimmed.toUpperCase().startsWith(TODO_ID_PREFIX)) trimmed = trimmed.slice(TODO_ID_PREFIX.length);
	return trimmed.toLowerCase();
}

function formatTodoId(id: string): string {
	return `${TODO_ID_PREFIX}${normalizeTodoId(id)}`;
}

function isTodoClosed(status: string): boolean {
	return ["closed", "done"].includes((status || "").toLowerCase());
}

function getTodosDir(cwd: string): string {
	const overridePath = process.env[TODO_PATH_ENV];
	if (overridePath && overridePath.trim()) return path.resolve(cwd, overridePath.trim());
	return path.resolve(cwd, TODO_DIR_NAME);
}

function findJsonObjectEnd(content: string): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			continue;
		}
		if (char === "{") depth += 1;
		if (char === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function splitFrontMatter(content: string): { frontMatter: string; body: string } {
	if (!content.startsWith("{")) return { frontMatter: "", body: content };
	const endIndex = findJsonObjectEnd(content);
	if (endIndex === -1) return { frontMatter: "", body: content };
	return {
		frontMatter: content.slice(0, endIndex + 1),
		body: content.slice(endIndex + 1).replace(/^\r?\n+/, ""),
	};
}

function parseTodoContent(content: string, idFallback: string): TodoRecord {
	const { frontMatter, body } = splitFrontMatter(content);
	const data: TodoRecord = {
		id: idFallback,
		title: "",
		tags: [],
		status: "open",
		created_at: "",
		body,
	};
	try {
		const parsed = JSON.parse(frontMatter || "{}") as Partial<TodoFrontMatter>;
		if (typeof parsed.id === "string" && parsed.id) data.id = normalizeTodoId(parsed.id);
		if (typeof parsed.title === "string") data.title = parsed.title;
		if (typeof parsed.status === "string" && parsed.status) data.status = parsed.status;
		if (typeof parsed.created_at === "string") data.created_at = parsed.created_at;
		if (typeof parsed.assigned_to_session === "string") data.assigned_to_session = parsed.assigned_to_session;
		if (Array.isArray(parsed.tags)) data.tags = parsed.tags.filter((tag): tag is string => typeof tag === "string");
	} catch {
		// Keep defaults for malformed todos.
	}
	return data;
}

function listTodos(todosDir: string): TodoRecord[] {
	let entries: string[] = [];
	try {
		entries = readdirSync(todosDir);
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.endsWith(".md"))
		.map((entry) => {
			const id = entry.slice(0, -3);
			return parseTodoContent(readFileSync(path.join(todosDir, entry), "utf8"), id);
		})
		.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "todo";
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFile("git", args, { cwd });
	return stdout.trim();
}

async function tmux(args: string[]): Promise<string> {
	const { stdout } = await execFile("tmux", args);
	return stdout.trim();
}

function parseArgs(args: string): { ids: string[]; count?: number } {
	const tokens = (args || "").split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
	const ids: string[] = [];
	let count: number | undefined;
	for (const token of tokens) {
		const normalized = normalizeTodoId(token);
		if (TODO_ID_PATTERN.test(normalized)) {
			ids.push(normalized);
			continue;
		}
		const numeric = Number(token);
		if (Number.isInteger(numeric) && numeric > 0) count = numeric;
	}
	return { ids: [...new Set(ids)], count };
}

async function selectTodos(ctx: ExtensionContext, args: string): Promise<TodoRecord[]> {
	const todosDir = getTodosDir(ctx.cwd);
	const todos = listTodos(todosDir).filter((todo) => !isTodoClosed(todo.status));
	const { ids, count } = parseArgs(args);
	if (ids.length) {
		const selected = ids.map((id) => todos.find((todo) => normalizeTodoId(todo.id) === id)).filter((todo): todo is TodoRecord => Boolean(todo));
		const missing = ids.filter((id) => !selected.some((todo) => normalizeTodoId(todo.id) === id));
		if (missing.length) throw new Error(`Todo(s) not found or closed: ${missing.map(formatTodoId).join(", ")}`);
		return selected;
	}
	const openUnassigned = todos.filter((todo) => !todo.assigned_to_session);
	return count ? openUnassigned.slice(0, count) : openUnassigned;
}

async function startTodoWorktrees(ctx: ExtensionContext, args: string): Promise<{ rootDir: string; attach: string; todos: TodoRecord[]; todosDir: string }> {
	const todosDir = getTodosDir(ctx.cwd);
	const selectedTodos = await selectTodos(ctx, args);
	if (!selectedTodos.length) throw new Error("No open unassigned todos found. Pass explicit TODO ids to include assigned todos.");

	const repoRoot = await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
	const runStamp = timestamp();
	const rootDir = path.join(repoRoot, ".worktrees", `todos-${runStamp}`);
	await fs.mkdir(rootDir, { recursive: true });

	const panes: string[] = [];
	for (const todo of selectedTodos) {
		const id = normalizeTodoId(todo.id);
		const displayId = formatTodoId(id);
		const slug = slugify(todo.title);
		const worktreePath = path.join(rootDir, `${id}-${slug}`);
		const branch = `todos/${id}-${runStamp}`;
		await git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
		panes.push(worktreePath);
	}

	const sessionName = `todo-worktrees-${runStamp}`;
	let windowTarget: string;
	let attach: string;
	if (process.env.TMUX) {
		windowTarget = await tmux(["new-window", "-P", "-F", "#{session_name}:#{window_index}", "-n", "todos", "-c", panes[0]]);
		const session = windowTarget.split(":")[0];
		attach = `tmux attach -t ${session}`;
	} else {
		await tmux(["new-session", "-d", "-s", sessionName, "-n", "todos", "-c", panes[0]]);
		windowTarget = `${sessionName}:0`;
		attach = `tmux attach -t ${sessionName}`;
	}

	const paneTargets: string[] = [];
	const todoCount = selectedTodos.length;
	const cols = Math.ceil(Math.sqrt(todoCount));

	// Build an explicit grid instead of repeatedly splitting the active pane.
	// First create evenly-sized columns, then split each column into its rows.
	paneTargets[0] = await tmux(["display-message", "-p", "-t", windowTarget, "#{pane_id}"]);
	const columnTopPanes: string[] = [paneTargets[0]];
	let remainderPane = paneTargets[0];
	for (let col = 1; col < cols; col += 1) {
		const todoIndex = col;
		if (todoIndex >= todoCount) break;
		const percent = Math.floor((100 * (cols - col)) / (cols - col + 1));
		const newPane = await tmux([
			"split-window",
			"-h",
			"-p",
			String(percent),
			"-P",
			"-F",
			"#{pane_id}",
			"-t",
			remainderPane,
			"-c",
			panes[todoIndex],
		]);
		paneTargets[todoIndex] = newPane;
		columnTopPanes[col] = newPane;
		remainderPane = newPane;
	}

	for (let col = 0; col < columnTopPanes.length; col += 1) {
		const rowsInCol = Math.ceil((todoCount - col) / cols);
		let columnRemainderPane = columnTopPanes[col];
		for (let row = 1; row < rowsInCol; row += 1) {
			const todoIndex = row * cols + col;
			if (todoIndex >= todoCount) break;
			const percent = Math.floor((100 * (rowsInCol - row)) / (rowsInCol - row + 1));
			const newPane = await tmux([
				"split-window",
				"-v",
				"-p",
				String(percent),
				"-P",
				"-F",
				"#{pane_id}",
				"-t",
				columnRemainderPane,
				"-c",
				panes[todoIndex],
			]);
			paneTargets[todoIndex] = newPane;
			columnRemainderPane = newPane;
		}
	}
	await tmux(["select-layout", "-t", windowTarget, "tiled"]);

	for (let i = 0; i < selectedTodos.length; i += 1) {
		const todo = selectedTodos[i];
		const paneTarget = paneTargets[i] ?? windowTarget;
		const displayId = formatTodoId(todo.id);
		const title = todo.title || "(untitled)";
		const prompt = [
			`Work on todo ${displayId}: ${title}`,
			"You are in an isolated git worktree created for this todo.",
			`The shared todo directory is ${todosDir}. PI_TODO_PATH has been set to this absolute path so the todo tool can find the original todos from inside the worktree.`,
			"First claim the todo with the todo tool, then inspect the todo details, implement exactly this todo, update/reconcile related todos, and close or release this todo when finished.",
			`Todo body:\n${todo.body.trim() || "(no details)"}`,
		].join("\n\n");
		const command = `PI_TODO_PATH=${shellQuote(todosDir)} pi --name ${shellQuote(`${displayId} ${title}`)} ${shellQuote(prompt)}`;
		await tmux(["send-keys", "-t", paneTarget, command, "C-m"]);
	}

	return { rootDir, attach, todos: selectedTodos, todosDir };
}

export default function todoWorktreesExtension(pi: ExtensionAPI) {
	pi.registerCommand("todo-worktrees", {
		description: "Create git worktrees for open todos and launch Pi agents in a tmux window named todos",
		getArgumentCompletions: (argumentPrefix: string) => {
			const todos = listTodos(getTodosDir(process.cwd())).filter((todo) => !isTodoClosed(todo.status));
			const prefix = argumentPrefix.trim().toLowerCase();
			return todos
				.filter((todo) => !prefix || formatTodoId(todo.id).toLowerCase().includes(prefix) || todo.title.toLowerCase().includes(prefix))
				.map((todo) => ({
					value: formatTodoId(todo.id),
					label: `${formatTodoId(todo.id)} ${todo.title || "(untitled)"}`,
					description: todo.assigned_to_session ? `assigned: ${todo.assigned_to_session}` : "open",
				}));
		},
		handler: async (args, ctx) => {
			try {
				const result = await startTodoWorktrees(ctx, args || "");
				const lines = [
					`Created ${result.todos.length} todo worktree(s) under ${result.rootDir}`,
					`Shared todo directory: ${result.todosDir}`,
					"Started Pi in a tmux window named todos for:",
					...result.todos.map((todo) => `- ${formatTodoId(todo.id)} ${todo.title || "(untitled)"}`),
					`Attach with: ${result.attach}`,
				];
				if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
				else console.log(lines.join("\n"));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
			}
		},
	});
}
