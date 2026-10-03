// ag-rules: square-brackets (spec: square-brackets.md). Bracketed notes in Nathan's prompts → new sessions.
import type { PromptRule } from "./types.ts";

// Agent-written prompts: ag spawn's footer, tickler wake-ups. Appended context blocks are cut before matching.
const AGENT_WRITTEN = /\[ag-parent: |^\s*(?:⏰|🔔|◷|↺) /u;
const APPENDED = /\n(?:---\n)?(?:Session context \(snapshot|\[ag-parent: )/;
// Tags tools put in prompts, not Nathan's notes.
const TOOL_TAG = /^(?:ag-|image\b|pasted\b|merged\b|routine-)/i;

/** The bracketed notes in a prompt: prose in [ ], outside code, not a link/checkbox/index. */
export function bracketNotes(text: string): string[] {
	if (AGENT_WRITTEN.test(text)) return [];
	const body = text.split(APPENDED)[0]
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/`[^`\n]*`/g, " ");
	const notes: string[] = [];
	for (const m of body.matchAll(/(?<![\w\]\\!])\[([^\[\]\n]+)\](?![(\[:])/g)) {
		const note = m[1].trim();
		if (/[a-z]/i.test(note) && /\s/.test(note) && !TOOL_TAG.test(note)) notes.push(note);
	}
	return notes;
}

const rule: PromptRule = (prompt, ag) => {
	const notes = bracketNotes(prompt.text);
	if (!notes.length) return;
	const context = prompt.text.split(APPENDED)[0].trim();
	for (const note of notes) {
		ag.spawn(
			`Nathan left this note in [square brackets] in a prompt to another session. His standing rule ` +
				`(ag-rules: square-brackets) is that bracketed notes become their own session, so handle it here:\n\n` +
				`> ${note.replace(/\n/g, "\n> ")}\n\n` +
				`Bracketed notes are often about the Ag system itself (the agent instructions in ~/ag/agents.md, the ag ` +
				`and dotfiles repos, how agents behave); if this one is, treat it as a change to the system and ship it ` +
				`per those repos' rules. For context, the full prompt it came from:\n\n> ${context.replace(/\n/g, "\n> ")}`,
		);
	}
	let rest = prompt.text;
	for (const note of notes) rest = rest.replace(`[${note}]`, "").replace(/[ \t]{2,}/g, " ");
	if (!rest.split(APPENDED)[0].trim()) return { handled: `Spun out ${notes.length} bracketed note(s) as new sessions` };
	const list = notes.map((n) => `“${n}”`).join("; ");
	return {
		text: `${rest.trim()}\n\n(ag-rules square-brackets: Nathan's bracketed note(s) were already spun out to new ` +
			`Inbox sessions automatically; don't act on them here: ${list}.)`,
	};
};
export default rule;
