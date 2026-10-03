// ag-rule new-item-intent (spec: rule.md beside this). Hook `new-item`, run by ag-dash's POST /api/new.
// input: { text } → { intent: "find" | "new" }.
import type { NewItemRule } from "../types.ts";

const rule: NewItemRule = async ({ text }, ag) => {
	const a = await ag.jev({ message: text.slice(0, 8000) }, {
		intent: {
			type: "choice",
			instructions: "The user typed `message` into the New item box of their AI agent dashboard, where every card is an agent session (a task or conversation). What do they want?",
			criteria: {
				find: "They want to locate and open one existing session or card: where is it, which one was it, show me / open the session about X, or just a short phrase naming a past topic or session (e.g. 'the roblox launch triage one', 'that thing about kids betting'). They want it surfaced, not new work done.",
				follow: "They ask for a status update on, or adds information or instructions to, work that is already going (e.g. 'any update on X?', 'also make X do Y', 'X is fixed now'). An agent should continue that work.",
				new: "They ask an agent to do a new task, research something, answer a question, or do housekeeping on their sessions (pin, close, rename, file, merge): start new work.",
			},
		},
	}, 10_000);
	return { intent: a.intent.choice === "find" ? "find" : "new" };
};
export default rule;
