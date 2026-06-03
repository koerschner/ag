import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function buildUpdateTodosPrompt(args: string): string {
	const contextHint = args.trim();
	const sourceText = contextHint
		? `Use this todo-update source/context request: ${contextHint}`
		: "No explicit source was provided. Use the issues, bugs, follow-ups, and open questions discussed above in this Pi session as the source context.";

	return `Update the project todo list from context.

${sourceText}

Your job is ONLY to reconcile todos. Do not implement product/code changes unless I explicitly ask in a later turn.

Process:
1. Inspect the relevant context/source.
   - If the source says "from the pr" or otherwise references a PR, identify the relevant PR from the current branch or nearby context and inspect its description, review comments, check output, and discussion using available local/GitHub tools.
   - If the source mentions Cursor Bugbot/bugbot comments, look for Bugbot comments in the relevant PR/review/discussion and extract actionable issues.
   - If no source was provided, use the issues discussed earlier in this session.
2. List existing todos, including closed todos, and compare semantically against the extracted issues.
3. For each issue:
   - If a similar todo exists, update or append the new context/evidence instead of creating a duplicate.
   - If no similar todo exists, create a new todo with a concise title, useful tags, and enough body detail to act on it later.
   - Preserve important provenance (PR number/comment URL/author/tool/source, file paths, observed symptoms, suggested fix, and uncertainty).
4. If an existing todo is closed/completed but the context says it is still uncompleted or has further work to be done, verify against the actual code/state before changing it:
   - A completed todo is allowed to be reopened when new evidence shows the underlying issue still has remaining work.
   - If code/state confirms it is still unresolved or needs follow-up work, reopen/update the todo and explain the evidence.
   - If code/state confirms it is completed, keep it closed and append any useful note only if needed.
   - If you cannot verify, do not blindly reopen; append the uncertainty and ask what to do if necessary.
5. Close or mark todos only when the code/state clearly proves the issue is done.
6. Finish with a short summary of created, updated, reopened, left-closed, and skipped/uncertain todos.

Use the todo tool for todo changes.`;
}

export default function updateTodosExtension(pi: ExtensionAPI) {
	pi.registerCommand("update-todos", {
		description: "Extract todo items from current context/PR/Bugbot comments and reconcile them with existing todos",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const prompt = buildUpdateTodosPrompt(args ?? "");
			ctx.ui.notify("Reconciling todos from context…", "info");
			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			}
		},
	});
}
