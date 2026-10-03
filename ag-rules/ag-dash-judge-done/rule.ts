// ag-rule ag-dash-judge-done (spec: rule.md beside this). Hook `answer`, run by ag-dash for chats archived while working.
// input: { request, reply } → { done } (undefined if Jev fails: ag-dash then treats it as not done).
import type { AnswerRule } from "../types.ts";

const rule: AnswerRule = async ({ request, reply }, ag) => {
	const a = await ag.jev({ request: request.slice(0, 4000), reply: reply.slice(-4000) }, {
		outcome: {
			type: "choice",
			instructions: "An AI agent worked on the user's `request`; `reply` is its latest message. Does the session look done?",
			criteria: {
				done: "The goal was met and nothing is left for the user: no error, failure, partial result, blocker, or question, request or review waiting on them.",
				needs_user: "The goal wasn't met, or more input is needed from the user: something failed or is incomplete, the agent is blocked or needs access or a decision, or it asks them something or wants them to review or confirm before going on.",
			},
		},
	});
	return { done: a.outcome.choice === "done" };
};
export default rule;
