// ag-rule inbox-follow-on (spec: rule.md beside this). Hook `capture`, run by ag-inbox for each new capture.
// input: { text, sessions: [{ id, title, first, latest }] } → { action: "follow" | "hint" | "new", session, ongoing, p }.
// Tested on ~8 captures: clear follow-ups score 0.97-1.0, a vague "any update on that thing?" 0.6 (→ hint),
// unrelated asks pick "none".
import type { CaptureRule } from "../types.ts";

const FOLLOW = { ongoing: 0.7, match: 0.8 };
const HINT = { ongoing: 0.5, match: 0.3 };

const rule: CaptureRule = async ({ text, sessions }, ag) => {
	if (!sessions.length) return { action: "new", session: null, ongoing: 0, p: 0 };
	const criteria: Record<string, string> = Object.fromEntries(sessions.map((s, i) => [`s${i}`, `${s.title}. First prompt: ${s.first}${s.latest ? ` Latest prompt: ${s.latest}` : ""}`]));
	criteria.none = "None of these sessions; the message is about something new or unrelated to every listed session.";
	const a = await ag.jev({ new_message: text.slice(0, 8000) }, {
		ongoing: { type: "noul", instructions: "The user sent `new_message` to their AI agent inbox. Does it refer back to an ongoing piece of work, conversation, or thread they already have going (e.g. 'the thing I was calling X', 'that issue', new info or updates for earlier work), rather than starting a brand-new request?" },
		session: { type: "choice", instructions: "The user has these open AI agent sessions (title, first prompt, latest prompt). Which session is `new_message` a follow-up to or new context for?", criteria },
	});
	const ongoing: number = a.ongoing.noul;
	const choice: string = a.session.choice;
	const p: number = a.session.probabilities?.[choice] ?? 0;
	const session = choice === "none" ? null : sessions[Number(choice.slice(1))]?.id ?? null;
	const action = !session ? "new" : ongoing >= FOLLOW.ongoing && p >= FOLLOW.match ? "follow" : ongoing >= HINT.ongoing && p >= HINT.match ? "hint" : "new";
	return { action, session, ongoing, p };
};
export default rule;
