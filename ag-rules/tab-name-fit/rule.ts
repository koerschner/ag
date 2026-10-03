// ag-rule tab-name-fit (spec: rule.md beside this). Hook `tab-name`, run by the ag-tab-name Pi extension.
// input: { label, first, later } → { keep, p }.
import type { TabNameRule } from "../types.ts";

const RENAME_BELOW = 0.5;

const rule: TabNameRule = async ({ label, first, later }, ag) => {
	const a = await ag.jev({ tab_label: label, first_prompt: first, later_prompts_oldest_first: later }, {
		fit: {
			type: "choice",
			instructions:
				"`tab_label` is the title of a work session. How well does it name what the session as a whole is about? Judge by the topic that runs through the session, which the first prompt usually sets. Later prompts are often follow-up steps on that same topic (fixes, reviews, PRs, questions, 'run it'): those are still the same topic.",
			criteria: {
				accurate: "The label names the session's main topic (its product, system, feature, ticket or person), even if short.",
				wrong_topic: "The label names a different topic, feature, or task than the session is about.",
				misleading_word: "The topic is roughly right but a key word in the label is wrong or misleading.",
				generic_step: "The label names only a generic step (e.g. 'PR Review', 'Fix Bug', 'Check Status') and misses the session's distinctive topic keywords.",
				switched: "The session has clearly left the label's topic for good: most of the later prompts are about one unrelated task.",
			},
		},
	}, 10_000);
	const p: number = a.fit.probabilities.accurate;
	return { keep: p >= RENAME_BELOW, p };
};
export default rule;
