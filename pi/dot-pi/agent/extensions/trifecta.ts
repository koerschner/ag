import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface WorkerSpec {
	label: string;
	provider: string;
	model: string;
	fileSuffix: string;
}

const WORKERS: WorkerSpec[] = [
	{
		label: "opus",
		provider: "anthropic",
		model: "claude-opus-4-6",
		fileSuffix: "claude-opus-4-6",
	},
	{
		label: "gemini",
		provider: "google-gemini-cli",
		model: "gemini-3.1-pro-preview",
		fileSuffix: "gemini-3-1-pro-preview",
	},
	{
		label: "codex",
		provider: "openai-codex",
		model: "gpt-5.4",
		fileSuffix: "gpt-5-4",
	},
];

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function slugify(value: string, maxLength: number, fallback: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength);
	return slug || fallback;
}

function buildSessionName(prompt: string): string {
	const base = slugify(prompt, 28, "trifecta");
	const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
	return `${base}-${timestamp}`;
}

function buildSystemPrompt(worker: WorkerSpec): string {
	return [
		`You are the ${worker.model} worker in a 3-model trifecta.`,
		`When you create a new file, append -${worker.fileSuffix} before the extension unless the user explicitly tells you to use a different filename.`,
		`Examples: research.md -> research-${worker.fileSuffix}.md, notes.txt -> notes-${worker.fileSuffix}.txt.`,
		"Do not overwrite or reuse another worker's output file unless the user explicitly asks for that.",
		"If you reference your work in the final response, mention the exact file path you wrote.",
	].join(" ");
}

function buildPiCommand(worker: WorkerSpec, prompt: string): string {
	const commandParts = [
		"clear",
		`printf '\\033]2;%s\\007' ${shellQuote(`pi trifecta: ${worker.label}`)}`,
		`echo ${shellQuote(`Starting ${worker.label} (${worker.provider}/${worker.model})`)}`,
		`pi --model ${shellQuote(`${worker.provider}/${worker.model}`)} --append-system-prompt ${shellQuote(buildSystemPrompt(worker))} ${shellQuote(prompt)}`,
		"exec $SHELL",
	];

	return commandParts.join("; ");
}

export default function trifectaExtension(pi: ExtensionAPI): void {
	pi.registerCommand("trifecta", {
		description: "Start a new tmux session named from the prompt with Opus, Gemini, and Codex in separate tmux windows",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /trifecta <prompt>", "warning");
				return;
			}

			const sessionName = buildSessionName(prompt);
			const commandArgs = WORKERS.map((worker) => buildPiCommand(worker, prompt));

			const firstWorker = WORKERS[0];
			const first = await pi.exec("tmux", [
				"new-session",
				"-d",
				"-s",
				sessionName,
				"-n",
				firstWorker.label,
				"-c",
				ctx.cwd,
				commandArgs[0],
			]);
			if (first.code !== 0) {
				throw new Error(first.stderr || first.stdout || "Failed to create tmux session");
			}

			for (let i = 1; i < commandArgs.length; i++) {
				const worker = WORKERS[i];
				const created = await pi.exec("tmux", [
					"new-window",
					"-t",
					sessionName,
					"-n",
					worker.label,
					"-c",
					ctx.cwd,
					commandArgs[i],
				]);
				if (created.code !== 0) {
					throw new Error(created.stderr || created.stdout || `Failed to create window for ${worker.label}`);
				}
			}

			await pi.exec("tmux", ["select-window", "-t", `${sessionName}:${firstWorker.label}`]);

			if (process.env.TMUX) {
				const switched = await pi.exec("tmux", ["switch-client", "-t", sessionName]);
				if (switched.code !== 0) {
					ctx.ui.notify(`Created tmux session ${sessionName}, but could not switch to it automatically.`, "warning");
				}
			}

			const attachCommand = `tmux attach -t ${sessionName}`;
			pi.sendMessage({
				customType: "trifecta",
				content: `Started trifecta session ${sessionName}.\nAttach command: ${attachCommand}`,
				display: true,
			});
		},
	});
}
